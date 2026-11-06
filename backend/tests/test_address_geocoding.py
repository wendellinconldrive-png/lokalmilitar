import asyncio
import os
import sys
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "lokalmilitar_test")
os.environ.setdefault("JWT_SECRET", "test-only-secret")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import (  # noqa: E402
    HTTPException,
    _build_destination_geocoding_address,
    _geocode_for_distance,
    _prepare_trip,
)


def test_destination_geocoding_query_does_not_duplicate_formatted_cep():
    query = _build_destination_geocoding_address(
        "Rua Exemplo, 123, Centro, Rio de Janeiro - RJ, CEP 21745-590",
        "21745590",
    )

    assert query == "Rua Exemplo, 123, Centro, Rio de Janeiro - RJ, CEP 21745590, Brasil"


def test_destination_geocoding_query_adds_missing_cep():
    query = _build_destination_geocoding_address("Rua Exemplo, 123", "21745590")

    assert query == "Rua Exemplo, 123, CEP 21745590, Brasil"


def test_distance_geocoding_error_identifies_the_address(monkeypatch):
    def missing_address(_address):
        raise HTTPException(404, "Não foi possível localizar este endereço")

    monkeypatch.setattr("server._geocode_address", missing_address)

    with pytest.raises(HTTPException, match="endereço informado") as error:
        asyncio.run(_geocode_for_distance("Rua inexistente", "o endereço informado"))

    assert error.value.status_code == 404
    assert "Confira o endereço e o CEP" in error.value.detail


def test_gnv_trip_calculates_fuel_in_cubic_meters(monkeypatch):
    class Collection:
        def __init__(self, document):
            self.document = document

        async def find_one(self, *_args, **_kwargs):
            return self.document

    class Database:
        vehicles = Collection({
            "id": "vehicle-1",
            "name": "Veículo GNV",
            "fuel_types": ["GNV", "Gasolina"],
            "avg_consumption": 25,
        })
        settings = Collection({"fuel_prices": {"GNV": 2, "Gasolina": 6}})

    monkeypatch.setattr("server.db", Database())
    trip = asyncio.run(_prepare_trip({
        "vehicle_id": "vehicle-1",
        "fuel_type": "GNV",
        "km": 100,
        "fuel_price_per_unit": 2,
        "fuelings": [
            {"amount": 10, "price_per_unit": 2, "fuel_type": "GNV"},
            {"amount": 24, "price_per_unit": 6, "fuel_type": "Gasolina"},
        ],
    }))

    assert trip["fuel_quantity_unit"] == "m³"
    assert trip["fuel_quantity"] == 5
    assert trip["fuel_quantities"] == {
        "GNV": {"quantity": 5, "unit": "m³"},
        "Gasolina": {"quantity": 4, "unit": "L"},
    }
    assert trip["estimated_fuel_quantity"] == 4
    assert trip["fuel_liters"] == 0
    assert trip["fuelings"][0]["quantity"] == 5
    assert trip["fuelings"][0]["liters"] == 0
    assert trip["fuelings"][1]["quantity"] == 4
    assert trip["fuelings"][1]["unit"] == "L"
    assert trip["fuel_cost"] == 34
