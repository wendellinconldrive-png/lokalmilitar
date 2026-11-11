from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import re
import uuid
import secrets
import hashlib
import asyncio
import jwt
import bcrypt
import logging
import math
import io
import tempfile
import zipfile
import zlib
import time
import threading
from functools import lru_cache
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Any
from requests.exceptions import RequestException
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo
import requests
from fastapi import (
    APIRouter,
    Body,
    Depends,
    FastAPI,
    File,
    Header,
    HTTPException,
    Query,
    Request,
    UploadFile,
)
from fastapi.responses import JSONResponse, RedirectResponse, StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorGridFSBucket
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from pymongo.errors import DuplicateKeyError, PyMongoError
from bson import ObjectId, json_util
from gridfs.errors import NoFile
from pywebpush import WebPushException, webpush
from google_calendar import (
    build_calendar_events,
    build_due_notifications,
    decrypt_token,
    encrypt_token,
    exchange_code,
    google_account_email,
    google_configuration_missing,
    oauth_authorization_url,
    push_configuration_missing,
    sync_calendar,
)

FUEL_TYPES = ("Gasolina", "Etanol", "Diesel", "GNV")
DEFAULT_FUEL_PRICES = {fuel_type: 0 for fuel_type in FUEL_TYPES}
DEFAULT_DEPOT_ADDRESS = "RUA SALUSTIANO SILVA 550, CEP 21745590"
LEGACY_DEFAULT_DEPOT_ADDRESS = "Rua Salustiano Silva, Nº 550, H - 21745590 - Rio de Janeiro, RJ"
RESET_GROUPS = {
    "orders": "Pedidos, comissões e registros vinculados",
    "inventory": "Produtos, categorias, grades e movimentações de estoque",
    "customers": "Clientes",
    "suppliers": "Fornecedores",
    "vehicles": "Veículos",
    "expenses": "Despesas, insumos, viagens e manutenções",
    "vendors": "Vendedores",
    "day_closures": "Relatórios de fechamento do dia",
    "dashboard_events": "Anotações do painel e pendências arquivadas",
}

# ---------- DB ----------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALG = "HS256"

app = FastAPI(title="LOKAL MILITAR API")
app.add_middleware(GZipMiddleware, minimum_size=500)
api = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)
_google_calendar_sync_lock = asyncio.Lock()
_calendar_worker_task = None

@app.middleware("http")
async def reject_legacy_offline_writes(request: Request, call_next):
    if request.headers.get("X-Offline-Operation-Id"):
        return JSONResponse(
            status_code=410,
            content={"detail": "A sincronização offline foi desativada. Atualize o aplicativo."},
        )
    return await call_next(request)


def public_access_enabled() -> bool:
    return os.environ.get("PUBLIC_ACCESS_MODE", "").strip().lower() == "true"

# ---------- Helpers ----------
def new_id() -> str:
    return str(uuid.uuid4())

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def hash_pw(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()

def verify_pw(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False

def create_token(user_id: str, email: str, role: str, auth_epoch: Optional[str] = None) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    if auth_epoch:
        payload["auth_epoch"] = auth_epoch
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

async def get_current_user(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    if not creds:
        if public_access_enabled():
            return {
                "id": "public-access",
                "email": "",
                "name": "Acesso público",
                "role": "admin",
            }
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")
    auth_state = await db.auth_state.find_one({"_id": "global"})
    if auth_state and payload.get("auth_epoch") != auth_state.get("epoch"):
        raise HTTPException(401, "Session expired")
    user = await db.users.find_one(
        {"id": payload["sub"]}, {"_id": 0, "password_hash": 0}
    )
    if not user:
        raise HTTPException(401, "User not found")
    if request.method not in ("GET", "HEAD", "OPTIONS") and user.get("role") == "visualizador":
        raise HTTPException(403, "Seu acesso permite apenas visualizar o sistema")
    return user

async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    return user

def strip_mongo(doc: dict) -> dict:
    if doc and "_id" in doc:
        doc.pop("_id", None)
    return doc

async def _prepare_trip(doc: dict) -> dict:
    destinations = doc.get("destinations") or []
    if not isinstance(destinations, list):
        raise HTTPException(400, "A lista de destinos é inválida")
    if not destinations and doc.get("destination_type") and doc.get("destination_id"):
        destinations = [{
            "destination_type": doc["destination_type"],
            "destination_id": doc["destination_id"],
        }]
    resolved_destinations = []
    route_stops = []
    destination_names = []
    for stop in destinations:
        destination_type = stop.get("destination_type")
        destination_id = stop.get("destination_id")
        if destination_type not in ("cliente", "fornecedor") or not destination_id:
            raise HTTPException(400, "Informe um cliente ou fornecedor válido para cada destino")
        collection = db.customers if destination_type == "cliente" else db.suppliers
        destination = await collection.find_one({"id": destination_id}, {"_id": 0})
        if not destination:
            raise HTTPException(404, "Cliente ou fornecedor não encontrado")
        distance = max(float(destination.get("distance_km") or 0), 0)
        name = destination.get("name") or "Destino"
        address = destination.get("address") or name
        resolved_destinations.append({
            "destination_type": destination_type,
            "destination_id": destination_id,
            "name": name,
            "address": address,
            "distance_km": distance,
        })
        destination_names.append(name)
        route_stops.append(address)
    if resolved_destinations:
        doc["destinations"] = resolved_destinations
        first_destination = resolved_destinations[0]
        doc["destination_type"] = first_destination["destination_type"]
        doc["destination_id"] = first_destination["destination_id"]
        doc["km"] = sum(stop["distance_km"] * 2 for stop in resolved_destinations)
        doc["route"] = "Depósito → " + " → ".join(route_stops) + " → Depósito"
        doc["description"] = doc.get("description") or f"Viagem até {', '.join(destination_names)}"

    vehicle_id = doc.get("vehicle_id")
    vehicle_fuels = []
    if vehicle_id:
        vehicle = await db.vehicles.find_one({"id": vehicle_id, "active": {"$ne": False}}, {"_id": 0})
        if not vehicle:
            raise HTTPException(400, "Veículo não encontrado ou inativo")
        doc["vehicle_name"] = vehicle["name"]
        vehicle_fuels = vehicle.get("fuel_types") or ([vehicle["fuel_type"]] if vehicle.get("fuel_type") else [])
        if vehicle_fuels:
            if doc.get("fuel_type") and doc["fuel_type"] not in vehicle_fuels:
                raise HTTPException(400, "Combustível não cadastrado para este veículo")
            doc["fuel_type"] = doc.get("fuel_type") or vehicle_fuels[0]
        doc["avg_consumption"] = float(doc.get("avg_consumption") or vehicle.get("avg_consumption") or 0)
    trip_fuel_unit = "m³" if doc.get("fuel_type") == "GNV" else "L"
    consumption = float(doc.get("avg_consumption") or 0)
    km = max(float(doc.get("km") or 0), 0)
    estimated_quantity = round(km / consumption, 2) if consumption > 0 else 0
    doc["fuel_quantity_unit"] = trip_fuel_unit
    doc["estimated_fuel_quantity"] = estimated_quantity
    doc["estimated_fuel_liters"] = estimated_quantity if trip_fuel_unit == "L" else 0
    fillup_records = doc.get("fuelings") or []
    if not isinstance(fillup_records, list) or any(not isinstance(fillup, dict) for fillup in fillup_records):
        raise HTTPException(400, "A lista de abastecimentos é inválida")
    price = max(float(doc.get("fuel_price_per_unit") or doc.get("fuel_price_per_liter") or 0), 0)
    settings = None
    if (price == 0 or fillup_records) and doc.get("fuel_type"):
        settings = await db.settings.find_one({"id": "singleton"}, {"_id": 0, "fuel_prices": 1})
    if price == 0 and doc.get("fuel_type"):
        price = max(float((settings or {}).get("fuel_prices", {}).get(doc["fuel_type"]) or 0), 0)
    doc["fuel_price_per_unit"] = price
    doc["fuel_price_per_liter"] = price
    try:
        daily_allowance = float(doc.get("daily_allowance") or 0)
    except (TypeError, ValueError) as error:
        raise HTTPException(400, "Informe um valor válido para a diária") from error
    if not math.isfinite(daily_allowance) or daily_allowance < 0:
        raise HTTPException(400, "A diária deve ser um valor não negativo")
    doc["daily_allowance"] = daily_allowance
    fuelings = []
    fuel_quantities = {}
    for fillup in fillup_records:
        fuel_type = fillup.get("fuel_type") or doc.get("fuel_type")
        if fuel_type not in FUEL_TYPES:
            raise HTTPException(400, "Combustível inválido no abastecimento")
        if vehicle_fuels and fuel_type not in vehicle_fuels:
            raise HTTPException(400, "Combustível do abastecimento não cadastrado para este veículo")
        fillup_unit = "m³" if fuel_type == "GNV" else "L"
        configured_fillup_price = (settings or {}).get("fuel_prices", {}).get(fuel_type, 0)
        try:
            default_fillup_price = price if fuel_type == doc.get("fuel_type") else configured_fillup_price
            fillup_price = float(fillup.get("price_per_unit") or fillup.get("price_per_liter") or default_fillup_price)
            amount = float(fillup.get("amount") or 0)
        except (TypeError, ValueError) as error:
            raise HTTPException(400, "Informe valores válidos para cada abastecimento") from error
        if not math.isfinite(fillup_price) or fillup_price < 0 or not math.isfinite(amount) or amount < 0:
            raise HTTPException(400, "Os valores dos abastecimentos devem ser não negativos")
        quantity = round(amount / fillup_price, 2) if fillup_price > 0 else 0
        fuel_quantities.setdefault(fuel_type, {"quantity": 0, "unit": fillup_unit})
        fuel_quantities[fuel_type]["quantity"] = round(fuel_quantities[fuel_type]["quantity"] + quantity, 2)
        fuelings.append({
            "amount": amount,
            "price_per_unit": fillup_price,
            "price_per_liter": fillup_price,
            "fuel_type": fuel_type,
            "quantity": quantity,
            "unit": fillup_unit,
            "liters": quantity if fillup_unit == "L" else 0,
        })
    doc["fuelings"] = fuelings
    doc["fuel_quantities"] = fuel_quantities
    fuel_consumption_by_type = {}
    if consumption > 0 and km > 0:
        remaining_km = km
        available_fuels = []
        if doc.get("fuel_type"):
            available_fuels.append(doc["fuel_type"])
        available_fuels.extend(
            fillup["fuel_type"] for fillup in fuelings
            if fillup["fuel_type"] not in available_fuels
        )
        for fuel_type in available_fuels:
            available_quantity = (
                estimated_quantity if not fuelings
                else fuel_quantities.get(fuel_type, {}).get("quantity", 0)
            )
            quantity_used = min(available_quantity, remaining_km / consumption)
            distance_covered = min(remaining_km, quantity_used * consumption)
            if quantity_used > 0:
                fuel_consumption_by_type[fuel_type] = {
                    "quantity": round(quantity_used, 2),
                    "unit": "m³" if fuel_type == "GNV" else "L",
                    "distance_km": round(distance_covered, 2),
                }
                remaining_km = max(remaining_km - distance_covered, 0)
    doc["fuel_consumption_by_type"] = fuel_consumption_by_type
    if fuelings:
        doc["fuel_cost"] = round(sum(float(fillup["amount"]) for fillup in fuelings), 2)
        selected_quantity = fuel_quantities.get(doc.get("fuel_type"), {}).get("quantity", 0)
        doc["fuel_quantity"] = selected_quantity
        doc["fuel_liters"] = selected_quantity if trip_fuel_unit == "L" else 0
        selected_cost = sum(fillup["amount"] for fillup in fuelings if fillup["fuel_type"] == doc.get("fuel_type"))
        if selected_quantity > 0:
            doc["fuel_price_per_unit"] = round(selected_cost / selected_quantity, 2)
            doc["fuel_price_per_liter"] = doc["fuel_price_per_unit"]
    else:
        doc["fuel_quantity"] = estimated_quantity
        doc["fuel_liters"] = estimated_quantity if trip_fuel_unit == "L" else 0
        if price > 0:
            doc["fuel_cost"] = round(estimated_quantity * price, 2)
    toll_records = doc.get("tolls") or []
    if not isinstance(toll_records, list) or any(not isinstance(toll, dict) for toll in toll_records):
        raise HTTPException(400, "A lista de pedágios é inválida")
    if toll_records:
        tolls = []
        for toll in toll_records:
            try:
                amount = float(toll.get("amount") or 0)
            except (TypeError, ValueError) as error:
                raise HTTPException(400, "Informe um valor válido para cada pedágio") from error
            if not math.isfinite(amount) or amount < 0:
                raise HTTPException(400, "Os valores dos pedágios devem ser não negativos")
            tolls.append({
                "description": toll.get("description") or "",
                "amount": amount,
            })
        doc["tolls"] = tolls
        doc["toll_cost"] = round(sum(toll["amount"] for toll in tolls), 2)
    return doc

async def _prepare_maintenance(doc: dict) -> dict:
    vehicle_id = doc.get("vehicle_id")
    if not vehicle_id:
        return doc
    vehicle = await db.vehicles.find_one(
        {"id": vehicle_id},
        {"_id": 0},
    )
    if not vehicle:
        raise HTTPException(400, "Veículo não encontrado")
    doc["vehicle_model"] = " · ".join(
        value for value in (vehicle.get("name"), vehicle.get("model")) if value
    )
    doc["plate"] = vehicle.get("plate") or ""
    doc["km"] = float(vehicle.get("current_km") or 0)
    return doc

async def _change_vehicle_km(vehicle_id: Optional[str], delta: float, *, required: bool = False):
    if not vehicle_id or not delta:
        return
    result = await db.vehicles.update_one({"id": vehicle_id}, {"$inc": {"current_km": delta}})
    if required and result.matched_count == 0:
        raise HTTPException(400, "Veículo não encontrado")

# ---------- Models ----------
class LoginIn(BaseModel):
    email: EmailStr
    password: str

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str = "vendedor"  # admin | vendedor | visualizador
    vendor_id: Optional[str] = None

class DashboardEventCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)
    event_date: str

class DashboardEventArchive(BaseModel):
    archived: bool

class UserRegister(BaseModel):
    email: EmailStr
    password: str
    name: str
    invite_code: str

class BootstrapAdmin(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=72)
    name: str = Field(min_length=1, max_length=120)

class AdminPasswordReset(BaseModel):
    email: EmailStr
    new_password: str = Field(min_length=12, max_length=72)

class InviteCreate(BaseModel):
    expires_in_days: int = Field(default=7, ge=1, le=30)

class PasswordChange(BaseModel):
    current_password: str
    new_password: str

class UserOut(BaseModel):
    id: str
    email: str
    name: str
    role: str

class Category(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    name: str
    color: str = "#4B5320"
    icon: str = "Package"
    parent_id: Optional[str] = None  # subcategoria
    size_grid: Optional[str] = None  # ROUPA | CALCADOS | NONE
    created_at: str = Field(default_factory=now_iso)

class SizeGrid(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    name: str
    sizes: List[str] = []
    active: bool = True

class Supplier(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    name: str
    cnpj: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    cep: Optional[str] = None
    address_number: Optional[str] = None
    address: Optional[str] = None
    distance_km: float = 0
    notes: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)

class ProductSize(BaseModel):
    size: str
    stock: float = 0
    stock_min: float = 0

class Product(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    name: str
    sku: str
    category_id: Optional[str] = None
    subcategory_id: Optional[str] = None
    color: Optional[str] = None
    brand: Optional[str] = None
    cost: float = 0
    price: float = 0
    commission: float = Field(default=1, ge=0, allow_inf_nan=False)
    shelf: Optional[str] = None
    photo: Optional[str] = None
    photo_url: Optional[str] = None
    sizes: List[ProductSize] = []
    linked_ids: List[str] = []  # componentes usados para montagem e desmontagem reversa
    created_at: str = Field(default_factory=now_iso)

class Customer(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    name: str  # Nome / Loja
    nome_guerra: Optional[str] = None
    cpf: Optional[str] = None
    patente_om: Optional[str] = None
    phone: Optional[str] = None
    cep: Optional[str] = None
    address_number: Optional[str] = None
    address: Optional[str] = None
    distance_km: float = 0
    signature: Optional[str] = None
    sizes_fit: Optional[str] = None
    total_spent: float = 0
    created_at: str = Field(default_factory=now_iso)

class CustomerDistanceInput(BaseModel):
    address: str = Field(min_length=3, max_length=500)
    cep: str = Field(min_length=8, max_length=9)

class OrderItem(BaseModel):
    product_id: str
    sku: Optional[str] = None
    name: str
    size: Optional[str] = None
    qty: float = 1
    unit_price: float = 0
    commission_value: float = Field(default=1, ge=0, allow_inf_nan=False)
    subtotal: float = 0

class ReturnItem(BaseModel):
    product_id: str
    sku: Optional[str] = None
    name: str
    size: Optional[str] = None
    qty: float = 1
    reason: Optional[str] = None

class Order(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    number: int = 0
    type: str = "VENDA"  # VENDA | TROCA | DEVOLUCAO | ORCAMENTO
    status: str = "Anotado"  # Anotado | Separado | Entregue | Retirado | Cancelado
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    vendor_id: Optional[str] = None
    vendor_name: Optional[str] = None
    items: List[OrderItem] = []
    returned_items: List[ReturnItem] = []  # for exibition on print
    exchanged_items: List[ReturnItem] = []
    original_order_id: Optional[str] = None  # for troca/dev vinculada
    avulsa: bool = False
    discount: float = 0
    total: float = 0
    payment: str = "PIX"
    notes: Optional[str] = None
    expected_date: Optional[str] = None
    vehicle_id: Optional[str] = None
    vehicle_name: Optional[str] = None
    delivery_type: Optional[str] = None  # ENTREGA | RETIRADA | CORREIO
    signature: Optional[str] = None
    whatsapp_shared_at: Optional[str] = None
    whatsapp_share_count: int = 0
    stock_applied: bool = False
    created_at: str = Field(default_factory=now_iso)
    log: List[str] = []  # log de desmontagem etc

class Vehicle(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    name: str
    model: Optional[str] = None
    plate: Optional[str] = None
    fuel_type: Optional[str] = None
    fuel_types: List[str] = []
    avg_consumption: float = 0
    current_km: float = 0
    active: bool = True
    created_at: str = Field(default_factory=now_iso)

class StockMovement(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    product_id: str
    product_name: str
    sku: Optional[str] = None
    size: Optional[str] = None
    qty: float = 0
    kind: str = "ENTRADA"  # ENTRADA | SAIDA | AVARIA | DESMONTAGEM | TROCA
    reason: Optional[str] = None
    nf: Optional[str] = None
    order_id: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)

class StockCountItem(BaseModel):
    product_id: str
    size: str
    quantity: float = Field(ge=0, allow_inf_nan=False)

class StockCountRequest(BaseModel):
    items: List[StockCountItem]

class TripDestination(BaseModel):
    destination_type: str
    destination_id: str
    name: Optional[str] = None
    address: Optional[str] = None
    distance_km: float = 0

class TripFueling(BaseModel):
    amount: float = Field(default=0, ge=0, allow_inf_nan=False)
    price_per_liter: float = Field(default=0, ge=0, allow_inf_nan=False)
    price_per_unit: Optional[float] = Field(default=None, ge=0, allow_inf_nan=False)
    fuel_type: Optional[str] = None

class TripToll(BaseModel):
    description: Optional[str] = None
    amount: float = Field(default=0, ge=0, allow_inf_nan=False)

class Expense(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    type: str = "INSUMO"  # INSUMO | VIAGEM | MANUTENCAO
    description: str
    amount: float = 0
    quantity: float = 0
    remaining_quantity: float = 0
    consumption_log: List[dict] = []
    unit: Optional[str] = None
    supplier_id: Optional[str] = None
    destination_type: Optional[str] = None
    destination_id: Optional[str] = None
    destinations: List[TripDestination] = []
    vehicle_id: Optional[str] = None
    vehicle_name: Optional[str] = None
    date: str = Field(default_factory=now_iso)
    # Viagem
    fuel_type: Optional[str] = None
    fuelings: List[TripFueling] = []
    fuel_cost: float = 0
    toll_cost: float = 0
    tolls: List[TripToll] = []
    daily_allowance: float = 0
    avg_consumption: Optional[float] = None
    fuel_liters: float = 0
    estimated_fuel_liters: float = 0
    fuel_price_per_liter: float = 0
    fuel_quantity: float = 0
    estimated_fuel_quantity: float = 0
    fuel_quantity_unit: str = "L"
    fuel_price_per_unit: float = 0
    fuel_quantities: dict = Field(default_factory=dict)
    fuel_consumption_by_type: dict = Field(default_factory=dict)
    km: float = 0
    odometer_km: Optional[float] = None
    day_close_date: Optional[str] = None
    route: Optional[str] = None
    # Manutencao
    plate: Optional[str] = None
    vehicle_model: Optional[str] = None
    next_review_date: Optional[str] = None

class Commission(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    order_id: str
    order_number: int
    vendor_id: Optional[str] = None
    vendor_name: Optional[str] = None
    items_count: int = 0
    amount: float = 0
    paid: bool = False
    created_at: str = Field(default_factory=now_iso)

class OrderNumberSequenceUpdate(BaseModel):
    current_number: int = Field(ge=0)

class DayClosureInput(BaseModel):
    vehicle_id: str
    current_km: float = Field(ge=0)

class ManualMontageInput(BaseModel):
    size: str
    qty: int = Field(default=1, ge=1)

class DataResetInput(BaseModel):
    groups: List[str]

class PushSubscriptionKeys(BaseModel):
    p256dh: str = Field(min_length=1, max_length=256)
    auth: str = Field(min_length=1, max_length=128)

class PushSubscriptionInput(BaseModel):
    endpoint: str = Field(min_length=1, max_length=2048)
    keys: PushSubscriptionKeys

class Settings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = "singleton"
    store_name: str = "LOKAL MILITAR"
    store_subtitle: str = "Fardas e Artigos Militares"
    store_full_name: str = "Lokal Comercio de Artigos do Vestuario LTDA"
    cnpj: str = "27.863.152/0001-74"
    phone: str = "(21) 00000-0000"
    instagram: str = "@lokalmilitar"
    address: str = DEFAULT_DEPOT_ADDRESS
    pix_key: str = ""
    fuel_prices: dict = Field(default_factory=lambda: DEFAULT_FUEL_PRICES.copy())
    background_color: str = "#F5F5F5"
    print_header_html: str = ""
    print_footer_text: str = "Obrigado pela preferência! - Lokal Militar"

ACTIVE_STATUSES = ("Anotado", "Aprovado", "Separado", "Entregue", "Retirado")

class Vendor(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    name: str
    phone: Optional[str] = None
    cpf: Optional[str] = None
    cep: Optional[str] = None
    address_number: Optional[str] = None
    address: Optional[str] = None
    distance_km: float = 0
    signature: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)

# ---------- Simple generic CRUD factory ----------
def make_crud(coll_name: str, Model, route_name: Optional[str] = None):
    router = APIRouter(prefix=f"/{route_name or coll_name}")

    @router.get("")
    async def list_all(user: dict = Depends(get_current_user)):
        projection = {"_id": 0, **({"signature": 0} if coll_name == "vendors" else {})}
        docs = await db[coll_name].find({}, projection).to_list(5000)
        return docs

    @router.post("")
    async def create(payload: dict, user: dict = Depends(get_current_user)):
        obj = Model(**payload)
        doc = obj.model_dump()
        if coll_name == "products":
            commission = float(doc.get("commission", 1))
            if not math.isfinite(commission) or commission < 0:
                raise HTTPException(400, "A comissão do produto deve ser um valor não negativo")
            doc["commission"] = commission
        if coll_name == "vehicles":
            fuel_types = doc.get("fuel_types") or ([doc["fuel_type"]] if doc.get("fuel_type") else [])
            if any(fuel_type not in FUEL_TYPES for fuel_type in fuel_types):
                raise HTTPException(400, "Combustível inválido")
            doc["fuel_types"] = fuel_types
            doc["fuel_type"] = fuel_types[0] if fuel_types else None
        if coll_name == "vendors" and doc.get("signature"):
            signature = doc["signature"]
            if not isinstance(signature, str) or not signature.startswith("data:image/png;base64,") or len(signature) > 1_500_000:
                raise HTTPException(400, "Assinatura do vendedor inválida")
        if coll_name == "expenses" and doc.get("type") == "INSUMO":
            if "remaining_quantity" not in payload:
                doc["remaining_quantity"] = max(float(doc.get("quantity") or 0), 0)
        if coll_name == "expenses" and doc.get("type") == "VIAGEM":
            doc = await _prepare_trip(doc)
        if coll_name == "expenses" and doc.get("type") == "MANUTENCAO":
            doc = await _prepare_maintenance(doc)
        await db[coll_name].insert_one(doc)
        if coll_name == "expenses" and doc.get("type") == "VIAGEM":
            await _change_vehicle_km(doc.get("vehicle_id"), float(doc.get("km") or 0), required=bool(doc.get("vehicle_id")))
        return strip_mongo(doc)

    @router.get("/{item_id}")
    async def get_one(item_id: str, user: dict = Depends(get_current_user)):
        doc = await db[coll_name].find_one({"id": item_id}, {"_id": 0})
        if not doc:
            raise HTTPException(404, "Not found")
        return doc

    @router.put("/{item_id}")
    async def update(item_id: str, payload: dict, user: dict = Depends(get_current_user)):
        payload.pop("id", None)
        if coll_name == "products" and "commission" in payload:
            try:
                commission = float(payload["commission"])
            except (TypeError, ValueError) as error:
                raise HTTPException(400, "Informe um valor válido para a comissão do produto") from error
            if not math.isfinite(commission) or commission < 0:
                raise HTTPException(400, "A comissão do produto deve ser um valor não negativo")
            payload["commission"] = commission
        if coll_name == "vehicles":
            current = await db.vehicles.find_one({"id": item_id}, {"_id": 0})
            if not current:
                raise HTTPException(404, "Not found")
            updated = {**current, **payload}
            fuel_types = updated.get("fuel_types") or ([updated["fuel_type"]] if updated.get("fuel_type") else [])
            if any(fuel_type not in FUEL_TYPES for fuel_type in fuel_types):
                raise HTTPException(400, "Combustível inválido")
            payload["fuel_types"] = fuel_types
            payload["fuel_type"] = fuel_types[0] if fuel_types else None
        if coll_name == "vendors" and payload.get("signature"):
            signature = payload["signature"]
            if not isinstance(signature, str) or not signature.startswith("data:image/png;base64,") or len(signature) > 1_500_000:
                raise HTTPException(400, "Assinatura do vendedor inválida")
        old = None
        if coll_name == "expenses":
            old = await db.expenses.find_one({"id": item_id}, {"_id": 0})
            if not old:
                raise HTTPException(404, "Not found")
            updated = {**old, **payload}
            if updated.get("type") == "VIAGEM":
                updated = await _prepare_trip(updated)
            if updated.get("type") == "MANUTENCAO" and (
                old.get("type") != "MANUTENCAO"
                or updated.get("vehicle_id") != old.get("vehicle_id")
            ):
                updated = await _prepare_maintenance(updated)
            elif updated.get("type") == "MANUTENCAO":
                for key in ("vehicle_model", "plate", "km"):
                    if key in old:
                        updated[key] = old[key]
            payload = {key: value for key, value in updated.items() if key != "id"}
        res = await db[coll_name].update_one({"id": item_id}, {"$set": payload})
        if res.matched_count == 0:
            raise HTTPException(404, "Not found")
        if coll_name == "expenses" and old:
            old_km = float(old.get("km") or 0) if old.get("type") == "VIAGEM" else 0
            new_km = float(payload.get("km") or 0) if payload.get("type") == "VIAGEM" else 0
            old_vehicle = old.get("vehicle_id") if old.get("type") == "VIAGEM" else None
            new_vehicle = payload.get("vehicle_id") if payload.get("type") == "VIAGEM" else None
            if old_vehicle == new_vehicle:
                await _change_vehicle_km(old_vehicle, new_km - old_km)
            else:
                await _change_vehicle_km(old_vehicle, -old_km)
                await _change_vehicle_km(new_vehicle, new_km)
        doc = await db[coll_name].find_one({"id": item_id}, {"_id": 0})
        return doc

    @router.delete("/{item_id}")
    async def delete(item_id: str, user: dict = Depends(get_current_user)):
        old = await db[coll_name].find_one({"id": item_id}, {"_id": 0}) if coll_name == "expenses" else None
        if coll_name == "vendors" and await db.users.find_one({"vendor_id": item_id}):
            raise HTTPException(400, "Desvincule o vendedor da conta de acesso antes de excluí-lo")
        res = await db[coll_name].delete_one({"id": item_id})
        if old and old.get("type") == "VIAGEM":
            await _change_vehicle_km(old.get("vehicle_id"), -float(old.get("km") or 0))
            await _refresh_day_closure(_business_date(old.get("date")), user)
        return {"deleted": res.deleted_count}

    return router

# ---------- Auth routes ----------
@api.get("/auth/mode")
async def auth_mode():
    return {"public_access": public_access_enabled()}

@api.post("/auth/login")
async def login(payload: LoginIn):
    user = await db.users.find_one({"email": payload.email.lower()})
    if not user or not verify_pw(payload.password, user.get("password_hash", "")):
        raise HTTPException(401, "Credenciais inválidas")
    auth_state = await db.auth_state.find_one({"_id": "global"})
    token = create_token(
        user["id"],
        user["email"],
        user.get("role", "vendedor"),
        auth_state.get("epoch") if auth_state else None,
    )
    user.pop("_id", None)
    user.pop("password_hash", None)
    return {"access_token": token, "token_type": "bearer", "user": user}

@api.post("/auth/register")
async def register_user(payload: UserRegister):
    if len(payload.password) < 8:
        raise HTTPException(400, "A senha deve ter pelo menos 8 caracteres")
    email = payload.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "E-mail já cadastrado")
    invite_hash = hashlib.sha256(payload.invite_code.strip().encode()).hexdigest()
    claimed_at = now_iso()
    stale_claim_before = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
    claim_is_available = {
        "$or": [
            {"claimed_at": {"$exists": False}},
            {"claimed_at": {"$lt": stale_claim_before}},
        ]
    }
    invite = await db.registration_invites.find_one({
        "code_hash": invite_hash,
        "revoked_at": {"$exists": False},
        "used_at": {"$exists": False},
        "expires_at": {"$gt": claimed_at},
        **claim_is_available,
    })
    if not invite:
        raise HTTPException(400, "Convite inválido, expirado ou já utilizado")
    claim = await db.registration_invites.update_one(
        {
            "id": invite["id"],
            "revoked_at": {"$exists": False},
            "used_at": {"$exists": False},
            "expires_at": {"$gt": claimed_at},
            **claim_is_available,
        },
        {"$set": {"claimed_at": claimed_at, "claimed_email": email}},
    )
    if claim.modified_count != 1:
        raise HTTPException(400, "Este convite já foi utilizado ou expirou")
    doc = {
        "id": new_id(),
        "email": email,
        "name": payload.name,
        "role": "visualizador",
        "pending": True,
        "password_hash": hash_pw(payload.password),
        "created_at": now_iso(),
    }
    try:
        await db.users.insert_one(doc)
        finalized = await db.registration_invites.update_one(
            {"id": invite["id"], "claimed_email": email, "used_at": {"$exists": False}, "revoked_at": {"$exists": False}},
            {"$set": {"used_at": now_iso(), "used_by": doc["id"]}, "$unset": {"claimed_at": "", "claimed_email": ""}},
        )
        if finalized.modified_count != 1:
            await db.users.delete_one({"id": doc["id"]})
            raise HTTPException(409, "Não foi possível confirmar o uso do convite")
    except HTTPException:
        raise
    except Exception:
        logging.exception("Falha ao criar usuário com convite %s", invite["id"])
        await db.registration_invites.update_one(
            {"id": invite["id"], "claimed_email": email, "used_at": {"$exists": False}},
            {"$unset": {"claimed_at": "", "claimed_email": ""}},
        )
        raise HTTPException(500, "Não foi possível concluir o cadastro")
    doc.pop("_id", None)
    doc.pop("password_hash", None)
    return doc

@api.post("/auth/bootstrap-admin")
async def bootstrap_admin(
    payload: BootstrapAdmin,
    bootstrap_token: str = Header(..., alias="X-Admin-Bootstrap-Token"),
):
    expected_token = os.environ.get("ADMIN_BOOTSTRAP_TOKEN", "")
    if len(expected_token) < 32:
        raise HTTPException(404, "Not found")
    if not secrets.compare_digest(bootstrap_token, expected_token):
        raise HTTPException(403, "Token inválido")
    if await db.users.count_documents({}) != 0:
        raise HTTPException(409, "A inicialização já foi concluída")

    lock_id = "initial-admin"
    try:
        await db.admin_bootstrap.insert_one({"_id": lock_id, "created_at": now_iso()})
    except DuplicateKeyError as exc:
        raise HTTPException(409, "A inicialização já foi iniciada") from exc

    try:
        if await db.users.count_documents({}) != 0:
            await db.admin_bootstrap.delete_one({"_id": lock_id})
            raise HTTPException(409, "A inicialização já foi concluída")
        name = payload.name.strip()
        if not name:
            await db.admin_bootstrap.delete_one({"_id": lock_id})
            raise HTTPException(422, "Informe um nome")
        email = str(payload.email).lower()
        doc = {
            "id": new_id(),
            "email": email,
            "name": name,
            "role": "admin",
            "password_hash": hash_pw(payload.password),
            "created_at": now_iso(),
        }
        await db.users.insert_one(doc)
    except HTTPException:
        raise
    except Exception:
        logging.exception("Falha ao criar o administrador inicial")
        await db.admin_bootstrap.delete_one({"_id": lock_id})
        raise HTTPException(500, "Não foi possível criar o administrador inicial")

    return {"id": doc["id"], "email": doc["email"], "name": doc["name"], "role": "admin"}

@api.post("/auth/reset-admin-password")
async def reset_admin_password(
    payload: AdminPasswordReset,
    reset_token: str = Header(..., alias="X-Admin-Reset-Token"),
):
    expected_token = os.environ.get("ADMIN_PASSWORD_RESET_TOKEN", "")
    if len(expected_token) < 32:
        raise HTTPException(404, "Not found")
    if not secrets.compare_digest(reset_token, expected_token):
        raise HTTPException(403, "Token inválido")

    admin = await db.users.find_one(
        {"email": str(payload.email).lower(), "role": "admin"},
        {"_id": 0, "id": 1, "email": 1},
    )
    if not admin:
        raise HTTPException(404, "Administrador não encontrado")

    lock_id = "initial-admin-password-reset"
    try:
        await db.admin_bootstrap.insert_one({"_id": lock_id, "created_at": now_iso()})
    except DuplicateKeyError as exc:
        raise HTTPException(409, "A redefinição já foi utilizada") from exc

    try:
        result = await db.users.update_one(
            {"id": admin["id"], "role": "admin"},
            {"$set": {"password_hash": hash_pw(payload.new_password)}},
        )
        if result.matched_count != 1:
            await db.admin_bootstrap.delete_one({"_id": lock_id})
            raise HTTPException(404, "Administrador não encontrado")
    except HTTPException:
        raise
    except Exception:
        logging.exception("Falha ao redefinir a senha do administrador")
        await db.admin_bootstrap.delete_one({"_id": lock_id})
        raise HTTPException(500, "Não foi possível redefinir a senha")

    return {"password_reset": True, "email": admin["email"]}

@api.post("/auth/invitations")
async def create_registration_invite(
    payload: InviteCreate,
    user: dict = Depends(require_admin),
):
    code = secrets.token_urlsafe(32)
    doc = {
        "id": new_id(),
        "code_hash": hashlib.sha256(code.encode()).hexdigest(),
        "created_by": user["id"],
        "created_at": now_iso(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=payload.expires_in_days)).isoformat(),
    }
    await db.registration_invites.insert_one(doc)
    return {
        "id": doc["id"],
        "code": code,
        "created_at": doc["created_at"],
        "expires_at": doc["expires_at"],
        "expires_in_days": payload.expires_in_days,
    }

@api.get("/auth/invitations")
async def list_registration_invites(user: dict = Depends(require_admin)):
    docs = await db.registration_invites.find({}, {"_id": 0, "code_hash": 0}).sort("created_at", -1).to_list(500)
    return docs

@api.delete("/auth/invitations/{invite_id}")
async def revoke_registration_invite(invite_id: str, user: dict = Depends(require_admin)):
    result = await db.registration_invites.update_one(
        {"id": invite_id, "used_at": {"$exists": False}, "revoked_at": {"$exists": False}},
        {"$set": {"revoked_at": now_iso(), "revoked_by": user["id"]}, "$unset": {"claimed_at": "", "claimed_email": ""}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Convite ativo não encontrado")
    return {"revoked": True}

@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user

@api.put("/auth/password")
async def change_password(payload: PasswordChange, user: dict = Depends(get_current_user)):
    stored_user = await db.users.find_one({"id": user["id"]})
    if not stored_user or not verify_pw(payload.current_password, stored_user.get("password_hash", "")):
        raise HTTPException(400, "Senha atual incorreta")
    if len(payload.new_password) < 8:
        raise HTTPException(400, "A nova senha deve ter pelo menos 8 caracteres")
    await db.users.update_one({"id": user["id"]}, {"$set": {"password_hash": hash_pw(payload.new_password)}})
    return {"changed": True}

@api.get("/auth/users")
async def list_users(user: dict = Depends(get_current_user)):
    docs = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(1000)
    return docs

@api.post("/auth/users")
async def create_user(payload: UserCreate, user: dict = Depends(require_admin)):
    if payload.role not in ("admin", "vendedor", "visualizador"):
        raise HTTPException(400, "Perfil inválido")
    if payload.vendor_id:
        if payload.role != "vendedor":
            raise HTTPException(400, "Somente usuários vendedores podem ser vinculados a um vendedor")
        if not await db.vendors.find_one({"id": payload.vendor_id}):
            raise HTTPException(400, "Vendedor não encontrado")
        if await db.users.find_one({"vendor_id": payload.vendor_id, "role": "vendedor"}):
            raise HTTPException(400, "Este vendedor já está vinculado a outro usuário")
    existing = await db.users.find_one({"email": payload.email.lower()})
    if existing:
        raise HTTPException(400, "Email já cadastrado")
    doc = {
        "id": new_id(),
        "email": payload.email.lower(),
        "name": payload.name,
        "role": payload.role,
        "vendor_id": (payload.vendor_id or None) if payload.role == "vendedor" else None,
        "pending": payload.role == "visualizador",
        "password_hash": hash_pw(payload.password),
        "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    doc.pop("_id", None)
    doc.pop("password_hash", None)
    return doc

@api.put("/auth/users/{uid}")
async def update_user(uid: str, payload: dict, user: dict = Depends(require_admin)):
    upd = {k: v for k, v in payload.items() if k in ("name", "role", "email", "vendor_id")}
    if "role" in upd and upd["role"] not in ("admin", "vendedor", "visualizador"):
        raise HTTPException(400, "Perfil inválido")
    target_user = await db.users.find_one({"id": uid}, {"_id": 0, "role": 1})
    if not target_user:
        raise HTTPException(404, "Usuário não encontrado")
    target_role = upd.get("role", target_user.get("role"))
    if "vendor_id" in upd and upd["vendor_id"]:
        if target_role != "vendedor":
            raise HTTPException(400, "Somente usuários vendedores podem ser vinculados a um vendedor")
        if not await db.vendors.find_one({"id": upd["vendor_id"]}):
            raise HTTPException(400, "Vendedor não encontrado")
        if await db.users.find_one({"vendor_id": upd["vendor_id"], "role": "vendedor", "id": {"$ne": uid}}):
            raise HTTPException(400, "Este vendedor já está vinculado a outro usuário")
    if "email" in upd:
        upd["email"] = str(upd["email"]).lower()
        duplicate = await db.users.find_one({"email": upd["email"], "id": {"$ne": uid}})
        if duplicate:
            raise HTTPException(400, "E-mail já cadastrado")
    if "role" in upd:
        upd["pending"] = upd["role"] == "visualizador"
        if upd["role"] != "vendedor":
            upd["vendor_id"] = None
    if payload.get("password"):
        if len(payload["password"]) < 8:
            raise HTTPException(400, "A senha deve ter pelo menos 8 caracteres")
        upd["password_hash"] = hash_pw(payload["password"])
    result = await db.users.update_one({"id": uid}, {"$set": upd})
    if result.matched_count == 0:
        raise HTTPException(404, "Usuário não encontrado")
    doc = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
    return doc

@api.delete("/auth/users/{uid}")
async def delete_user(uid: str, user: dict = Depends(require_admin)):
    if uid == user["id"]:
        raise HTTPException(400, "Não pode se auto-excluir")
    await db.users.delete_one({"id": uid})
    return {"deleted": 1}

# ---------- Mount generic CRUDs ----------
_nominatim_lock = threading.Lock()
_nominatim_last_request = 0.0

@lru_cache(maxsize=256)
def _geocode_address(address: str):
    global _nominatim_last_request
    with _nominatim_lock:
        wait = 1.0 - (time.monotonic() - _nominatim_last_request)
        if wait > 0:
            time.sleep(wait)
        try:
            response = requests.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": address, "format": "jsonv2", "limit": 1, "countrycodes": "br"},
                headers={"User-Agent": "LokalMilitar/1.0 (customer address distance lookup)"},
                timeout=10,
            )
            _nominatim_last_request = time.monotonic()
            response.raise_for_status()
            results = response.json()
        except RequestException as error:
            _nominatim_last_request = time.monotonic()
            raise HTTPException(503, "Serviço de localização indisponível") from error
        except ValueError as error:
            raise HTTPException(502, "Resposta inválida do serviço de localização") from error

    if not results:
        raise HTTPException(404, "Não foi possível localizar este endereço")
    try:
        return float(results[0]["lat"]), float(results[0]["lon"])
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(502, "Coordenadas inválidas no serviço de localização") from error

def _build_destination_geocoding_address(address: str, cep: str) -> str:
    cep_pattern = "".join(f"{digit}-?" for digit in cep)
    address_without_cep = re.sub(
        rf"\bCEP\s*[:\-]?\s*{cep_pattern}\b",
        "",
        address,
        flags=re.IGNORECASE,
    )
    address_without_cep = re.sub(r"\s*,\s*", ", ", address_without_cep).strip(" ,")
    return ", ".join(part for part in (address_without_cep, f"CEP {cep}", "Brasil") if part)

async def _geocode_for_distance(address: str, description: str):
    try:
        return await asyncio.to_thread(_geocode_address, address)
    except HTTPException as error:
        if error.status_code != 404:
            raise
        raise HTTPException(
            404,
            f"Não foi possível localizar {description}. Confira o endereço e o CEP.",
        ) from error

@api.get("/customers/cep/{cep}")
async def lookup_customer_cep(cep: str, user: dict = Depends(get_current_user)):
    normalized_cep = "".join(character for character in cep if character.isdigit())
    if len(normalized_cep) != 8:
        raise HTTPException(400, "Informe um CEP válido com 8 dígitos")
    try:
        response = await asyncio.to_thread(
            requests.get, f"https://viacep.com.br/ws/{normalized_cep}/json/", timeout=8
        )
        response.raise_for_status()
        data = response.json()
    except RequestException as error:
        raise HTTPException(503, "Não foi possível consultar o CEP agora") from error
    except ValueError as error:
        raise HTTPException(502, "Resposta inválida ao consultar o CEP") from error
    if data.get("erro"):
        raise HTTPException(404, "CEP não encontrado")
    return {
        "cep": normalized_cep,
        "logradouro": data.get("logradouro", ""),
        "bairro": data.get("bairro", ""),
        "localidade": data.get("localidade", ""),
        "uf": data.get("uf", ""),
    }

@api.post("/customers/distance")
async def calculate_customer_distance(payload: CustomerDistanceInput, user: dict = Depends(get_current_user)):
    cep = "".join(character for character in payload.cep if character.isdigit())
    if len(cep) != 8:
        raise HTTPException(400, "Informe um CEP válido com 8 dígitos")
    destination_address = _build_destination_geocoding_address(payload.address, cep)
    origin, destination = await asyncio.gather(
        _geocode_for_distance("Rua Salustiano Silva, 550, Rio de Janeiro, RJ, Brasil", "o endereço do depósito"),
        _geocode_for_distance(destination_address, "o endereço informado"),
    )
    coordinates = f"{origin[1]},{origin[0]};{destination[1]},{destination[0]}"
    try:
        response = await asyncio.to_thread(
            requests.get,
            f"https://router.project-osrm.org/route/v1/driving/{coordinates}",
            params={"overview": "false", "steps": "false"},
            timeout=15,
        )
        response.raise_for_status()
        route_data = response.json()
    except RequestException as error:
        raise HTTPException(503, "Serviço de cálculo de rotas indisponível") from error
    except ValueError as error:
        raise HTTPException(502, "Resposta inválida ao calcular a rota") from error
    routes = route_data.get("routes", [])
    if route_data.get("code") != "Ok" or not routes:
        raise HTTPException(404, "Não foi possível calcular uma rota para este endereço")
    try:
        distance_km = float(routes[0]["distance"]) / 1000
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(502, "Distância inválida na resposta do serviço de rotas") from error
    if not math.isfinite(distance_km) or distance_km < 0:
        raise HTTPException(502, "Distância inválida na resposta do serviço de rotas")
    return {"distance_km": round(distance_km, 1)}

api.include_router(make_crud("categories", Category))
api.include_router(make_crud("size_grids", SizeGrid))
api.include_router(make_crud("suppliers", Supplier))
api.include_router(make_crud("customers", Customer))
api.include_router(make_crud("vehicles", Vehicle))
api.include_router(make_crud("vehicles", Vehicle, route_name="auto"))
api.include_router(make_crud("expenses", Expense))
api.include_router(make_crud("vendors", Vendor))

@api.post("/expenses/{expense_id}/consume")
async def consume_supply(expense_id: str, payload: dict, user: dict = Depends(get_current_user)):
    quantity = float(payload.get("quantity") or 0)
    if quantity <= 0:
        raise HTTPException(400, "Informe uma quantidade maior que zero")
    expense = await db.expenses.find_one({"id": expense_id})
    if not expense or expense.get("type") != "INSUMO":
        raise HTTPException(404, "Insumo não encontrado")
    remaining = float(expense.get("remaining_quantity") or 0)
    if quantity > remaining:
        raise HTTPException(400, f"Quantidade indisponível. Restam {remaining:g} {expense.get('unit') or ''}".strip())
    result = await db.expenses.update_one(
        {"id": expense_id, "remaining_quantity": {"$gte": quantity}},
        {"$inc": {"remaining_quantity": -quantity},
         "$push": {"consumption_log": {"quantity": quantity, "date": now_iso(), "user_id": user["id"], "user_name": user.get("name")}}},
    )
    if result.matched_count == 0:
        raise HTTPException(409, "O saldo do insumo foi alterado. Atualize a página e tente novamente")
    return await db.expenses.find_one({"id": expense_id}, {"_id": 0})

# ---------- Products (custom to validate kit) ----------
@api.get("/products")
async def list_products(user: dict = Depends(get_current_user)):
    return await db.products.find({}, {"_id": 0, "photo": 0}).to_list(5000)

@api.get("/products/{pid}")
async def get_product(pid: str, user: dict = Depends(get_current_user)):
    product = await db.products.find_one({"id": pid}, {"_id": 0})
    if not product:
        raise HTTPException(404, "Produto não encontrado")
    return product

@api.get("/products/{pid}/photo")
async def get_product_photo(pid: str, user: dict = Depends(get_current_user)):
    product = await db.products.find_one(
        {"id": pid}, {"_id": 0, "photo": 1}
    )
    if not product:
        raise HTTPException(404, "Produto não encontrado")
    if not product.get("photo"):
        raise HTTPException(404, "Produto sem foto")
    return {"photo": product["photo"]}

def validate_product_photo_url(photo_url: Optional[str]) -> Optional[str]:
    if not photo_url:
        return photo_url
    if len(photo_url) > 2048:
        raise HTTPException(400, "O link da foto não pode exceder 2048 caracteres")
    try:
        parsed_url = urlsplit(photo_url)
        if (
            parsed_url.scheme not in {"http", "https"}
            or not parsed_url.hostname
            or parsed_url.username
            or parsed_url.password
        ):
            raise ValueError("Invalid image URL")
    except ValueError as error:
        raise HTTPException(400, "Informe um link público de imagem começando com http:// ou https://") from error
    return photo_url

@api.post("/products")
async def create_product(payload: dict, user: dict = Depends(get_current_user)):
    if validate_product_photo_url(payload.get("photo_url")):
        payload["photo"] = None
    obj = Product(**payload)
    doc = obj.model_dump()
    await db.products.insert_one(doc)
    return strip_mongo(doc)

@api.put("/products/{pid}")
async def update_product(pid: str, payload: dict, user: dict = Depends(get_current_user)):
    payload.pop("id", None)
    if "photo_url" in payload:
        if validate_product_photo_url(payload["photo_url"]):
            payload["photo"] = None
    await db.products.update_one({"id": pid}, {"$set": payload})
    return await db.products.find_one({"id": pid}, {"_id": 0})

@api.delete("/products/{pid}")
async def delete_product(pid: str, user: dict = Depends(get_current_user)):
    await db.products.delete_one({"id": pid})
    return {"deleted": 1}

async def _change_stock(product_id: str, size: Optional[str], delta: float, prevent_negative: bool = False):
    """Adjust product size stock by delta (positive=add, negative=subtract)."""
    size_key = size if size is not None else "-"
    size_filter = {"size": size_key}
    if prevent_negative and delta < 0:
        size_filter["stock"] = {"$gte": -delta}
    size_query = (
        {"sizes": {"$elemMatch": size_filter}}
        if prevent_negative and delta < 0
        else {"sizes.size": size_key}
    )
    result = await db.products.update_one(
        {"id": product_id, **size_query},
        {"$inc": {"sizes.$.stock": delta}},
    )
    if result.matched_count:
        return True

    if delta >= 0 or not prevent_negative:
        result = await db.products.update_one(
            {"id": product_id, "sizes.size": {"$ne": size_key}},
            {"$push": {"sizes": {"size": size_key, "stock": delta, "stock_min": 0}}},
        )
        if result.matched_count:
            return True

    # Another request may have added this size between the two atomic updates.
    result = await db.products.update_one(
        {"id": product_id, **size_query},
        {"$inc": {"sizes.$.stock": delta}},
    )
    if result.matched_count:
        return True
    raise HTTPException(409, f"Não foi possível atualizar o estoque do produto {product_id}")

async def _stock_of(product_id: str, size: Optional[str]) -> float:
    p = await db.products.find_one({"id": product_id})
    if not p:
        return 0
    size_key = size if size is not None else "-"
    for s in p.get("sizes", []):
        if s.get("size") == size_key:
            return float(s.get("stock", 0))
    return 0

async def _log_mov(prod: dict, size, qty, kind, reason, order_id=None):
    await db.stock_movements.insert_one({
        "id": new_id(), "product_id": prod["id"], "product_name": prod.get("name"),
        "sku": prod.get("sku"), "size": size,
        "stock_size": size if size is not None else "-", "qty": qty, "kind": kind,
        "reason": reason, "order_id": order_id, "created_at": now_iso()
    })

async def _desmontar(parent: dict, size, reason: str, order_id=None, prevent_negative: bool = False) -> List[str]:
    """Remove 1 parent unit of `size` and add 1 of each linked product of the same size."""
    await _change_stock(parent["id"], size, -1, prevent_negative=prevent_negative)
    await _log_mov(parent, size, 1, "DESMONTAGEM_SAIDA", reason, order_id)
    names = []
    for cid in parent.get("linked_ids", []):
        child = await db.products.find_one({"id": cid}, {"_id": 0})
        if not child:
            continue
        await _change_stock(cid, size, 1)
        await _log_mov(child, size, 1, "DESMONTAGEM_ENTRADA", f"Desmontagem de {parent.get('name')} {size}", order_id)
        names.append(child.get("name"))
    return names

async def _montar(parent: dict, size, reason: str) -> List[str]:
    """Remove one of each linked component and add one assembled parent unit."""
    component_ids = parent.get("linked_ids") or []
    if not component_ids:
        raise HTTPException(400, "Produto sem vínculos para montagem")
    if len(component_ids) != len(set(component_ids)):
        raise HTTPException(400, "O produto possui componentes vinculados duplicados")

    components = []
    for component_id in component_ids:
        component = await db.products.find_one({"id": component_id}, {"_id": 0})
        if not component:
            raise HTTPException(400, f"Produto vinculado não encontrado: {component_id}")
        if not any(item.get("size") == size for item in component.get("sizes", [])):
            raise HTTPException(
                400,
                f"Tamanho {size} não cadastrado no componente {component.get('name')}",
            )
        available = await _stock_of(component_id, size)
        if available < 1:
            raise HTTPException(
                400,
                f"Estoque insuficiente de {component.get('name')} tamanho {size}",
            )
        components.append(component)

    if not any(item.get("size") == size for item in parent.get("sizes", [])):
        raise HTTPException(400, f"Tamanho {size} não cadastrado no produto {parent.get('name')}")

    for component in components:
        await _change_stock(component["id"], size, -1)
        await _log_mov(
            component,
            size,
            1,
            "MONTAGEM_SAIDA",
            f"Montagem de {parent.get('name')} {size}",
        )
    await _change_stock(parent["id"], size, 1)
    await _log_mov(parent, size, 1, "MONTAGEM_ENTRADA", reason)
    return [component.get("name") for component in components]

async def _cover_shortage(prod: dict, size, qty: float, order: dict, log: List[str]):
    """If stock is insufficient, disassemble linked parent products of the same size."""
    missing = qty - await _stock_of(prod["id"], size)
    if missing <= 0:
        return
    parents = await db.products.find({"linked_ids": prod["id"]}, {"_id": 0}).to_list(100)
    for parent in parents:
        while missing > 0 and await _stock_of(parent["id"], size) > 0:
            names = await _desmontar(
                parent,
                size,
                f"Desmontagem automática p/ pedido #{order.get('number')}",
                order["id"],
                prevent_negative=True,
            )
            log.append(f"{parent.get('name')} {size} desmontada → +1 {' / +1 '.join(names)}")
            missing -= 1
        if missing <= 0:
            break


# ---------- Stock movements ----------
def _stock_movement_delta(movement: dict) -> float:
    qty = abs(float(movement.get("qty", 0)))
    if movement.get("kind") in ("ENTRADA", "DESMONTAGEM_ENTRADA", "DESMONTAGEM_INV", "MONTAGEM_ENTRADA"):
        return qty
    return -qty

def _movement_stock_size(movement: dict):
    if movement.get("stock_size") is not None:
        return movement["stock_size"]
    return movement.get("size") or "-"

@api.get("/stock_movements")
async def list_stock(user: dict = Depends(get_current_user)):
    return await db.stock_movements.find({}, {"_id": 0}).sort("created_at", -1).to_list(5000)

@api.post("/stock_movements")
async def create_stock(payload: dict, user: dict = Depends(get_current_user)):
    obj = StockMovement(**payload)
    doc = obj.model_dump()
    if doc["qty"] <= 0:
        raise HTTPException(400, "A quantidade deve ser maior que zero")
    if doc["kind"] not in ("ENTRADA", "SAIDA", "AVARIA"):
        raise HTTPException(400, "Tipo de movimentação inválido")
    if doc["order_id"]:
        raise HTTPException(400, "Movimentações de pedidos devem ser removidas pelo próprio pedido")
    product = await db.products.find_one({"id": doc["product_id"]}, {"_id": 0})
    if not product:
        raise HTTPException(404, "Produto não encontrado")
    if product.get("sizes") and not any(size.get("size") == doc.get("size") for size in product["sizes"]):
        raise HTTPException(400, "Tamanho não cadastrado para este produto")
    doc["stock_size"] = doc.get("size") if doc.get("size") is not None else "-"
    await db.stock_movements.insert_one(doc)
    delta = _stock_movement_delta(doc)
    await _change_stock(doc["product_id"], doc.get("size"), delta)
    return strip_mongo(doc)

@api.post("/stock_movements/reconcile")
async def reconcile_stock(payload: StockCountRequest, user: dict = Depends(get_current_user)):
    if not payload.items:
        raise HTTPException(400, "Informe ao menos uma quantidade para conferência")

    seen_items = set()
    validated_items = []
    for item in payload.items:
        key = (item.product_id, item.size)
        if key in seen_items:
            raise HTTPException(400, "O mesmo produto e tamanho foi informado mais de uma vez")
        seen_items.add(key)

        product = await db.products.find_one({"id": item.product_id}, {"_id": 0})
        if not product:
            raise HTTPException(404, f"Produto não encontrado: {item.product_id}")
        size = next((entry for entry in product.get("sizes", []) if entry.get("size") == item.size), None)
        if size is None:
            raise HTTPException(400, f"Tamanho {item.size} não cadastrado para {product.get('name')}")
        current_quantity = float(size.get("stock", 0))
        validated_items.append((item, product, current_quantity))

    updated = 0
    for item, product, current_quantity in validated_items:
        difference = item.quantity - current_quantity
        if difference == 0:
            continue

        result = await db.products.update_one(
            {
                "id": item.product_id,
                "sizes": {"$elemMatch": {"size": item.size, "stock": current_quantity}},
            },
            {"$set": {"sizes.$.stock": item.quantity}},
        )
        if not result.matched_count:
            raise HTTPException(
                409,
                f"O estoque de {product.get('name')} tamanho {item.size} mudou durante a conferência. "
                f"{updated} ajuste(s) anterior(es) já foram aplicados; atualize os dados e confira novamente.",
            )

        await db.stock_movements.insert_one({
            "id": new_id(),
            "product_id": product["id"],
            "product_name": product.get("name"),
            "sku": product.get("sku"),
            "size": item.size,
            "stock_size": item.size,
            "qty": abs(difference),
            "kind": "ENTRADA" if difference > 0 else "SAIDA",
            "reason": "Ajuste por conferência de estoque",
            "order_id": None,
            "created_at": now_iso(),
        })
        updated += 1

    return {"updated": updated}

@api.delete("/stock_movements/{mid}")
async def del_stock(mid: str, user: dict = Depends(get_current_user)):
    movement = await db.stock_movements.find_one({"id": mid})
    if not movement:
        raise HTTPException(404, "Movimentação não encontrada")
    if movement.get("order_id"):
        raise HTTPException(400, "Exclua o pedido relacionado para estornar esta movimentação")
    await _change_stock(
        movement["product_id"],
        _movement_stock_size(movement),
        -_stock_movement_delta(movement),
    )
    await db.stock_movements.delete_one({"id": mid})
    return {"deleted": 1}

@api.post("/products/{pid}/desmontar")
async def desmontar_manual(pid: str, payload: dict, user: dict = Depends(get_current_user)):
    size = payload.get("size")
    qty = int(payload.get("qty") or 1)
    p = await db.products.find_one({"id": pid}, {"_id": 0})
    if not p or not p.get("linked_ids"):
        raise HTTPException(400, "Produto sem vínculos de desmontagem")
    if await _stock_of(pid, size) < qty:
        raise HTTPException(400, f"Estoque insuficiente de {p.get('name')} tamanho {size}")
    for _ in range(qty):
        await _desmontar(p, size, "Desmontagem manual")
    return {"ok": True}

@api.post("/products/{pid}/montar")
async def montar_manual(
    pid: str,
    payload: ManualMontageInput,
    user: dict = Depends(get_current_user),
):
    size = payload.size
    qty = payload.qty
    product = await db.products.find_one({"id": pid}, {"_id": 0})
    if not product:
        raise HTTPException(404, "Produto não encontrado")
    if not product.get("linked_ids"):
        raise HTTPException(400, "Produto sem vínculos para montagem")
    if not size:
        raise HTTPException(400, "Selecione um tamanho")
    if not any(item.get("size") == size for item in product.get("sizes", [])):
        raise HTTPException(400, f"Tamanho {size} não cadastrado no produto {product.get('name')}")
    for component_id in product["linked_ids"]:
        component = await db.products.find_one({"id": component_id}, {"_id": 0})
        if not component:
            raise HTTPException(400, f"Produto vinculado não encontrado: {component_id}")
        if not any(item.get("size") == size for item in component.get("sizes", [])):
            raise HTTPException(
                400,
                f"Tamanho {size} não cadastrado no componente {component.get('name')}",
            )
        if await _stock_of(component_id, size) < qty:
            raise HTTPException(
                400,
                f"Estoque insuficiente de {component.get('name')} tamanho {size} para montar {qty} unidade(s)",
            )

    for _ in range(qty):
        await _montar(product, size, "Montagem manual")
    return {"ok": True}

# ---------- Orders ----------
async def _next_order_number() -> int:
    counter = await db.counters.find_one_and_update(
        {"_id": "orders"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    if not counter:
        return 1
    return int(counter.get("seq") or 1)

async def _current_order_number() -> int:
    counter = await db.counters.find_one({"_id": "orders"}, {"seq": 1})
    latest_order = await db.orders.find_one({}, {"number": 1}, sort=[("number", -1)])
    return max(
        int((counter or {}).get("seq") or 0),
        int((latest_order or {}).get("number") or 0),
    )

async def _rollback_order_number_if_latest(order: dict) -> None:
    number = int(order.get("number") or 0)
    if number > 0:
        await db.counters.update_one(
            {"_id": "orders", "seq": number},
            {"$inc": {"seq": -1}},
        )

@api.get("/orders/number-sequence")
async def get_order_number_sequence(user: dict = Depends(require_admin)):
    return {"current_number": await _current_order_number()}

@api.put("/orders/number-sequence")
async def update_order_number_sequence(
    payload: OrderNumberSequenceUpdate,
    user: dict = Depends(require_admin),
):
    current_number = await _current_order_number()
    if payload.current_number < current_number:
        raise HTTPException(400, f"O número não pode ser menor que o número atual ({current_number})")
    await db.counters.update_one(
        {"_id": "orders"},
        {"$max": {"seq": payload.current_number}},
        upsert=True,
    )
    return {"current_number": await _current_order_number()}

async def _validate_order_stock(order: dict):
    items = order.get("items", []) + order.get("returned_items", [])
    product_ids = list(dict.fromkeys(item.get("product_id") for item in items if item.get("product_id")))
    products = await db.products.find(
        {"id": {"$in": product_ids}},
        {"_id": 0},
    ).to_list(len(product_ids)) if product_ids else []
    products_by_id = {product["id"]: product for product in products}
    for item in items:
        if not item.get("product_id"):
            raise HTTPException(400, "Selecione um produto para todos os itens do pedido")
        quantity = float(item.get("qty", 1))
        if quantity <= 0:
            raise HTTPException(400, "A quantidade dos itens deve ser maior que zero")
        product = products_by_id.get(item.get("product_id"))
        if not product:
            raise HTTPException(400, f"Produto do pedido não encontrado: {item.get('name') or item.get('product_id')}")
        sizes = product.get("sizes", [])
        if sizes and not any(size.get("size") == item.get("size") for size in sizes):
            raise HTTPException(400, f"Tamanho não cadastrado para {product.get('name')}")
    return products_by_id

async def _validate_order_stock_availability(order: dict, exclude_order_id: Optional[str] = None):
    products_by_id = await _validate_order_stock(order)
    sales = order.get("items", [])
    product_ids = list(products_by_id)
    parents = await db.products.find(
        {"linked_ids": {"$in": product_ids}},
        {"_id": 0},
    ).to_list(10000) if product_ids else []
    inventory = {}
    for product in [*products_by_id.values(), *parents]:
        for size in product.get("sizes", []):
            size_key = size.get("size") if size.get("size") is not None else "-"
            inventory.setdefault((product["id"], size_key), float(size.get("stock", 0)))

    if exclude_order_id:
        movements = await db.stock_movements.find({"order_id": exclude_order_id}).to_list(10000)
        for movement in movements:
            key = (movement.get("product_id"), _movement_stock_size(movement))
            if key in inventory:
                inventory[key] -= _stock_movement_delta(movement)

    for item in sales:
        product_id = item["product_id"]
        size = item.get("size")
        quantity = float(item.get("qty", 1))
        key = (product_id, size if size is not None else "-")
        available = inventory.get(key, 0)
        missing = quantity - available
        if missing > 0:
            for parent in parents:
                if product_id not in parent.get("linked_ids", []):
                    continue
                parent_key = (parent["id"], key[1])
                while missing > 0 and inventory.get(parent_key, 0) > 0:
                    inventory[parent_key] -= 1
                    inventory[key] = inventory.get(key, 0) + 1
                    missing -= 1
                if missing <= 0:
                    break
        available = inventory.get(key, 0)
        if available < quantity:
            product = products_by_id[product_id]
            raise HTTPException(
                400,
                f"Estoque insuficiente para {product.get('name')} "
                f"(tamanho {size or '-'}): disponível {max(available, 0):g}, "
                f"solicitado {quantity:g}",
            )
        inventory[key] = available - quantity

async def _snapshot_order_commissions(items: list, previous_items: Optional[list] = None) -> list:
    product_ids = list(dict.fromkeys(item.get("product_id") for item in items if item.get("product_id")))
    products = await db.products.find(
        {"id": {"$in": product_ids}},
        {"_id": 0, "id": 1, "commission": 1},
    ).to_list(len(product_ids)) if product_ids else []
    product_commissions = {
        product["id"]: float(product.get("commission", 1) if product.get("commission") is not None else 1)
        for product in products
    }

    previous_commissions = {}
    for item in previous_items or []:
        key = (item.get("product_id"), item.get("size"))
        previous_commissions.setdefault(key, []).append(item.get("commission_value"))

    snapshots = []
    for item in items:
        key = (item.get("product_id"), item.get("size"))
        prior_values = previous_commissions.get(key, [])
        commission = prior_values.pop(0) if prior_values else None
        if commission is None:
            commission = product_commissions.get(item.get("product_id"), 1)
        snapshots.append({**item, "commission_value": float(commission)})
    return snapshots

async def _apply_order_stock(order: dict):
    """Decrement stock for VENDA/TROCA out items; add for DEVOLUCAO/returned items."""
    products_by_id = await _validate_order_stock(order)
    log = order.get("log", [])
    sales = order.get("items", [])
    sales_totals = {}
    for item in sales:
        key = (item["product_id"], item.get("size"))
        sales_totals[key] = sales_totals.get(key, 0) + float(item.get("qty", 1))

    enough_stock_without_disassembly = all(
        next(
            (float(size.get("stock", 0)) for size in products_by_id[product_id].get("sizes", []) if size.get("size") == size_name),
            0,
        ) >= quantity
        for (product_id, size_name), quantity in sales_totals.items()
    )
    if enough_stock_without_disassembly:
        for item in sales:
            product_id = item["product_id"]
            size = item.get("size")
            quantity = float(item.get("qty", 1))
            product = products_by_id[item["product_id"]]
            await _change_stock(product_id, size, -quantity, prevent_negative=True)
            await _log_mov(
                product,
                size,
                quantity,
                "SAIDA",
                f"{order.get('type')} pedido #{order.get('number')}",
                order["id"],
            )
    else:
        for item in sales:
            product_id = item["product_id"]
            size = item.get("size")
            quantity = float(item.get("qty", 1))
            product = products_by_id[product_id]
            await _cover_shortage(product, size, quantity, order, log)
            await _change_stock(product_id, size, -quantity, prevent_negative=True)
            await _log_mov(
                product,
                size,
                quantity,
                "SAIDA",
                f"{order.get('type')} pedido #{order.get('number')}",
                order["id"],
            )

    for ri in order.get("returned_items", []):
        pid = ri["product_id"]
        size = ri.get("size")
        qty = float(ri.get("qty", 1))
        prod = products_by_id[pid]
        await _change_stock(pid, size, qty)
        await db.stock_movements.insert_one({
            "id": new_id(), "product_id": pid,
            "product_name": prod.get("name"), "sku": prod.get("sku"),
            "size": size, "stock_size": size if size is not None else "-",
            "qty": qty, "kind": "ENTRADA",
            "reason": f"Devolução pedido #{order.get('number')} - {ri.get('reason') or ''}",
            "order_id": order["id"], "created_at": now_iso()
        })
    update = {"stock_applied": True}
    if log:
        update["log"] = log
    await db.orders.update_one(
        {"id": order["id"]},
        {"$set": update, "$unset": {"stock_application_started_at": ""}},
    )

async def _reverse_order_stock(order_id: str, mark_unapplied: bool = True):
    movements = await db.stock_movements.find({"order_id": order_id}).to_list(10000)
    for movement in movements:
        await _change_stock(
            movement["product_id"],
            _movement_stock_size(movement),
            -_stock_movement_delta(movement),
        )
    if movements:
        await db.stock_movements.delete_many({"order_id": order_id})
    if mark_unapplied:
        await db.orders.update_one(
            {"id": order_id},
            {"$set": {"stock_applied": False}, "$unset": {"stock_application_started_at": ""}},
        )

async def _cancel_order_stock(order_id: str):
    movements = await db.stock_movements.find({"order_id": order_id}).to_list(10000)
    legacy_blank_size_returns = [
        movement for movement in movements
        if movement.get("kind") == "ENTRADA"
        and movement.get("stock_size") is None
        and not movement.get("size")
    ]
    for movement in legacy_blank_size_returns:
        quantity = _stock_movement_delta(movement)
        await _change_stock(movement["product_id"], "-", -quantity)
        await _change_stock(movement["product_id"], "", quantity)
        await db.stock_movements.update_one(
            {"_id": movement["_id"]},
            {"$set": {"stock_size": ""}},
        )
    outbound_movements = [
        movement for movement in movements if movement.get("kind") != "ENTRADA"
    ]
    for movement in outbound_movements:
        await _change_stock(
            movement["product_id"],
            _movement_stock_size(movement),
            -_stock_movement_delta(movement),
        )
    if outbound_movements:
        await db.stock_movements.delete_many({
            "_id": {"$in": [movement["_id"] for movement in outbound_movements]}
        })
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {"stock_applied": False}, "$unset": {"stock_application_started_at": ""}},
    )

async def _has_order_stock_movements(order_id: str) -> bool:
    return await db.stock_movements.count_documents({"order_id": order_id}) > 0

async def _order_stock_movements_match(order: dict) -> bool:
    expected = {}
    for kind, field in (("SAIDA", "items"), ("ENTRADA", "returned_items")):
        for item in order.get(field, []):
            key = (kind, item.get("product_id"), item.get("size"))
            expected[key] = expected.get(key, 0) + float(item.get("qty", 1))

    actual = {}
    movements = await db.stock_movements.find(
        {"order_id": order["id"], "kind": {"$in": ["SAIDA", "ENTRADA"]}},
        {"_id": 0, "kind": 1, "product_id": 1, "size": 1, "stock_size": 1, "qty": 1},
    ).to_list(10000)
    for movement in movements:
        if movement.get("stock_size") is None and not movement.get("size"):
            return False
        key = (movement.get("kind"), movement.get("product_id"), movement.get("size"))
        actual[key] = actual.get(key, 0) + float(movement.get("qty", 0))

    return expected.keys() == actual.keys() and all(
        abs(expected[key] - actual[key]) < 1e-9 for key in expected
    )

async def _reset_incomplete_stock_application(order: dict) -> bool:
    if (
        not _order_should_apply_stock(order)
        or order.get("stock_applied") is not True
        or await _order_stock_movements_match(order)
    ):
        return False
    result = await db.orders.update_one(
        {"id": order["id"], "stock_applied": True},
        {"$set": {"stock_applied": False}, "$unset": {"stock_application_started_at": ""}},
    )
    return result.matched_count > 0

async def _sync_order_stock_to_status(order: dict):
    supported_order_type = order.get("type") in ("VENDA", "TROCA", "DEVOLUCAO")
    if order.get("status") == "Cancelado":
        if await _has_order_stock_movements(order["id"]) or order.get("stock_applied"):
            await _cancel_order_stock(order["id"])
        return
    if not _order_should_apply_stock(order) or not supported_order_type:
        if await _has_order_stock_movements(order["id"]):
            await _reverse_order_stock(order["id"])
        elif order.get("stock_applied"):
            await db.orders.update_one(
                {"id": order["id"]},
                {"$set": {"stock_applied": False}, "$unset": {"stock_application_started_at": ""}},
            )
        return

    if await _order_stock_movements_match(order):
        if order.get("stock_applied") is not True:
            await db.orders.update_one(
                {"id": order["id"], "stock_applied": order.get("stock_applied")},
                {"$set": {"stock_applied": True}, "$unset": {"stock_application_started_at": ""}},
            )
        return

    await _validate_order_stock_availability(order, exclude_order_id=order["id"])
    if order.get("stock_applied") is True:
        await _reset_incomplete_stock_application(order)
    if not await _claim_order_stock_application(order["id"]):
        raise HTTPException(409, "O estoque deste pedido está sendo atualizado; tente novamente")
    try:
        if await _has_order_stock_movements(order["id"]):
            await _reverse_order_stock(order["id"], mark_unapplied=False)
        await _apply_order_stock(order)
    except Exception:
        if await _has_order_stock_movements(order["id"]):
            await _reverse_order_stock(order["id"], mark_unapplied=False)
        await _release_order_stock_claim(order["id"])
        raise

async def _claim_order_stock_application(order_id: str) -> bool:
    stale_before = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat()
    result = await db.orders.update_one(
        {
            "id": order_id,
            "stock_applied": {"$ne": True},
            "$or": [
                {"stock_application_started_at": {"$exists": False}},
                {"stock_application_started_at": None},
                {"stock_application_started_at": {"$lte": stale_before}},
            ],
        },
        {"$set": {"stock_application_started_at": now_iso()}},
    )
    return result.matched_count > 0

async def _release_order_stock_claim(order_id: str):
    await db.orders.update_one(
        {"id": order_id, "stock_applied": {"$ne": True}},
        {"$unset": {"stock_application_started_at": ""}},
    )

def _order_is_fulfilled(order: dict) -> bool:
    return order.get("status") in ("Entregue", "Retirado")

def _order_should_apply_stock(order: dict) -> bool:
    return order.get("status") in ("Separado", "Entregue", "Retirado")

async def _refresh_day_closure(day: Optional[str], user: dict):
    if not day:
        return
    closure = await db.day_closures.find_one({"date": day}, {"_id": 0})
    if not closure:
        return
    report = await _build_day_closure(day, user, closure)
    await db.day_closures.update_one(
        {"date": day},
        {"$set": {
            "summary": report["summary"],
            "orders": report["orders"],
            "stock_movements": report["stock_movements"],
            "expenses": report["expenses"],
        }},
    )

async def _remove_order_delivery_trips(order_id: str, user: dict):
    trips = await db.expenses.find(
        {"order_id": order_id, "type": "VIAGEM"}
    ).to_list(100)
    trip_days = {
        day
        for day in (_business_date(trip.get("date")) for trip in trips)
        if day
    }
    for trip in trips:
        await _change_vehicle_km(
            trip.get("vehicle_id"), -float(trip.get("km") or 0)
        )
    if trips:
        await db.expenses.delete_many({"order_id": order_id, "type": "VIAGEM"})
    for day in trip_days:
        await _refresh_day_closure(day, user)

def _stock_relevant_order_fields(order: dict) -> dict:
    return {
        "type": order.get("type"),
        "items": [
            {key: item.get(key) for key in ("product_id", "size", "qty")}
            for item in order.get("items", [])
        ],
        "returned_items": [
            {key: item.get(key) for key in ("product_id", "size", "qty")}
            for item in order.get("returned_items", [])
        ],
    }

@api.get("/orders")
async def list_orders(user: dict = Depends(get_current_user)):
    return await db.orders.find(
        {}, {"_id": 0, "signature": 0}
    ).sort("created_at", -1).to_list(5000)

@api.get("/orders/{oid}")
async def get_order(oid: str, user: dict = Depends(get_current_user)):
    order = await db.orders.find_one({"id": oid}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Pedido não encontrado")
    return order

@api.post("/orders/{oid}/whatsapp-shared")
async def mark_order_whatsapp_shared(oid: str, user: dict = Depends(get_current_user)):
    result = await db.orders.update_one(
        {"id": oid},
        {"$set": {"whatsapp_shared_at": now_iso()}, "$inc": {"whatsapp_share_count": 1}},
    )
    if not result.matched_count:
        raise HTTPException(404, "Pedido não encontrado")
    return await db.orders.find_one({"id": oid}, {"_id": 0})

@api.post("/orders")
async def create_order(payload: dict, user: dict = Depends(get_current_user)):
    assigned_vendor_id = user.get("vendor_id") if user.get("role") == "vendedor" else None
    assigned_vendor = None
    if assigned_vendor_id:
        assigned_vendor = await db.vendors.find_one({"id": assigned_vendor_id}, {"_id": 0, "name": 1})
        if not assigned_vendor:
            raise HTTPException(400, "O vendedor vinculado a este usuário não existe mais")
    if payload.get("items") or payload.get("returned_items"):
        await _validate_order_stock(payload)
    if payload.get("items"):
        payload["items"] = await _snapshot_order_commissions(payload["items"])
    payload["number"] = await _next_order_number()
    if assigned_vendor_id:
        payload["vendor_id"] = assigned_vendor_id
        payload["vendor_name"] = assigned_vendor["name"]
    elif not payload.get("vendor_id"):
        payload["vendor_id"] = user["id"]
        payload["vendor_name"] = user.get("name")
    # compute totals
    items = payload.get("items", [])
    subtotal = sum(float(it.get("qty", 1)) * float(it.get("unit_price", 0)) for it in items)
    for it in items:
        it["subtotal"] = float(it.get("qty", 1)) * float(it.get("unit_price", 0))
    discount = float(payload.get("discount", 0))
    payload["total"] = max(0, subtotal - discount)
    obj = Order(**payload)
    doc = obj.model_dump()
    if doc["status"] == "Separado":
        doc["separated_at"] = now_iso()
    if _order_is_fulfilled(doc):
        raise HTTPException(400, "Conclua o pedido pela ação Entregar/Retirar")
    if _order_should_apply_stock(doc) and doc.get("type") in ("VENDA", "TROCA", "DEVOLUCAO"):
        await _validate_order_stock_availability(doc)
    if not doc.get("customer_id"):
        customer_name = str(doc.get("customer_name") or "").strip()
        if customer_name:
            customer = await db.customers.find_one(
                {"name": {"$regex": f"^{re.escape(customer_name)}$", "$options": "i"}},
                {"_id": 0},
            )
            if not customer:
                customer = Customer(name=customer_name).model_dump()
                await db.customers.insert_one(customer.copy())
            doc["customer_id"] = customer["id"]
            doc["customer_name"] = customer["name"]
    await db.orders.insert_one(doc)
    try:
        await _sync_order_stock_to_status(doc)
    except Exception:
        await db.orders.delete_one({"id": doc["id"]})
        raise
    if doc["status"] in ACTIVE_STATUSES and doc["type"] in ("VENDA",):
        await _record_commission(doc)
    return await db.orders.find_one({"id": doc["id"]}, {"_id": 0})

async def _update_order(oid: str, payload: dict, user: dict, allow_fulfillment: bool = False):
    old = await db.orders.find_one({"id": oid})
    if not old:
        raise HTTPException(404, "Pedido não encontrado")
    if (
        "status" in payload
        and payload["status"] != old.get("status")
        and not allow_fulfillment
        and user.get("role") != "admin"
    ):
        if _order_is_fulfilled(old):
            raise HTTPException(403, "Somente administradores podem alterar o status de um pedido concluído")
        if _order_is_fulfilled({"status": payload["status"]}):
            raise HTTPException(400, "Use a ação Entregar/Retirar para concluir o pedido")
    payload.pop("id", None)
    payload.pop("number", None)
    payload.pop("fulfilled_at", None)
    payload.pop("separated_at", None)
    payload.pop("stock_applied", None)
    items = payload.get("items", old.get("items", []))
    subtotal = sum(float(it.get("qty", 1)) * float(it.get("unit_price", 0)) for it in items)
    for it in items:
        it["subtotal"] = float(it.get("qty", 1)) * float(it.get("unit_price", 0))
    payload["items"] = items
    discount = float(payload.get("discount", old.get("discount", 0)))
    payload["total"] = max(0, subtotal - discount)
    candidate = {**old, **payload}
    if "items" in payload or "returned_items" in payload:
        await _validate_order_stock(candidate)
    if "items" in payload:
        payload["items"] = await _snapshot_order_commissions(items, old.get("items", []))
        candidate = {**old, **payload}
    stock_fields_changed_before_update = (
        _stock_relevant_order_fields(old) != _stock_relevant_order_fields(candidate)
    )
    if _order_is_fulfilled(candidate):
        if not _order_is_fulfilled(old) or stock_fields_changed_before_update:
            payload["fulfilled_at"] = now_iso()
    elif old.get("fulfilled_at") is not None:
        payload["fulfilled_at"] = None
    if candidate.get("status") == "Separado":
        if old.get("status") != "Separado":
            payload["separated_at"] = now_iso()
    elif old.get("separated_at") is not None:
        payload["separated_at"] = None
    if (
        _order_is_fulfilled(candidate)
        and candidate.get("type") in ("VENDA", "TROCA", "DEVOLUCAO")
    ):
        await _validate_order_stock(candidate)
    if (
        _order_should_apply_stock(candidate)
        and candidate.get("type") in ("VENDA", "TROCA", "DEVOLUCAO")
        and not await _order_stock_movements_match(candidate)
    ):
        await _validate_order_stock_availability(candidate, exclude_order_id=oid)
    if allow_fulfillment:
        update_result = await db.orders.update_one(
            {"id": oid, "status": old.get("status")},
            {"$set": payload},
        )
        if not update_result.matched_count:
            raise HTTPException(409, "O pedido foi alterado por outra operação; atualize a tela e tente novamente")
    else:
        await db.orders.update_one({"id": oid}, {"$set": payload})
    doc = await db.orders.find_one({"id": oid}, {"_id": 0})
    try:
        await _sync_order_stock_to_status(doc)
    except Exception:
        restore_fields = {key: old[key] for key in payload if key in old}
        unset_fields = {key: "" for key in payload if key not in old}
        rollback_filter = {"id": oid, **{key: doc.get(key) for key in payload}}
        rollback_update = {}
        if restore_fields:
            rollback_update["$set"] = restore_fields
        if unset_fields:
            rollback_update["$unset"] = unset_fields
        if rollback_update:
            rollback_result = await db.orders.update_one(rollback_filter, rollback_update)
            if not rollback_result.matched_count:
                raise HTTPException(
                    409,
                    "Não foi possível reverter a conclusão do pedido; atualize a tela e confira o status",
                )
        raise
    if _order_is_fulfilled(old) and not _order_is_fulfilled(doc):
        await _remove_order_delivery_trips(oid, user)
    doc = await db.orders.find_one({"id": oid}, {"_id": 0})
    if doc.get("type") == "VENDA":
        await _record_commission(doc)
    elif doc.get("type") in ("TROCA", "DEVOLUCAO"):
        original_order = await db.orders.find_one({"id": doc.get("original_order_id")}, {"_id": 0})
        if original_order and original_order.get("type") == "VENDA":
            await _record_commission(original_order)
    return doc

@api.put("/orders/{oid}")
async def update_order(oid: str, payload: dict, user: dict = Depends(get_current_user)):
    return await _update_order(oid, payload, user)

@api.post("/orders/{oid}/repair-stock")
async def repair_order_stock(oid: str, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(403, "Somente administradores podem corrigir baixas de estoque")
    order = await db.orders.find_one({"id": oid}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Pedido não encontrado")
    if not _order_is_fulfilled(order) or order.get("type") not in ("VENDA", "TROCA", "DEVOLUCAO"):
        raise HTTPException(400, "Somente pedidos concluídos podem ter a baixa corrigida")
    await _sync_order_stock_to_status(order)
    return await db.orders.find_one({"id": oid}, {"_id": 0})

@api.post("/orders/{oid}/sync-stock-status")
async def sync_order_stock_status(oid: str, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(403, "Somente administradores podem sincronizar o estoque dos pedidos")
    order = await db.orders.find_one({"id": oid}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Pedido não encontrado")
    await _sync_order_stock_to_status(order)
    return await db.orders.find_one({"id": oid}, {"_id": 0})

@api.post("/orders/{oid}/fulfill")
async def fulfill_order(oid: str, payload: dict, user: dict = Depends(get_current_user)):
    order = await db.orders.find_one({"id": oid}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Pedido não encontrado")
    if _order_is_fulfilled(order):
        raise HTTPException(400, "O pedido já foi entregue ou retirado")
    delivery_type = payload.get("delivery_type")
    if delivery_type not in ("ENTREGA", "RETIRADA", "CORREIO"):
        raise HTTPException(400, "Selecione entrega ou retirada")
    update = {
        "status": "Retirado" if delivery_type == "RETIRADA" else "Entregue",
        "delivery_type": delivery_type,
    }
    vehicle_id = payload.get("vehicle_id")
    if vehicle_id:
        vehicle = await db.vehicles.find_one({"id": vehicle_id, "active": {"$ne": False}}, {"_id": 0})
        if not vehicle:
            raise HTTPException(400, "Veículo não encontrado ou inativo")
        update.update({"vehicle_id": vehicle_id, "vehicle_name": vehicle["name"]})
    signature = payload.get("signature")
    if user.get("role") != "admin" and not signature:
        raise HTTPException(400, "Solicite a assinatura do cliente antes de concluir o pedido")
    if signature:
        if not isinstance(signature, str) or not signature.startswith("data:image/png;base64,") or len(signature) > 1_500_000:
            raise HTTPException(400, "Assinatura inválida")
        update["signature"] = signature
    completed = await _update_order(oid, update, user, allow_fulfillment=True)
    if signature and order.get("customer_id"):
        await db.customers.update_one({"id": order["customer_id"]}, {"$set": {"signature": signature}})
    if delivery_type == "ENTREGA":
        customer = await db.customers.find_one({"id": order.get("customer_id")}, {"_id": 0}) if order.get("customer_id") else None
        distance = max(float((customer or {}).get("distance_km") or 0), 0)
        trip = {
            "id": new_id(),
            "type": "VIAGEM",
            "description": f"Entrega do pedido #{order.get('number')}",
            "amount": 0,
            "quantity": 0,
            "remaining_quantity": 0,
            "date": now_iso(),
            "km": distance * 2,
            "route": f"Depósito → {(customer or {}).get('address') or order.get('customer_name') or 'Cliente'} → Depósito",
            "destination_type": "cliente" if customer else None,
            "destination_id": customer.get("id") if customer else None,
            "vehicle_id": completed.get("vehicle_id"),
            "vehicle_name": completed.get("vehicle_name"),
            "order_id": oid,
            "fuel_cost": 0,
            "fuel_liters": 0,
            "fuel_price_per_liter": 0,
            "toll_cost": 0,
            "avg_consumption": 0,
        }
        await _prepare_trip(trip)
        await db.expenses.insert_one(trip)
        await _change_vehicle_km(trip.get("vehicle_id"), float(trip.get("km") or 0))
        await _refresh_day_closure(_business_date(trip.get("date")), user)
    return completed

@api.delete("/orders/{oid}")
async def delete_order(oid: str, user: dict = Depends(get_current_user)):
    order = await db.orders.find_one({"id": oid})
    if not order:
        raise HTTPException(404, "Pedido não encontrado")
    if await _has_order_stock_movements(oid):
        await _reverse_order_stock(oid)
    await db.orders.delete_one({"id": oid})
    await _remove_order_delivery_trips(oid, user)
    await db.commissions.delete_many({"order_id": oid})
    if order.get("type") in ("TROCA", "DEVOLUCAO") and order.get("original_order_id"):
        original_order = await db.orders.find_one({"id": order["original_order_id"]}, {"_id": 0})
        if original_order and original_order.get("type") == "VENDA":
            await _record_commission(original_order)
    await _rollback_order_number_if_latest(order)
    return {"deleted": 1}

# ---------- Commissions ----------
async def _record_commission(order: dict):
    exists = await db.commissions.find_one({"order_id": order["id"]})
    if order.get("status") not in ACTIVE_STATUSES:
        if exists:
            await db.commissions.update_one(
                {"id": exists["id"]},
                {"$set": {"items_count": 0, "amount": 0}},
            )
        return

    items = order.get("items", [])
    returned_order_ids = []
    if _order_is_fulfilled(order):
        returned_order_ids.append(order["id"])
        linked_returns = await db.orders.find(
            {
                "original_order_id": order["id"],
                "type": {"$in": ["TROCA", "DEVOLUCAO"]},
            },
            {"_id": 0, "id": 1},
        ).to_list(5000)
        returned_order_ids.extend(item["id"] for item in linked_returns)

    returned_quantities = {}
    if returned_order_ids:
        movements = await db.stock_movements.find(
            {"order_id": {"$in": returned_order_ids}, "kind": "ENTRADA"},
            {"_id": 0, "product_id": 1, "size": 1, "qty": 1},
        ).to_list(10000)
        for movement in movements:
            key = (movement.get("product_id"), movement.get("size"))
            returned_quantities[key] = returned_quantities.get(key, 0) + float(movement.get("qty", 0))

    commission_items = 0
    amount = 0.0
    for item in items:
        quantity = max(float(item.get("qty", 1)), 0)
        key = (item.get("product_id"), item.get("size"))
        returned_quantity = min(quantity, returned_quantities.get(key, 0))
        returned_quantities[key] = max(returned_quantities.get(key, 0) - returned_quantity, 0)
        kept_quantity = quantity - returned_quantity
        commission_items += kept_quantity
        commission_value = float(item.get("commission_value", 1))
        amount += kept_quantity * commission_value

    values = {
        "items_count": int(commission_items),
        "amount": round(amount, 2),
    }
    if exists:
        await db.commissions.update_one({"id": exists["id"]}, {"$set": values})
        return

    com = {
        "id": new_id(),
        "order_id": order["id"],
        "order_number": order.get("number", 0),
        "vendor_id": order.get("vendor_id"),
        "vendor_name": order.get("vendor_name"),
        **values,
        "paid": False,
        "created_at": now_iso(),
    }
    await db.commissions.insert_one(com)

@api.get("/commissions")
async def list_commissions(user: dict = Depends(get_current_user)):
    return await db.commissions.find({}, {"_id": 0}).sort("created_at", -1).to_list(5000)

@api.put("/commissions/{cid}")
async def update_commission(cid: str, payload: dict, user: dict = Depends(get_current_user)):
    payload.pop("id", None)
    await db.commissions.update_one({"id": cid}, {"$set": payload})
    return await db.commissions.find_one({"id": cid}, {"_id": 0})

@api.post("/commissions/mark_paid")
async def mark_paid(payload: dict, user: dict = Depends(get_current_user)):
    ids = payload.get("ids", [])
    await db.commissions.update_many({"id": {"$in": ids}}, {"$set": {"paid": True}})
    return {"ok": True}

# ---------- Settings ----------
@api.get("/settings")
async def get_settings(user: dict = Depends(get_current_user)):
    doc = await db.settings.find_one({"id": "singleton"}, {"_id": 0})
    if not doc:
        s = Settings().model_dump()
        await db.settings.insert_one(s)
        return strip_mongo(s)
    if doc.get("address") == LEGACY_DEFAULT_DEPOT_ADDRESS:
        await db.settings.update_one({"id": "singleton"}, {"$set": {"address": DEFAULT_DEPOT_ADDRESS}})
        doc["address"] = DEFAULT_DEPOT_ADDRESS
    return doc

@api.put("/settings")
async def update_settings(payload: dict, user: dict = Depends(get_current_user)):
    if "fuel_prices" in payload:
        prices = payload["fuel_prices"]
        if not isinstance(prices, dict) or any(fuel not in FUEL_TYPES for fuel in prices):
            raise HTTPException(400, "Valores médios de combustível inválidos")
        try:
            normalized_prices = {fuel: float(price) for fuel, price in prices.items()}
        except (TypeError, ValueError):
            raise HTTPException(400, "Informe um preço válido para cada combustível")
        if any(not math.isfinite(price) or price < 0 for price in normalized_prices.values()):
            raise HTTPException(400, "Os preços dos combustíveis devem ser números não negativos")
        payload["fuel_prices"] = normalized_prices
    payload["id"] = "singleton"
    await db.settings.update_one({"id": "singleton"}, {"$set": payload}, upsert=True)
    return await db.settings.find_one({"id": "singleton"}, {"_id": 0})

def _google_frontend_redirect(result: str):
    frontend_url = os.environ.get("FRONTEND_URL", "").strip().rstrip("/")
    if not frontend_url:
        origins = [
            origin.strip().rstrip("/")
            for origin in os.environ.get("CORS_ORIGINS", "").split(",")
            if origin.strip() and origin.strip() != "*"
        ]
        frontend_url = origins[0] if origins else ""
    if not frontend_url:
        raise HTTPException(503, "Configure FRONTEND_URL para concluir a conexão Google")
    return RedirectResponse(f"{frontend_url}/configuracoes?google_calendar={result}")

async def _sync_google_calendar():
    if google_configuration_missing():
        raise RuntimeError("A conexão Google Agenda ainda não está configurada no servidor")
    async with _google_calendar_sync_lock:
        integration = await db.google_calendar_integrations.find_one({"_id": "primary"})
        if not integration or not integration.get("encrypted_token"):
            raise RuntimeError("Conecte uma conta Google Agenda antes de sincronizar")
        token = decrypt_token(integration["encrypted_token"])
        dashboard_events = await db.dashboard_events.find({}, {"_id": 0}).to_list(5000)
        expenses = await db.expenses.find(
            {"type": "MANUTENCAO"}, {"_id": 0}
        ).to_list(5000)
        orders = await db.orders.find({}, {"_id": 0}).to_list(5000)
        events = build_calendar_events(dashboard_events, expenses, orders)
        mappings = {
            document["_id"]: document
            async for document in db.google_calendar_event_mappings.find({})
        }
        refreshed_token, updated_mappings = await asyncio.to_thread(
            sync_calendar, token, events, mappings
        )
        for source_key, mapping in updated_mappings.items():
            await db.google_calendar_event_mappings.update_one(
                {"_id": source_key},
                {"$set": {
                    "event_id": mapping["event_id"],
                    "event_hash": mapping["event_hash"],
                    "updated_at": now_iso(),
                }},
                upsert=True,
            )
        stale_keys = [key for key in mappings if key not in updated_mappings]
        if stale_keys:
            await db.google_calendar_event_mappings.delete_many({"_id": {"$in": stale_keys}})
        sync_time = now_iso()
        await db.google_calendar_integrations.update_one(
            {"_id": "primary"},
            {"$set": {
                "encrypted_token": encrypt_token(refreshed_token),
                "last_sync_at": sync_time,
                "last_error": "",
            }},
        )
        return {"synced_events": len(updated_mappings), "last_sync_at": sync_time}

@api.get("/integrations/google-calendar/status")
async def google_calendar_status(user: dict = Depends(require_admin)):
    integration = await db.google_calendar_integrations.find_one({"_id": "primary"})
    return {
        "configured": not google_configuration_missing(),
        "missing_configuration": google_configuration_missing(),
        "connected": bool(integration and integration.get("encrypted_token")),
        "email": integration.get("email", "") if integration else "",
        "last_sync_at": integration.get("last_sync_at") if integration else None,
        "last_error": integration.get("last_error", "") if integration else "",
    }

@api.post("/integrations/google-calendar/connect")
async def google_calendar_connect(user: dict = Depends(require_admin)):
    missing = google_configuration_missing()
    if missing:
        raise HTTPException(503, f"Configuração do Google Agenda ausente no servidor: {', '.join(missing)}")
    state = secrets.token_urlsafe(32)
    await db.google_calendar_oauth_states.insert_one({
        "_id": state,
        "user_id": user["id"],
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
    })
    return {"authorization_url": oauth_authorization_url(state)}

@api.get("/integrations/google-calendar/callback", include_in_schema=False)
async def google_calendar_callback(request: Request):
    state = request.query_params.get("state", "")
    state_document = await db.google_calendar_oauth_states.find_one_and_delete({"_id": state}) if state else None
    valid_state = state_document and state_document.get("expires_at")
    if valid_state:
        expiry = state_document["expires_at"]
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        valid_state = expiry > datetime.now(timezone.utc)
    if not valid_state:
        return _google_frontend_redirect("error")
    admin = await db.users.find_one(
        {"id": state_document["user_id"], "role": "admin"},
        {"_id": 1},
    )
    if not admin:
        return _google_frontend_redirect("error")
    if request.query_params.get("error"):
        return _google_frontend_redirect("error")
    code = request.query_params.get("code")
    if not code:
        return _google_frontend_redirect("error")
    try:
        previous = await db.google_calendar_integrations.find_one({"_id": "primary"})
        previous_token = decrypt_token(previous["encrypted_token"]) if previous and previous.get("encrypted_token") else None
        token = await asyncio.to_thread(exchange_code, code, previous_token)
        email = await asyncio.to_thread(google_account_email, token)
        if previous and previous.get("email", "").lower() != email.lower():
            await db.google_calendar_event_mappings.delete_many({})
        await db.google_calendar_integrations.update_one(
            {"_id": "primary"},
            {"$set": {
                "email": email,
                "encrypted_token": encrypt_token(token),
                "connected_at": now_iso(),
                "last_error": "",
            }},
            upsert=True,
        )
        await db.google_calendar_integrations.update_one(
            {"_id": "primary"}, {"$unset": {"disconnected_at": ""}}
        )
        try:
            await _sync_google_calendar()
        except (RuntimeError, ValueError, PermissionError, OSError, RequestException) as error:
            await db.google_calendar_integrations.update_one(
                {"_id": "primary"}, {"$set": {"last_error": str(error)}}
            )
            logging.exception("Google Agenda conectado, mas a sincronização inicial falhou")
        return _google_frontend_redirect("connected")
    except (ValueError, PermissionError, OSError, RequestException):
        logging.exception("Falha ao concluir a conexão com Google Agenda")
        return _google_frontend_redirect("error")

@api.post("/integrations/google-calendar/sync")
async def google_calendar_sync(user: dict = Depends(require_admin)):
    try:
        return await _sync_google_calendar()
    except (RuntimeError, ValueError, PermissionError, OSError, RequestException) as error:
        await db.google_calendar_integrations.update_one(
            {"_id": "primary"}, {"$set": {"last_error": str(error)}}
        )
        logging.exception("Falha na sincronização manual do Google Agenda")
        raise HTTPException(502, str(error)) from error

@api.delete("/integrations/google-calendar/disconnect")
async def google_calendar_disconnect(user: dict = Depends(require_admin)):
    await db.google_calendar_integrations.update_one(
        {"_id": "primary"},
        {"$unset": {"encrypted_token": ""}, "$set": {
            "disconnected_at": now_iso(),
            "last_error": "",
        }},
    )
    return {"disconnected": True}

@api.get("/notifications/push/status")
async def push_notification_status(
    endpoint: Optional[str] = Query(default=None, max_length=2048),
    user: dict = Depends(get_current_user),
):
    subscription_id = hashlib.sha256(endpoint.encode()).hexdigest() if endpoint else None
    return {
        "configured": not push_configuration_missing(),
        "subscribed": bool(subscription_id and await db.push_subscriptions.find_one({
            "_id": subscription_id, "user_id": user["id"],
        })),
    }

@api.get("/notifications/push/public-key")
async def push_notification_public_key(user: dict = Depends(get_current_user)):
    missing = push_configuration_missing()
    if missing:
        raise HTTPException(503, f"Notificações push não configuradas no servidor: {', '.join(missing)}")
    return {"public_key": os.environ["WEB_PUSH_VAPID_PUBLIC_KEY"]}

@api.post("/notifications/push/subscribe")
async def subscribe_push_notifications(
    payload: PushSubscriptionInput,
    user: dict = Depends(get_current_user),
):
    if push_configuration_missing():
        raise HTTPException(503, "Notificações push não configuradas no servidor")
    endpoint = urlsplit(payload.endpoint)
    hostname = (endpoint.hostname or "").lower()
    trusted_push_hosts = (
        hostname == "fcm.googleapis.com"
        or hostname.endswith(".push.services.mozilla.com")
        or hostname.endswith(".push.apple.com")
        or hostname.endswith(".notify.windows.com")
    )
    if endpoint.scheme != "https" or not trusted_push_hosts:
        raise HTTPException(400, "O endpoint de notificação não pertence a um serviço push compatível")
    subscription_id = hashlib.sha256(payload.endpoint.encode()).hexdigest()
    await db.push_subscriptions.update_one(
        {"_id": subscription_id},
        {"$set": {
            "user_id": user["id"],
            "subscription": payload.model_dump(),
            "updated_at": now_iso(),
        }},
        upsert=True,
    )
    return {"subscribed": True}

@api.delete("/notifications/push/subscribe")
async def unsubscribe_push_notifications(
    payload: PushSubscriptionInput,
    user: dict = Depends(get_current_user),
):
    subscription_id = hashlib.sha256(payload.endpoint.encode()).hexdigest()
    await db.push_subscriptions.delete_one({"_id": subscription_id, "user_id": user["id"]})
    return {"subscribed": False}

@api.get("/dashboard/events")
async def list_dashboard_events(user: dict = Depends(get_current_user)):
    return await db.dashboard_events.find({}, {"_id": 0}).sort(
        [("event_date", -1), ("created_at", -1)]
    ).to_list(500)

@api.post("/dashboard/events")
async def create_dashboard_event(payload: DashboardEventCreate, user: dict = Depends(require_admin)):
    title = payload.title.strip()
    if not title:
        raise HTTPException(400, "Informe o título do evento")
    try:
        datetime.strptime(payload.event_date, "%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(400, "Informe uma data válida") from exc
    doc = {
        "id": new_id(),
        "title": title,
        "description": payload.description.strip(),
        "event_date": payload.event_date,
        "archived": False,
        "created_at": now_iso(),
        "created_by": user.get("name", ""),
    }
    await db.dashboard_events.insert_one(doc)
    return strip_mongo(doc)

@api.patch("/dashboard/events/{event_id}")
async def archive_dashboard_event(
    event_id: str,
    payload: DashboardEventArchive,
    user: dict = Depends(require_admin),
):
    result = await db.dashboard_events.update_one(
        {"id": event_id},
        {"$set": {"archived": payload.archived}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Evento não encontrado")
    return await db.dashboard_events.find_one({"id": event_id}, {"_id": 0})

@api.delete("/dashboard/events/{event_id}")
async def delete_dashboard_event(event_id: str, user: dict = Depends(require_admin)):
    result = await db.dashboard_events.delete_one({"id": event_id})
    if result.deleted_count == 0:
        raise HTTPException(404, "Evento não encontrado")
    return {"deleted": result.deleted_count}

@api.get("/dashboard/pending")
async def dashboard_pending(user: dict = Depends(get_current_user)):
    today = datetime.now(ZoneInfo("America/Sao_Paulo")).date()
    soon = today + timedelta(days=30)
    events, orders, maintenance, products = await asyncio.gather(
        db.dashboard_events.find({"archived": {"$ne": True}}, {"_id": 0}).to_list(500),
        db.orders.find(
            {"status": {"$nin": ["Entregue", "Retirado", "Cancelado"]}},
            {"_id": 0, "id": 1, "number": 1, "status": 1, "customer_name": 1, "expected_date": 1},
        ).to_list(1000),
        db.expenses.find(
            {"type": "MANUTENCAO", "next_review_date": {"$exists": True, "$nin": [None, ""]}},
            {"_id": 0, "id": 1, "description": 1, "vehicle_model": 1, "plate": 1, "next_review_date": 1},
        ).to_list(1000),
        db.products.find(
            {},
            {"_id": 0, "id": 1, "name": 1, "sizes": 1, "linked_ids": 1},
        ).to_list(5000),
    )
    items = []
    for event in events:
        items.append({
            "id": f"event:{event['id']}",
            "type": "anotacao",
            "title": event.get("title") or "Anotação",
            "body": event.get("description") or "",
            "date": event.get("event_date") or "",
            "url": "/",
        })
    for order in orders:
        expected_date = str(order.get("expected_date") or "")[:10]
        is_scheduled = bool(expected_date and expected_date >= today.isoformat())
        items.append({
            "id": f"order:{order['id']}",
            "type": "pedido",
            "title": f"Pedido #{order.get('number', '')} {'agendado' if is_scheduled else 'em aberto'}",
            "body": " · ".join(filter(None, (order.get("customer_name"), order.get("status")))),
            "date": expected_date,
            "url": "/pedidos",
        })
    for service in maintenance:
        review_date = str(service.get("next_review_date") or "")[:10]
        try:
            parsed_date = datetime.strptime(review_date, "%Y-%m-%d").date()
        except ValueError:
            continue
        if parsed_date > soon:
            continue
        vehicle = " · ".join(filter(None, (service.get("vehicle_model"), service.get("plate"))))
        items.append({
            "id": f"maintenance:{service['id']}",
            "type": "manutencao",
            "title": "Manutenção vencida" if parsed_date < today else "Manutenção programada",
            "body": " · ".join(filter(None, (service.get("description"), vehicle))),
            "date": review_date,
            "url": "/manutencao",
        })
    products_by_id = {product["id"]: product for product in products}
    for product in products:
        component_ids = product.get("linked_ids") or []
        if not component_ids:
            continue
        component_counts = {}
        for component_id in component_ids:
            component_counts[component_id] = component_counts.get(component_id, 0) + 1
        components = [products_by_id.get(component_id) for component_id in component_counts]
        if any(component is None for component in components):
            continue
        component_names = [products_by_id[component_id].get("name") or "Produto" for component_id in component_ids]
        for size in product.get("sizes", []):
            size_name = size.get("size")
            component_availability = []
            for component_id, required_quantity in component_counts.items():
                component = products_by_id[component_id]
                component_size = next(
                    (entry for entry in component.get("sizes", []) if entry.get("size") == size_name),
                    None,
                )
                if component_size is None:
                    component_availability.append(0)
                    continue
                component_availability.append(
                    math.floor(float(component_size.get("stock") or 0) / required_quantity)
                )
            mountable_quantity = min(component_availability, default=0)
            if mountable_quantity <= 0:
                continue
            items.append({
                "id": f"assembly:{product['id']}:{size_name}",
                "type": "montagem",
                "title": f"Pode montar: {product.get('name') or 'Produto'}",
                "body": (
                    f"Tamanho {size_name} · até {mountable_quantity} unidade(s) "
                    f"com {', '.join(component_names)}"
                ),
                "date": "",
                "url": "/produtos",
            })
    items.sort(key=lambda item: (item["date"] or "9999-12-31", item["type"], item["title"]))
    item_ids = [item["id"] for item in items]
    archived_items = await db.dashboard_pending_archives.find(
        {"user_id": user["id"], "item_id": {"$in": item_ids}},
        {"_id": 0, "item_id": 1},
    ).to_list(len(item_ids)) if item_ids else []
    archived_ids = {item["item_id"] for item in archived_items}
    items = [item for item in items if item["id"] not in archived_ids]
    return {"items": items}

@api.post("/dashboard/pending/{pending_id}/archive")
async def archive_dashboard_pending(
    pending_id: str,
    user: dict = Depends(get_current_user),
):
    if not pending_id.startswith(("event:", "order:", "maintenance:", "assembly:")):
        raise HTTPException(400, "Pendência inválida")
    if pending_id.startswith("event:"):
        result = await db.dashboard_events.update_one(
            {"id": pending_id.removeprefix("event:")},
            {"$set": {"archived": True}},
        )
        if result.matched_count == 0:
            raise HTTPException(404, "Anotação não encontrada")
    archive_id = hashlib.sha256(f"{user['id']}:{pending_id}".encode()).hexdigest()
    await db.dashboard_pending_archives.update_one(
        {"_id": archive_id},
        {"$setOnInsert": {
            "user_id": user["id"],
            "item_id": pending_id,
            "archived_at": now_iso(),
        }},
        upsert=True,
    )
    return {"archived": True}

async def _delete_count(collection_name: str, query: Optional[dict] = None) -> int:
    result = await db[collection_name].delete_many(query or {})
    return result.deleted_count

async def _data_reset_counts() -> dict:
    order_ids = [
        order["id"] for order in await db.orders.find({}, {"_id": 0, "id": 1}).to_list(None)
    ]
    return {
        "orders": await db.orders.count_documents({}),
        "commissions": await db.commissions.count_documents({}),
        "order_stock_movements": await db.stock_movements.count_documents({"order_id": {"$exists": True, "$ne": None}}),
        "order_trips": await db.expenses.count_documents({"order_id": {"$exists": True, "$ne": None}}),
        "products": await db.products.count_documents({}),
        "categories": await db.categories.count_documents({}),
        "size_grids": await db.size_grids.count_documents({}),
        "stock_movements": await db.stock_movements.count_documents({}),
        "customers": await db.customers.count_documents({}),
        "suppliers": await db.suppliers.count_documents({}),
        "vehicles": await db.vehicles.count_documents({}),
        "expenses": await db.expenses.count_documents({}),
        "vendors": await db.vendors.count_documents({}),
        "day_closures": await db.day_closures.count_documents({}),
        "dashboard_events": await db.dashboard_events.count_documents({}),
        "dashboard_pending_archives": await db.dashboard_pending_archives.count_documents({}),
        "order_ids": order_ids,
    }

@api.get("/settings/data-reset/options")
async def data_reset_options(user: dict = Depends(require_admin)):
    counts = await _data_reset_counts()
    return {
        "preserved": ["users", "settings", "backups"],
        "groups": [
            {"id": "orders", "label": RESET_GROUPS["orders"], "count": counts["orders"]},
            {
                "id": "inventory",
                "label": RESET_GROUPS["inventory"],
                "count": counts["products"] + counts["categories"] + counts["size_grids"] + counts["stock_movements"],
            },
            {"id": "customers", "label": RESET_GROUPS["customers"], "count": counts["customers"]},
            {"id": "suppliers", "label": RESET_GROUPS["suppliers"], "count": counts["suppliers"]},
            {"id": "vehicles", "label": RESET_GROUPS["vehicles"], "count": counts["vehicles"]},
            {"id": "expenses", "label": RESET_GROUPS["expenses"], "count": counts["expenses"]},
            {"id": "vendors", "label": RESET_GROUPS["vendors"], "count": counts["vendors"]},
            {"id": "day_closures", "label": RESET_GROUPS["day_closures"], "count": counts["day_closures"]},
            {
                "id": "dashboard_events",
                "label": RESET_GROUPS["dashboard_events"],
                "count": counts["dashboard_events"] + counts["dashboard_pending_archives"],
            },
        ],
    }

@api.post("/settings/data-reset")
async def reset_data(payload: DataResetInput, user: dict = Depends(require_admin)):
    selected = set(payload.groups)
    if not selected or selected - {*RESET_GROUPS}:
        raise HTTPException(400, "Selecione pelo menos um grupo válido para apagar")

    deleted = {}
    counts = await _data_reset_counts()
    order_ids = counts.pop("order_ids")
    if "orders" in selected:
        deleted["orders"] = await _delete_count("orders")
        deleted["commissions"] = await _delete_count("commissions")
        deleted["stock_movements_for_orders"] = await _delete_count(
            "stock_movements", {"order_id": {"$in": order_ids}}
        ) if order_ids else 0
        deleted["trips_for_orders"] = await _delete_count(
            "expenses", {"order_id": {"$in": order_ids}}
        ) if order_ids else 0
        await db.counters.delete_one({"_id": "orders"})

    if "inventory" in selected:
        for collection in ("products", "categories", "size_grids", "stock_movements"):
            deleted[collection] = await _delete_count(collection)
    elif "orders" in selected:
        deleted["stock_movements_for_orders"] = counts["order_stock_movements"]

    for group, collection in (
        ("customers", "customers"),
        ("suppliers", "suppliers"),
        ("vehicles", "vehicles"),
        ("vendors", "vendors"),
        ("day_closures", "day_closures"),
        ("dashboard_events", "dashboard_events"),
    ):
        if group in selected:
            if group == "vendors":
                await db.users.update_many({"vendor_id": {"$exists": True}}, {"$set": {"vendor_id": None}})
            if group == "dashboard_events":
                deleted["dashboard_pending_archives"] = await _delete_count("dashboard_pending_archives")
            deleted[collection] = await _delete_count(collection)

    if "expenses" in selected:
        deleted["expenses"] = await _delete_count("expenses")
    elif "orders" in selected:
        deleted["trips_for_orders"] = counts["order_trips"]

    return {
        "deleted": deleted,
        "preserved": ["users", "settings", "backups"],
        "order_number_reset": "orders" in selected,
    }

# ---------- Dashboard summary ----------
BUSINESS_TIMEZONE = ZoneInfo("America/Sao_Paulo")

def _business_date(value: Any) -> Optional[str]:
    if not value:
        return None
    raw = str(value)
    if len(raw) == 10:
        return raw
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=BUSINESS_TIMEZONE)
        return parsed.astimezone(BUSINESS_TIMEZONE).date().isoformat()
    except ValueError:
        return raw[:10]

async def _build_day_closure(day: str, user: dict, existing: Optional[dict] = None) -> dict:
    stock_movements = await db.stock_movements.find({}, {"_id": 0}).to_list(10000)
    expenses = await db.expenses.find({}, {"_id": 0}).to_list(5000)
    day_movements = [
        movement for movement in stock_movements
        if _business_date(movement.get("created_at")) == day
    ]
    day_expenses = [
        expense for expense in expenses
        if _business_date(expense.get("date")) == day
    ]
    related_order_ids = {
        movement.get("order_id") for movement in day_movements if movement.get("order_id")
    }
    related_order_ids.update(
        expense.get("order_id") for expense in day_expenses if expense.get("order_id")
    )
    orders = await db.orders.find({}, {"_id": 0}).to_list(5000)
    day_orders = [
        order for order in orders
        if (
            _business_date(order.get("created_at")) == day
            or _business_date(order.get("fulfilled_at")) == day
            or order.get("id") in related_order_ids
        )
    ]
    return {
        "id": (existing or {}).get("id") or new_id(),
        "date": day,
        "closed_at": (existing or {}).get("closed_at") or now_iso(),
        "closed_by": (existing or {}).get("closed_by")
        or user.get("name") or user.get("email") or "Administrador",
        "already_closed": bool(existing),
        "summary": {
            "orders_count": len(day_orders),
            "orders_total": sum(float(order.get("total") or 0) for order in day_orders),
            "stock_movements_count": len(day_movements),
            "stock_out_quantity": sum(
                abs(float(movement.get("qty") or 0))
                for movement in day_movements
                if movement.get("kind") == "SAIDA"
            ),
            "stock_return_quantity": sum(
                abs(float(movement.get("qty") or 0))
                for movement in day_movements
                if movement.get("kind") == "ENTRADA" and movement.get("order_id")
            ),
            "expenses_count": len(day_expenses),
            "expenses_total": sum(
                float(expense.get("amount") or 0)
                + float(expense.get("fuel_cost") or 0)
                + float(expense.get("toll_cost") or 0)
                + float(expense.get("daily_allowance") or 0)
                for expense in day_expenses
            ),
        },
        "orders": day_orders,
        "stock_movements": day_movements,
        "expenses": day_expenses,
    }

async def _create_day_backup(day: str) -> dict:
    collection_names = sorted(
        name for name in await db.list_collection_names()
        if name not in ("backups", "fs.files", "fs.chunks")
    )
    filename = f"lokal-militar-backup-{day}.zip"
    bucket = AsyncIOMotorGridFSBucket(db)
    with tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024, mode="w+b") as archive_buffer:
        with zipfile.ZipFile(archive_buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            manifest = {
                "created_at": now_iso(),
                "day": day,
                "format": "MongoDB Extended JSON",
                "collections": collection_names,
                "excluded_backup_storage": ["backups", "fs.files", "fs.chunks"],
            }
            archive.writestr("manifest.json", json_util.dumps(manifest, ensure_ascii=False, indent=2))
            for collection_name in collection_names:
                with archive.open(f"data/{collection_name}.json", "w") as collection_file:
                    collection_file.write(b"[")
                    first_document = True
                    async for document in db[collection_name].find({}):
                        if not first_document:
                            collection_file.write(b",")
                        collection_file.write(json_util.dumps(document, ensure_ascii=False).encode("utf-8"))
                        first_document = False
                    collection_file.write(b"]")
        archive_buffer.seek(0, io.SEEK_END)
        size_bytes = archive_buffer.tell()
        archive_buffer.seek(0)
        gridfs_id = await bucket.upload_from_stream(filename, archive_buffer)
    backup = {
        "id": new_id(),
        "day": day,
        "created_at": now_iso(),
        "filename": filename,
        "gridfs_id": str(gridfs_id),
        "size_bytes": size_bytes,
    }
    await db.backups.insert_one(backup.copy())
    return backup

@api.get("/dashboard/closures")
async def list_day_closures(user: dict = Depends(require_admin)):
    closures = await db.day_closures.find(
        {}, {"_id": 0, "date": 1, "closed_at": 1, "closed_by": 1, "summary": 1}
    ).sort("date", -1).to_list(1000)
    return closures

@api.get("/dashboard/closures/{day}")
async def get_day_closure(day: str, user: dict = Depends(require_admin)):
    closure = await db.day_closures.find_one({"date": day}, {"_id": 0})
    if not closure:
        raise HTTPException(404, "Fechamento não encontrado")
    refreshed = await _build_day_closure(day, user, closure)
    refreshed["backup_id"] = closure.get("backup_id")
    await db.day_closures.update_one({"date": day}, {"$set": {
        "summary": refreshed["summary"],
        "orders": refreshed["orders"],
        "stock_movements": refreshed["stock_movements"],
        "expenses": refreshed["expenses"],
    }, "$unset": {"stock_reconciliation": ""}})
    return refreshed

@api.get("/dashboard/backups")
async def list_day_backups(user: dict = Depends(require_admin)):
    return await db.backups.find(
        {}, {"_id": 0, "gridfs_id": 0}
    ).sort("created_at", -1).to_list(1000)

@api.get("/dashboard/backups/{backup_id}")
async def download_day_backup(backup_id: str, user: dict = Depends(require_admin)):
    backup = await db.backups.find_one({"id": backup_id}, {"_id": 0})
    if not backup:
        raise HTTPException(404, "Backup não encontrado")
    try:
        gridfs_id = ObjectId(backup["gridfs_id"])
        bucket = AsyncIOMotorGridFSBucket(db)
        archive = await bucket.open_download_stream(gridfs_id)
        content = await archive.read()
    except (KeyError, ValueError, NoFile):
        raise HTTPException(404, "Arquivo de backup não encontrado")
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{backup["filename"]}"'},
    )

def _read_backup_archive(backup_file) -> dict:
    max_uncompressed_size = 512 * 1024 * 1024
    try:
        with zipfile.ZipFile(backup_file) as archive:
            entries = archive.infolist()
            entry_names = [entry.filename for entry in entries]
            if len(entry_names) != len(set(entry_names)):
                raise ValueError("O arquivo contém caminhos duplicados")
            if sum(entry.file_size for entry in entries) > max_uncompressed_size:
                raise ValueError("O arquivo excede o limite de restauração")
            if "manifest.json" not in entry_names:
                raise ValueError("Manifesto ausente")

            if archive.getinfo("manifest.json").file_size > 1024 * 1024:
                raise ValueError("Manifesto muito grande")
            manifest = json_util.loads(archive.read("manifest.json"))
            collection_names = manifest.get("collections")
            if (
                manifest.get("format") != "MongoDB Extended JSON"
                or not isinstance(collection_names, list)
                or "settings" not in collection_names
            ):
                raise ValueError("Manifesto de backup inválido")
            if len(collection_names) != len(set(collection_names)):
                raise ValueError("Lista de coleções inválida")

            expected_entries = {"manifest.json"}
            for name in collection_names:
                if (
                    not isinstance(name, str)
                    or not name
                    or name.startswith("$")
                    or name.startswith("system.")
                    or "/" in name
                    or "\\" in name
                    or name in {"backups", "fs.files", "fs.chunks"}
                ):
                    raise ValueError("Nome de coleção inválido")
                expected_entries.add(f"data/{name}.json")
            if set(entry_names) != expected_entries:
                raise ValueError("Arquivos do backup não correspondem ao manifesto")

            collections = {}
            for name in collection_names:
                documents = json_util.loads(archive.read(f"data/{name}.json"))
                if not isinstance(documents, list) or any(
                    not isinstance(item, dict) for item in documents
                ):
                    raise ValueError("Dados de coleção inválidos")
                collections[name] = documents
            if not collections["settings"]:
                raise ValueError("Configurações ausentes")
            return collections
    except (
        zipfile.BadZipFile,
        zlib.error,
        AttributeError,
        EOFError,
        KeyError,
        NotImplementedError,
        OSError,
        RuntimeError,
        TypeError,
        ValueError,
    ) as error:
        raise HTTPException(status_code=400, detail="Arquivo de backup inválido ou incompatível") from error


@api.post("/dashboard/backups/restore")
async def restore_day_backup(
    backup_file: UploadFile = File(...),
    user: dict = Depends(require_admin),
):
    collections = _read_backup_archive(backup_file.file)
    current_backup = await _create_day_backup(
        datetime.now(BUSINESS_TIMEZONE).date().isoformat()
    )
    existing_names = await db.list_collection_names()
    collection_names = (
        set(existing_names) | set(collections)
    ) - {"backups", "fs.files", "fs.chunks", "offline_idempotency"}
    collection_names = {name for name in collection_names if not name.startswith("system.")}

    try:
        for name in collection_names:
            await db[name].delete_many({})
            documents = collections.get(name, [])
            if documents:
                await db[name].insert_many(documents)
    except Exception as error:
        logger.exception("Falha ao restaurar backup. Cópia preventiva: %s", current_backup["id"])
        raise HTTPException(
            status_code=500,
            detail=f"Falha ao restaurar os dados. Foi criado um backup preventivo ({current_backup['id']}).",
        ) from error

    return {
        "message": "Backup restaurado com sucesso",
        "safety_backup_id": current_backup["id"],
        "safety_backup_filename": current_backup["filename"],
    }

@api.post("/dashboard/close-day")
async def close_dashboard_day(
    payload: Optional[DayClosureInput] = Body(default=None),
    user: dict = Depends(require_admin),
):
    day = datetime.now(BUSINESS_TIMEZONE).date().isoformat()
    existing = await db.day_closures.find_one({"date": day}, {"_id": 0})

    if payload:
        vehicle = await db.vehicles.find_one(
            {"id": payload.vehicle_id, "active": {"$ne": False}}, {"_id": 0}
        )
        if not vehicle:
            raise HTTPException(400, "Veículo não encontrado ou inativo")
        existing_mileage = await db.expenses.find_one(
            {"type": "VIAGEM", "day_close_date": day, "vehicle_id": vehicle["id"]},
            {"_id": 0},
        )
        if existing_mileage:
            if float(existing_mileage.get("odometer_km") or 0) != payload.current_km:
                raise HTTPException(409, "Já existe um registro de quilometragem para este veículo e dia")
            await db.vehicles.update_one(
                {"id": vehicle["id"], "current_km": {"$lt": payload.current_km}},
                {"$set": {"current_km": payload.current_km}},
            )
        else:
            previous_km = float(vehicle.get("current_km") or 0)
            if payload.current_km < previous_km:
                raise HTTPException(
                    400,
                    f"A quilometragem informada não pode ser menor que a registrada ({previous_km:g} km)",
                )
            trip = Expense(
                type="VIAGEM",
                description="Quilometragem fora das entregas",
                date=day,
                day_close_date=day,
                vehicle_id=vehicle["id"],
                vehicle_name=vehicle["name"],
                km=payload.current_km - previous_km,
                odometer_km=payload.current_km,
                route="Registro de quilometragem no fechamento do dia",
                avg_consumption=float(vehicle.get("avg_consumption") or 0),
            ).model_dump()
            trip = await _prepare_trip(trip)
            await db.expenses.insert_one(trip)
            await _change_vehicle_km(
                vehicle["id"], payload.current_km - previous_km, required=True
            )

    report = await _build_day_closure(day, user, existing)
    report["backup_id"] = (existing or {}).get("backup_id")
    if existing:
        await db.day_closures.update_one({"date": day}, {"$set": {
            "summary": report["summary"],
            "orders": report["orders"],
            "stock_movements": report["stock_movements"],
            "expenses": report["expenses"],
        }, "$unset": {"stock_reconciliation": ""}})
    else:
        try:
            await db.day_closures.insert_one(report.copy())
        except DuplicateKeyError:
            existing = await db.day_closures.find_one({"date": day}, {"_id": 0})
            if not existing:
                raise
            report = await _build_day_closure(day, user, existing)
            report["backup_id"] = existing.get("backup_id")

    if not report.get("backup_id"):
        backup = await _create_day_backup(day)
        report["backup_id"] = backup["id"]
        await db.day_closures.update_one(
            {"date": day}, {"$set": {"backup_id": backup["id"]}}
        )
    return report

@api.post("/dashboard/close-day/confirm")
async def confirm_dashboard_day_closure(user: dict = Depends(require_admin)):
    day = datetime.now(BUSINESS_TIMEZONE).date().isoformat()
    logout_epoch = new_id()
    result = await db.day_closures.update_one(
        {"date": day},
        {"$set": {
            "logout_epoch": logout_epoch,
            "logout_confirmed_at": now_iso(),
            "logout_confirmed_by": user.get("id"),
        }},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Fechamento do dia não encontrado")
    await db.auth_state.update_one(
        {"_id": "global"},
        {"$set": {"epoch": logout_epoch, "updated_at": now_iso()}},
        upsert=True,
    )
    return {"global_logout_done": True}

@api.get("/dashboard")
async def dashboard(user: dict = Depends(get_current_user), days: int = Query(7, ge=7, le=30)):
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    cur_month = now.strftime("%Y-%m")
    next_month = (now.replace(day=28) + timedelta(days=4)).replace(day=1).strftime("%Y-%m")
    soon = (now + timedelta(days=15)).strftime("%Y-%m-%d")
    chart_start = (now - timedelta(days=days - 1)).strftime("%Y-%m-%d")
    products, categories, orders, customers, coms, exps = await asyncio.gather(
        db.products.find({}, {
            "_id": 0, "id": 1, "name": 1, "sku": 1, "price": 1, "sizes": 1,
            "category_id": 1,
        }).to_list(5000),
        db.categories.find({}, {"_id": 0}).to_list(500),
        db.orders.find({
            "$or": [
                {"created_at": {"$gte": chart_start}},
                {"status": {"$in": ["Orçamento", "Anotado", "Aprovado", "Separado"]}},
            ],
        }, {
            "_id": 0, "created_at": 1, "status": 1, "total": 1, "type": 1,
        }).to_list(5000),
        db.customers.count_documents({}),
        db.commissions.find({"created_at": {"$gte": cur_month, "$lt": next_month}}, {
            "_id": 0, "amount": 1, "created_at": 1,
        }).to_list(5000),
        db.expenses.find({
            "$or": [
                {"date": {"$gte": cur_month, "$lt": next_month}},
                {"type": "MANUTENCAO", "next_review_date": {"$lte": soon}},
            ],
        }, {
            "_id": 0, "amount": 1, "fuel_cost": 1, "toll_cost": 1, "daily_allowance": 1, "date": 1,
            "type": 1, "next_review_date": 1,
        }).to_list(5000),
    )
    cat_map = {c["id"]: c for c in categories}
    totals_by_cat = {c["name"]: {"qty": 0, "value": 0, "color": c.get("color", "#4B5320")}
                     for c in categories if not c.get("parent_id")}
    low_stock = []
    for p in products:
        total_qty = sum(float(s.get("stock", 0)) for s in p.get("sizes", []))
        total_val = total_qty * float(p.get("price", 0))
        cid = p.get("category_id")
        cname = (cat_map.get(cid) or {}).get("name", "Sem Categoria")
        totals_by_cat.setdefault(cname, {"qty": 0, "value": 0, "color": (cat_map.get(cid) or {}).get("color", "#4B5320")})
        totals_by_cat[cname]["qty"] += total_qty
        totals_by_cat[cname]["value"] += total_val
        for s in p.get("sizes", []):
            if float(s.get("stock", 0)) <= float(s.get("stock_min", 0)) and float(s.get("stock_min", 0)) > 0:
                low_stock.append({"id": p["id"], "name": p["name"], "sku": p.get("sku"),
                                  "size": s["size"], "stock": s["stock"], "stock_min": s["stock_min"]})
    orders_today = [o for o in orders if (o.get("created_at", "") or "").startswith(today)]
    pending = [o for o in orders if o.get("status") in ("Orçamento", "Anotado", "Aprovado", "Separado")]
    # commission month
    com_month = sum(c.get("amount", 0) for c in coms if (c.get("created_at", "") or "").startswith(cur_month))
    # expenses month
    month_exps = [e for e in exps if (e.get("date", "") or "").startswith(cur_month)]
    exp_month = sum(
        e.get("amount", 0) + e.get("fuel_cost", 0) + e.get("toll_cost", 0) + e.get("daily_allowance", 0)
        for e in month_exps
    )
    insumos_month = sum(e.get("amount", 0) for e in month_exps if e.get("type") == "INSUMO")
    manut_month = sum(e.get("amount", 0) for e in month_exps if e.get("type") == "MANUTENCAO")
    manut_alerts = sum(1 for e in exps if e.get("type") == "MANUTENCAO" and e.get("next_review_date") and e["next_review_date"][:10] <= soon)
    # sales chart last 7 days
    chart = []
    orders_by_day = {}
    for order in orders:
        order_date = (order.get("created_at", "") or "")[:10]
        if order_date >= chart_start and order.get("status") in ACTIVE_STATUSES and order.get("type") == "VENDA":
            orders_by_day[order_date] = orders_by_day.get(order_date, 0) + order.get("total", 0)
    for i in range(days - 1, -1, -1):
        day = (now - timedelta(days=i)).strftime("%Y-%m-%d")
        chart.append({"date": day, "value": orders_by_day.get(day, 0)})
    return {
        "categories": categories,
        "totals_by_cat": totals_by_cat,
        "orders_today": len(orders_today),
        "orders_today_total": sum(o.get("total", 0) for o in orders_today),
        "insumos_month": insumos_month,
        "manut_month": manut_month,
        "manut_alerts": manut_alerts,
        "pending": len(pending),
        "customers": customers,
        "commission_month": com_month,
        "expenses_month": exp_month,
        "low_stock": low_stock,
        "chart": chart,
    }

app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("lokal")

async def _send_due_push_notifications():
    if push_configuration_missing():
        return
    local_now = datetime.now(ZoneInfo("America/Sao_Paulo"))
    if local_now.hour < 9:
        return
    today = local_now.date()
    dashboard_events = await db.dashboard_events.find({}, {"_id": 0}).to_list(5000)
    maintenance = await db.expenses.find(
        {"type": "MANUTENCAO"}, {"_id": 0}
    ).to_list(5000)
    pending_orders = await db.orders.find(
        {"status": {"$nin": ["Entregue", "Retirado", "Cancelado"]}},
        {"_id": 0},
    ).to_list(5000)
    notifications = build_due_notifications(
        dashboard_events, maintenance, pending_orders, today
    )
    subscriptions = await db.push_subscriptions.find({}).to_list(10000)
    for subscription_document in subscriptions:
        subscription = subscription_document["subscription"]
        subscription_id = subscription_document["_id"]
        claims = {"sub": os.environ["WEB_PUSH_VAPID_SUBJECT"]}
        for notification in notifications:
            delivery_id = hashlib.sha256(
                f"{subscription_id}:{notification['id']}".encode()
            ).hexdigest()
            try:
                await db.push_notification_deliveries.insert_one({
                    "_id": delivery_id,
                    "status": "sending",
                    "started_at": datetime.now(timezone.utc),
                })
            except DuplicateKeyError:
                previous = await db.push_notification_deliveries.find_one({"_id": delivery_id})
                if previous and previous.get("status") == "sent":
                    continue
                started = previous.get("started_at") if previous else None
                if started and started.tzinfo is None:
                    started = started.replace(tzinfo=timezone.utc)
                if started and datetime.now(timezone.utc) - started < timedelta(minutes=10):
                    continue
                await db.push_notification_deliveries.update_one(
                    {"_id": delivery_id},
                    {"$set": {"status": "sending", "started_at": datetime.now(timezone.utc)}},
                )
            try:
                await asyncio.to_thread(
                    webpush,
                    subscription_info=subscription,
                    data=json_util.dumps({
                        "title": notification["title"],
                        "body": notification["body"],
                        "url": notification["url"],
                    }),
                    vapid_private_key=os.environ["WEB_PUSH_VAPID_PRIVATE_KEY"],
                    vapid_claims=claims,
                    ttl=60 * 60 * 24,
                )
                await db.push_notification_deliveries.update_one(
                    {"_id": delivery_id},
                    {"$set": {"status": "sent", "sent_at": datetime.now(timezone.utc)}},
                )
            except WebPushException as error:
                response = getattr(error, "response", None)
                status_code = getattr(response, "status_code", None)
                if status_code in (404, 410):
                    await db.push_subscriptions.delete_one({"_id": subscription_id})
                    await db.push_notification_deliveries.delete_one({"_id": delivery_id})
                else:
                    await db.push_notification_deliveries.delete_one({"_id": delivery_id})
                    logger.error("Falha ao enviar notificação push (HTTP %s)", status_code, exc_info=error)
            except (RequestException, ValueError) as error:
                await db.push_notification_deliveries.delete_one({"_id": delivery_id})
                logger.error("Falha ao enviar notificação push: %s", error)

async def _integration_background_worker():
    while True:
        try:
            integration = await db.google_calendar_integrations.find_one({"_id": "primary"})
            if integration and integration.get("encrypted_token") and not google_configuration_missing():
                last_sync = integration.get("last_sync_at")
                last_sync_time = None
                if last_sync:
                    try:
                        last_sync_time = (
                            last_sync
                            if isinstance(last_sync, datetime)
                            else datetime.fromisoformat(last_sync.replace("Z", "+00:00"))
                        )
                    except (AttributeError, TypeError, ValueError):
                        logger.warning("Data da última sincronização Google inválida")
                    if last_sync_time and last_sync_time.tzinfo is None:
                        last_sync_time = last_sync_time.replace(tzinfo=timezone.utc)
                if not last_sync_time or (
                    datetime.now(timezone.utc) - last_sync_time.astimezone(timezone.utc)
                ).total_seconds() >= 300:
                    try:
                        await _sync_google_calendar()
                    except (RuntimeError, ValueError, PermissionError, OSError, RequestException) as error:
                        await db.google_calendar_integrations.update_one(
                            {"_id": "primary"}, {"$set": {"last_error": str(error)}}
                        )
                        raise
            await _send_due_push_notifications()
        except (RuntimeError, ValueError, PermissionError, OSError, RequestException, PyMongoError):
            logger.exception("Falha no ciclo de sincronização ou notificações")
        await asyncio.sleep(60)

@app.on_event("startup")
async def startup():
    if "offline_idempotency" in await db.list_collection_names():
        await db.offline_idempotency.drop()
    # Seed size grids
    if await db.size_grids.count_documents({}) == 0:
        await db.size_grids.insert_many([
            {"id": new_id(), "name": "ROUPA", "sizes": ["PP","P","M","G","GG","XG","XGG"], "active": True},
            {"id": new_id(), "name": "CALCADOS", "sizes": [str(n) for n in range(34, 48)], "active": True},
        ])
    # Seed categories
    if await db.categories.count_documents({}) == 0:
        base = [
            ("Fardamento", "#4B5320", "Shirt", "ROUPA"),
            ("Calçados", "#111111", "Footprints", "CALCADOS"),
            ("Acessórios", "#C3B091", "Package", None),
            ("Insígnias", "#B8860B", "Star", None),
            ("Brevês", "#B8860B", "Award", None),
            ("Tático", "#4B5320", "Shield", None),
        ]
        for n, c, i, g in base:
            await db.categories.insert_one({"id": new_id(), "name": n, "color": c, "icon": i,
                                            "parent_id": None, "size_grid": g, "created_at": now_iso()})
    # Seed settings
    if not await db.settings.find_one({"id": "singleton"}):
        await db.settings.insert_one(Settings().model_dump())
    # Indexes
    await db.users.create_index("email", unique=True)
    await db.products.create_index("sku")
    await db.products.create_index("id")
    await db.orders.create_index("number")
    await db.orders.create_index("created_at")
    await db.commissions.create_index("created_at")
    await db.expenses.create_index("date")
    await db.stock_movements.create_index("created_at")
    await db.day_closures.create_index("date", unique=True)
    await db.google_calendar_oauth_states.create_index("expires_at", expireAfterSeconds=0)
    await db.push_subscriptions.create_index("user_id")
    await db.push_notification_deliveries.create_index("sent_at", expireAfterSeconds=60 * 60 * 24 * 60)
    global _calendar_worker_task
    _calendar_worker_task = asyncio.create_task(_integration_background_worker())
    logger.info("LOKAL MILITAR API started.")

@app.on_event("shutdown")
async def shutdown():
    if _calendar_worker_task:
        _calendar_worker_task.cancel()
        try:
            await _calendar_worker_task
        except asyncio.CancelledError:
            pass
    client.close()
