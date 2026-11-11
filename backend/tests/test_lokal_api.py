# LOKAL MILITAR ERP - backend regression tests (open access, users, products, stock, orders, desmontagem, trocas, commissions, crud, settings)
import os
import uuid
import io
import zipfile
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse
import pytest
import requests

def _base():
    url = os.environ.get("REACT_APP_BACKEND_URL", "http://127.0.0.1:8765")
    if urlparse(url).hostname not in {"localhost", "127.0.0.1", "::1"} and os.environ.get("ALLOW_REMOTE_TEST_BACKEND") != "true":
        raise RuntimeError("Tests refuse remote backends by default; use a local test API or explicitly set ALLOW_REMOTE_TEST_BACKEND=true")
    return url.rstrip("/")

BASE_URL = _base()
CREATED = {"products": [], "orders": [], "users": [], "customers": [], "suppliers": [], "categories": [], "expenses": [], "vehicles": []}


@pytest.fixture(scope="session")
def admin():
    s = requests.Session()
    yield s
    order_ids = set(CREATED["orders"])
    if order_ids:
        orders = s.get(f"{BASE_URL}/api/orders").json()
        CREATED["customers"].extend(
            order.get("customer_id")
            for order in orders
            if order.get("id") in order_ids and order.get("customer_id")
        )
    for coll, ids in CREATED.items():
        for i in ids:
            path = "auth/users" if coll == "users" else coll
            s.delete(f"{BASE_URL}/api/{path}/{i}")


def _prod(admin, name, sizes, **kw):
    sku = "TEST_" + uuid.uuid4().hex[:6]
    r = admin.post(f"{BASE_URL}/api/products", json={"name": name, "sku": sku, "price": 100, "cost": 50,
                                                      "sizes": sizes, **kw})
    assert r.status_code == 200, r.text
    CREATED["products"].append(r.json()["id"])
    return r.json()


def _stock(admin, pid, size):
    p = admin.get(f"{BASE_URL}/api/products").json()
    p = next(x for x in p if x["id"] == pid)
    for s in p["sizes"]:
        if s["size"] == size:
            return s["stock"]
    return None


# --- Open access ---
class TestOpenAccess:
    def test_endpoints_work_without_credentials(self):
        assert requests.get(f"{BASE_URL}/api/products").status_code == 200
        response = requests.get(f"{BASE_URL}/api/auth/me")
        assert response.status_code == 200
        assert response.json()["id"] == "public-access"

    def test_login_endpoint_is_removed(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "x@example.com", "password": "x"})
        assert response.status_code == 404


class TestBackupRestore:
    def test_restore_rejects_invalid_archive(self, admin):
        response = admin.post(
            f"{BASE_URL}/api/dashboard/backups/restore",
            files={"backup_file": ("invalid.zip", b"not a zip archive", "application/zip")},
        )
        assert response.status_code == 400


# --- Users / vendedor RBAC ---
class TestUsers:
    def test_vendor_flow(self, admin):
        email = f"test_vend_{uuid.uuid4().hex[:6]}@lokal.com"
        r = admin.post(f"{BASE_URL}/api/auth/users", json={"email": email, "password": "vend123", "name": "TEST_Vend", "role": "vendedor"})
        assert r.status_code == 200, r.text
        uid = r.json()["id"]
        CREATED["users"].append(uid)
        dup = admin.post(f"{BASE_URL}/api/auth/users", json={"email": email, "password": "x", "name": "x"})
        assert dup.status_code == 400
        c = requests.post(f"{BASE_URL}/api/auth/users", json={"email": "test_x@x.com", "password": "x", "name": "x"})
        assert c.status_code == 200
        CREATED["users"].append(c.json()["id"])
        d = requests.delete(f"{BASE_URL}/api/auth/users/{uid}")
        assert d.status_code == 200
        # Orders use the shared public-access identity when running without credentials.
        o = requests.post(f"{BASE_URL}/api/orders", json={"customer_name": "TEST_C", "items": [], "status": "Orçamento"})
        assert o.status_code == 200 and o.json()["vendor_id"] == "public-access"
        CREATED["orders"].append(o.json()["id"])


# --- Products ---
class TestProducts:
    def test_product_list_omits_photos_and_detail_includes_them(self, admin):
        photo = "data:image/png;base64,Zm9v"
        photo_url = "https://images.example.com/product.jpg"
        product = _prod(
            admin,
            "TEST_Produto com foto",
            [{"size": "M", "stock": 1}],
            photo=photo,
            photo_url=photo_url,
        )

        listing = admin.get(f"{BASE_URL}/api/products")
        assert listing.status_code == 200
        listed_product = next(item for item in listing.json() if item["id"] == product["id"])
        assert "photo" not in listed_product
        assert listed_product["photo_url"] == photo_url

        detail = admin.get(f"{BASE_URL}/api/products/{product['id']}")
        assert detail.status_code == 200
        assert detail.json()["photo"] == photo

        image = admin.get(f"{BASE_URL}/api/products/{product['id']}/photo")
        assert image.status_code == 200
        assert image.json()["photo"] == photo

    def test_product_photo_url_must_be_http_or_https(self, admin):
        response = admin.post(
            f"{BASE_URL}/api/products",
            json={
                "name": "TEST_Produto com link inválido",
                "sku": "TEST_" + uuid.uuid4().hex[:6],
                "photo_url": "javascript:alert(1)",
            },
        )
        assert response.status_code == 400

    def test_crud_with_sizes_and_kit(self, admin):
        a = _prod(admin, "TEST_Boina", [{"size": "M", "stock": 3, "stock_min": 1}])
        kit = _prod(admin, "TEST_Kit Conjunto", [{"size": "M", "stock": 1}], is_kit=True,
                    kit_items=[{"product_id": a["id"], "size": "M", "qty": 1}])
        assert kit["is_kit"] and kit["kit_items"][0]["product_id"] == a["id"]
        u = admin.put(f"{BASE_URL}/api/products/{a['id']}", json={"price": 77})
        assert u.status_code == 200 and u.json()["price"] == 77
        # desmontar kit -> child +1
        r = admin.post(f"{BASE_URL}/api/products/{kit['id']}/desmontar_kit", json={"size": "M"})
        assert r.status_code == 200
        assert _stock(admin, a["id"], "M") == 4
        assert _stock(admin, kit["id"], "M") == 0

    def test_manual_montage_consumes_components_and_prevalidates_stock(self, admin):
        trouser = _prod(admin, "TEST_Calca montagem", [{"size": "M", "stock": 2}])
        jacket = _prod(admin, "TEST_Gandola montagem", [{"size": "M", "stock": 3}])
        uniform = _prod(
            admin,
            "TEST_Farda montagem",
            [{"size": "M", "stock": 0}],
            linked_ids=[trouser["id"], jacket["id"]],
        )

        response = admin.post(
            f"{BASE_URL}/api/products/{uniform['id']}/montar",
            json={"size": "M", "qty": 2},
        )
        assert response.status_code == 200, response.text
        assert _stock(admin, uniform["id"], "M") == 2
        assert _stock(admin, trouser["id"], "M") == 0
        assert _stock(admin, jacket["id"], "M") == 1

        movements = admin.get(f"{BASE_URL}/api/stock_movements").json()
        montage_movements = [
            movement for movement in movements
            if movement["product_id"] in {uniform["id"], trouser["id"], jacket["id"]}
            and movement["kind"] in {"MONTAGEM_SAIDA", "MONTAGEM_ENTRADA"}
        ]
        assert len(montage_movements) == 6
        assert sum(movement["kind"] == "MONTAGEM_SAIDA" for movement in montage_movements) == 4
        assert sum(movement["kind"] == "MONTAGEM_ENTRADA" for movement in montage_movements) == 2

        insufficient = admin.post(
            f"{BASE_URL}/api/products/{uniform['id']}/montar",
            json={"size": "M", "qty": 2},
        )
        assert insufficient.status_code == 400
        assert _stock(admin, uniform["id"], "M") == 2
        assert _stock(admin, trouser["id"], "M") == 0
        assert _stock(admin, jacket["id"], "M") == 1


# --- Stock movements ---
class TestStock:
    def test_entrada_saida_avaria(self, admin):
        p = _prod(admin, "TEST_Coturno", [{"size": "40", "stock": 2}])
        r = admin.post(f"{BASE_URL}/api/stock_movements", json={"product_id": p["id"], "product_name": p["name"], "size": "40", "qty": 5, "kind": "ENTRADA", "nf": "TEST_NF1"})
        assert r.status_code == 200
        assert _stock(admin, p["id"], "40") == 7
        admin.post(f"{BASE_URL}/api/stock_movements", json={"product_id": p["id"], "product_name": p["name"], "size": "40", "qty": 2, "kind": "SAIDA"})
        admin.post(f"{BASE_URL}/api/stock_movements", json={"product_id": p["id"], "product_name": p["name"], "size": "40", "qty": 1, "kind": "AVARIA"})
        assert _stock(admin, p["id"], "40") == 4
        hist = admin.get(f"{BASE_URL}/api/stock_movements").json()
        assert len([h for h in hist if h["product_id"] == p["id"]]) >= 3

    def test_stock_reconciliation_sets_counted_quantities_and_logs_differences(self, admin):
        product = _prod(admin, "TEST_Conferencia", [
            {"size": "P", "stock": 2},
            {"size": "M", "stock": 5},
            {"size": "G", "stock": 1},
        ])

        response = admin.post(
            f"{BASE_URL}/api/stock_movements/reconcile",
            json={"items": [
                {"product_id": product["id"], "size": "P", "quantity": 4},
                {"product_id": product["id"], "size": "M", "quantity": 3},
                {"product_id": product["id"], "size": "G", "quantity": 1},
            ]},
        )

        assert response.status_code == 200, response.text
        assert response.json() == {"updated": 2}
        assert _stock(admin, product["id"], "P") == 4
        assert _stock(admin, product["id"], "M") == 3
        assert _stock(admin, product["id"], "G") == 1
        movements = [
            movement for movement in admin.get(f"{BASE_URL}/api/stock_movements").json()
            if movement["product_id"] == product["id"]
        ]
        assert {(movement["size"], movement["kind"], movement["qty"], movement["reason"]) for movement in movements} == {
            ("P", "ENTRADA", 2, "Ajuste por conferência de estoque"),
            ("M", "SAIDA", 2, "Ajuste por conferência de estoque"),
        }

    def test_stock_reconciliation_rejects_duplicate_rows_without_changing_stock(self, admin):
        product = _prod(admin, "TEST_Conferencia duplicada", [{"size": "U", "stock": 3}])

        response = admin.post(
            f"{BASE_URL}/api/stock_movements/reconcile",
            json={"items": [
                {"product_id": product["id"], "size": "U", "quantity": 4},
                {"product_id": product["id"], "size": "U", "quantity": 5},
            ]},
        )

        assert response.status_code == 400
        assert _stock(admin, product["id"], "U") == 3


# --- Orders / commission / desmontagem / trocas ---
class TestOrders:
    def test_dashboard_pending_lists_products_that_can_be_assembled(self, admin):
        trousers = _prod(admin, "TEST_Calça montável", [
            {"size": "M", "stock": 5},
            {"size": "G", "stock": 1},
        ])
        jacket = _prod(admin, "TEST_Gandola montável", [
            {"size": "M", "stock": 2},
            {"size": "G", "stock": 4},
        ])
        uniform = _prod(
            admin,
            "TEST_Farda montável",
            [{"size": "M", "stock": 0}, {"size": "G", "stock": 0}],
            linked_ids=[trousers["id"], jacket["id"]],
        )

        response = admin.get(f"{BASE_URL}/api/dashboard/pending")
        assert response.status_code == 200, response.text
        assemblies = [item for item in response.json()["items"] if item["type"] == "montagem"]
        assert len(assemblies) == 1
        assembly = assemblies[0]
        assert assembly["id"] == "assembly:available"
        assert assembly["type"] == "montagem"
        assert assembly["title"] == "1 produto disponível para montagem"
        assert "tamanhos e as quantidades disponíveis" in assembly["body"]
        assert assembly["url"] == "/produtos?montaveis=1"
    def test_order_rejects_item_without_product(self, admin):
        response = admin.post(
            f"{BASE_URL}/api/orders",
            json={
                "customer_name": "TEST_Item_sem_produto",
                "items": [{
                    "product_id": "",
                    "name": "",
                    "size": "",
                    "qty": 1,
                    "unit_price": 0,
                }],
            },
        )
        assert response.status_code == 400
        assert "produto" in response.json()["detail"].lower()

    def test_novo_pedido_inicia_anotado_e_baixa_estoque_ao_separar(self, admin):
        product = _prod(admin, "TEST_Status_Separado", [{"size": "U", "stock": 4}])
        response = admin.post(
            f"{BASE_URL}/api/orders",
            json={
                "customer_name": "TEST_Status_Separado",
                "items": [{
                    "product_id": product["id"],
                    "name": product["name"],
                    "size": "U",
                    "qty": 2,
                    "unit_price": 10,
                }],
            },
        )
        assert response.status_code == 200, response.text
        order = response.json()
        CREATED["orders"].append(order["id"])
        assert order["status"] == "Anotado"
        assert _stock(admin, product["id"], "U") == 4
        assert not [
            movement
            for movement in admin.get(f"{BASE_URL}/api/stock_movements").json()
            if movement.get("order_id") == order["id"]
        ]
        customer = next(
            item for item in admin.get(f"{BASE_URL}/api/customers").json()
            if item["id"] == order["customer_id"]
        )
        CREATED["customers"].append(customer["id"])
        assert customer["name"] == "TEST_Status_Separado"

        separated = admin.put(
            f"{BASE_URL}/api/orders/{order['id']}",
            json={"status": "Separado"},
        )
        assert separated.status_code == 200, separated.text
        assert _stock(admin, product["id"], "U") == 2
        assert separated.json()["stock_applied"] is True

    def test_order_cannot_be_separated_or_fulfilled_without_stock_or_disassembly_source(self, admin):
        product = _prod(admin, "TEST_Estoque_Insuficiente", [{"size": "U", "stock": 1}])
        response = admin.post(
            f"{BASE_URL}/api/orders",
            json={
                "customer_name": "TEST_Estoque_Insuficiente",
                "items": [
                    {
                        "product_id": product["id"],
                        "name": product["name"],
                        "size": "U",
                        "qty": 1,
                        "unit_price": 10,
                    },
                    {
                        "product_id": product["id"],
                        "name": product["name"],
                        "size": "U",
                        "qty": 1,
                        "unit_price": 10,
                    },
                ],
            },
        )
        assert response.status_code == 200, response.text
        order = response.json()
        CREATED["orders"].append(order["id"])

        separated = admin.put(
            f"{BASE_URL}/api/orders/{order['id']}",
            json={"status": "Separado"},
        )
        assert separated.status_code == 400
        assert "Estoque insuficiente" in separated.json()["detail"]
        assert _stock(admin, product["id"], "U") == 1

        fulfilled = admin.post(
            f"{BASE_URL}/api/orders/{order['id']}/fulfill",
            json={"delivery_type": "RETIRADA"},
        )
        assert fulfilled.status_code == 400
        assert "Estoque insuficiente" in fulfilled.json()["detail"]
        current_order = admin.get(f"{BASE_URL}/api/orders/{order['id']}").json()
        assert current_order["status"] == "Anotado"
        assert _stock(admin, product["id"], "U") == 1
        assert not [
            movement
            for movement in admin.get(f"{BASE_URL}/api/stock_movements").json()
            if movement.get("order_id") == order["id"]
        ]

    def test_concurrent_order_fulfillments_preserve_stock_and_movements(self, admin):
        product = _prod(admin, "TEST_Baixa_Concorrente", [{"size": "U", "stock": 20}])
        orders = []
        for index in range(10):
            response = admin.post(
                f"{BASE_URL}/api/orders",
                json={
                    "customer_name": f"TEST_Baixa_Concorrente_{index}",
                    "status": "Separado",
                    "items": [{
                        "product_id": product["id"],
                        "name": product["name"],
                        "size": "U",
                        "qty": 1,
                        "unit_price": 10,
                    }],
                },
            )
            assert response.status_code == 200, response.text
            order = response.json()
            orders.append(order)
            CREATED["orders"].append(order["id"])

        def fulfill(order):
            return requests.post(
                f"{BASE_URL}/api/orders/{order['id']}/fulfill",
                json={"delivery_type": "RETIRADA"},
                timeout=15,
            )

        with ThreadPoolExecutor(max_workers=len(orders)) as executor:
            responses = list(executor.map(fulfill, orders))

        assert all(response.status_code == 200 for response in responses), [
            response.text for response in responses if response.status_code != 200
        ]
        assert _stock(admin, product["id"], "U") == 10
        movements = admin.get(f"{BASE_URL}/api/stock_movements").json()
        order_movements = [
            movement for movement in movements
            if movement.get("order_id") in {order["id"] for order in orders}
        ]
        assert len(order_movements) == 10
        assert sum(movement["qty"] for movement in order_movements if movement["kind"] == "SAIDA") == 10

    def test_concurrent_fulfillment_of_same_order_is_applied_once(self, admin):
        product = _prod(admin, "TEST_Baixa_Pedido_Duplicada", [{"size": "U", "stock": 5}])
        created = admin.post(
            f"{BASE_URL}/api/orders",
            json={
                "customer_name": "TEST_Baixa_Pedido_Duplicada",
                "status": "Separado",
                "items": [{
                    "product_id": product["id"],
                    "name": product["name"],
                    "size": "U",
                    "qty": 2,
                    "unit_price": 10,
                }],
            },
        )
        assert created.status_code == 200, created.text
        order = created.json()
        CREATED["orders"].append(order["id"])

        def fulfill():
            return requests.post(
                f"{BASE_URL}/api/orders/{order['id']}/fulfill",
                json={"delivery_type": "RETIRADA"},
                timeout=15,
            )

        with ThreadPoolExecutor(max_workers=2) as executor:
            responses = list(executor.map(lambda _: fulfill(), range(2)))

        assert sum(response.status_code == 200 for response in responses) == 1, [
            (response.status_code, response.text) for response in responses
        ]
        assert _stock(admin, product["id"], "U") == 3
        movements = admin.get(f"{BASE_URL}/api/stock_movements").json()
        order_movements = [movement for movement in movements if movement.get("order_id") == order["id"]]
        assert len(order_movements) == 1
        assert order_movements[0]["kind"] == "SAIDA" and order_movements[0]["qty"] == 2

    def test_fulfillment_decrements_product_with_empty_size(self, admin):
        product = _prod(admin, "TEST_Baixa_Tamanho_Vazio", [{"size": "", "stock": 4}])
        created = admin.post(
            f"{BASE_URL}/api/orders",
            json={
                "customer_name": "TEST_Baixa_Tamanho_Vazio",
                "status": "Separado",
                "items": [{
                    "product_id": product["id"],
                    "name": product["name"],
                    "size": "",
                    "qty": 2,
                    "unit_price": 10,
                }],
            },
        )
        assert created.status_code == 200, created.text
        order = created.json()
        CREATED["orders"].append(order["id"])

        completed = admin.post(
            f"{BASE_URL}/api/orders/{order['id']}/fulfill",
            json={"delivery_type": "RETIRADA"},
        )
        assert completed.status_code == 200, completed.text
        product_after = next(
            item for item in admin.get(f"{BASE_URL}/api/products").json()
            if item["id"] == product["id"]
        )
        assert product_after["sizes"] == [{"size": "", "stock": 2, "stock_min": 0}]
        movements = admin.get(f"{BASE_URL}/api/stock_movements").json()
        order_movements = [movement for movement in movements if movement.get("order_id") == order["id"]]
        assert len(order_movements) == 1
        assert order_movements[0]["kind"] == "SAIDA" and order_movements[0]["qty"] == 2

    def test_completed_order_marked_applied_without_movements_is_repaired(self, admin):
        from pymongo import MongoClient

        product = _prod(admin, "TEST_Baixa_Pendente_Antiga", [{"size": "U", "stock": 5}])
        created = admin.post(
            f"{BASE_URL}/api/orders",
            json={
                "customer_name": "TEST_Baixa_Pendente_Antiga",
                "status": "Anotado",
                "items": [{
                    "product_id": product["id"],
                    "name": product["name"],
                    "size": "U",
                    "qty": 2,
                    "unit_price": 10,
                }],
            },
        )
        assert created.status_code == 200, created.text
        order = created.json()
        CREATED["orders"].append(order["id"])
        with MongoClient(os.environ["MONGO_URL"]) as client:
            client[os.environ["DB_NAME"]].orders.update_one(
                {"id": order["id"]},
                {"$set": {"status": "Entregue", "stock_applied": True}},
            )

        retried = admin.put(
            f"{BASE_URL}/api/orders/{order['id']}",
            json={"status": "Entregue"},
        )
        assert retried.status_code == 200, retried.text
        assert retried.json()["stock_applied"] is True
        assert _stock(admin, product["id"], "U") == 3
        movements = admin.get(f"{BASE_URL}/api/stock_movements").json()
        order_movements = [movement for movement in movements if movement.get("order_id") == order["id"]]
        assert len(order_movements) == 1
        assert order_movements[0]["kind"] == "SAIDA" and order_movements[0]["qty"] == 2

    def test_completed_order_with_partial_movement_is_reconciled(self, admin):
        from pymongo import MongoClient

        product = _prod(admin, "TEST_Baixa_Parcial", [{"size": "U", "stock": 5}])
        created = admin.post(
            f"{BASE_URL}/api/orders",
            json={
                "customer_name": "TEST_Baixa_Parcial",
                "status": "Anotado",
                "items": [{
                    "product_id": product["id"],
                    "name": product["name"],
                    "size": "U",
                    "qty": 2,
                    "unit_price": 10,
                }],
            },
        )
        assert created.status_code == 200, created.text
        order = created.json()
        CREATED["orders"].append(order["id"])
        with MongoClient(os.environ["MONGO_URL"]) as client:
            database = client[os.environ["DB_NAME"]]
            sizes = database.products.find_one({"id": product["id"]})["sizes"]
            sizes[0]["stock"] = 4
            database.products.update_one({"id": product["id"]}, {"$set": {"sizes": sizes}})
            database.orders.update_one(
                {"id": order["id"]},
                {"$set": {"status": "Entregue", "stock_applied": True}},
            )
            database.stock_movements.insert_one({
                "id": uuid.uuid4().hex,
                "product_id": product["id"],
                "product_name": product["name"],
                "size": "U",
                "qty": 1,
                "kind": "SAIDA",
                "reason": f"VENDA pedido #{order['number']}",
                "order_id": order["id"],
                "created_at": "2025-01-01T00:00:00+00:00",
            })

        retried = admin.post(f"{BASE_URL}/api/orders/{order['id']}/repair-stock")
        assert retried.status_code == 200, retried.text
        assert retried.json()["stock_applied"] is True
        assert _stock(admin, product["id"], "U") == 3
        movements = admin.get(f"{BASE_URL}/api/stock_movements").json()
        order_movements = [movement for movement in movements if movement.get("order_id") == order["id"]]
        assert len(order_movements) == 1
        assert order_movements[0]["kind"] == "SAIDA" and order_movements[0]["qty"] == 2

    def test_separated_status_tracks_when_order_was_separated(self, admin):
        created = admin.post(
            f"{BASE_URL}/api/orders",
            json={"customer_name": "TEST_Separado", "items": [], "status": "Aprovado"},
        )
        assert created.status_code == 200, created.text
        order = created.json()
        CREATED["orders"].append(order["id"])
        assert "separated_at" not in order

        separated = admin.put(
            f"{BASE_URL}/api/orders/{order['id']}",
            json={"status": "Separado"},
        )
        assert separated.status_code == 200, separated.text
        assert separated.json()["separated_at"]

        reopened = admin.put(
            f"{BASE_URL}/api/orders/{order['id']}",
            json={"status": "Aprovado"},
        )
        assert reopened.status_code == 200, reopened.text
        assert reopened.json().get("separated_at") is None

    def test_order_signatures_are_only_returned_by_detail_endpoint(self, admin):
        signature = "data:image/png;base64,Zm9v"
        created = admin.post(
            f"{BASE_URL}/api/orders",
            json={
                "customer_name": "TEST_Assinatura",
                "status": "Orçamento",
                "signature": signature,
                "items": [],
            },
        )
        assert created.status_code == 200, created.text
        order = created.json()
        CREATED["orders"].append(order["id"])

        listing = admin.get(f"{BASE_URL}/api/orders")
        assert listing.status_code == 200
        listed_order = next(item for item in listing.json() if item["id"] == order["id"])
        assert "signature" not in listed_order

        detail = admin.get(f"{BASE_URL}/api/orders/{order['id']}")
        assert detail.status_code == 200
        assert detail.json()["signature"] == signature

    def test_venda_aprovado_stock_and_commission(self, admin):
        p = _prod(admin, "TEST_Cinto", [{"size": "U", "stock": 10}])
        r = admin.post(f"{BASE_URL}/api/orders", json={"customer_name": "TEST_Cli", "status": "Aprovado", "type": "VENDA",
                                                        "items": [{"product_id": p["id"], "name": p["name"], "size": "U", "qty": 3, "unit_price": 10}]})
        assert r.status_code == 200
        o = r.json(); CREATED["orders"].append(o["id"])
        assert o["total"] == 30 and o["number"] > 0
        assert _stock(admin, p["id"], "U") == 7
        coms = [c for c in admin.get(f"{BASE_URL}/api/commissions").json() if c["order_id"] == o["id"]]
        assert len(coms) == 1 and coms[0]["amount"] == 3

    def test_product_commission_and_linked_return_reduce_commission(self, admin):
        product = _prod(
            admin,
            "TEST_Comissao_Devolucao",
            [{"size": "M", "stock": 10}],
            commission=2.5,
        )
        sale_response = admin.post(
            f"{BASE_URL}/api/orders",
            json={
                "customer_name": "TEST_Comissao",
                "status": "Aprovado",
                "type": "VENDA",
                "items": [{
                    "product_id": product["id"],
                    "name": product["name"],
                    "size": "M",
                    "qty": 3,
                    "unit_price": 10,
                }],
            },
        )
        assert sale_response.status_code == 200, sale_response.text
        sale = sale_response.json()
        CREATED["orders"].append(sale["id"])
        assert sale["items"][0]["commission_value"] == 2.5
        commission = next(
            item for item in admin.get(f"{BASE_URL}/api/commissions").json()
            if item["order_id"] == sale["id"]
        )
        assert commission["amount"] == 7.5
        assert commission["items_count"] == 3

        fulfillment = admin.post(
            f"{BASE_URL}/api/orders/{sale['id']}/fulfill",
            json={"delivery_type": "RETIRADA"},
        )
        assert fulfillment.status_code == 200, fulfillment.text
        exchange_response = admin.post(
            f"{BASE_URL}/api/orders",
            json={
                "type": "TROCA",
                "status": "Aprovado",
                "customer_name": "TEST_Comissao",
                "original_order_id": sale["id"],
                "returned_items": [{
                    "product_id": product["id"],
                    "name": product["name"],
                    "size": "M",
                    "qty": 1,
                    "reason": "TEST_Devolução",
                }],
            },
        )
        assert exchange_response.status_code == 200, exchange_response.text
        exchange = exchange_response.json()
        CREATED["orders"].append(exchange["id"])
        exchange_fulfillment = admin.post(
            f"{BASE_URL}/api/orders/{exchange['id']}/fulfill",
            json={"delivery_type": "RETIRADA"},
        )
        assert exchange_fulfillment.status_code == 200, exchange_fulfillment.text

        updated_commission = next(
            item for item in admin.get(f"{BASE_URL}/api/commissions").json()
            if item["order_id"] == sale["id"]
        )
        assert updated_commission["amount"] == 5
        assert updated_commission["items_count"] == 2
        assert not [
            item for item in admin.get(f"{BASE_URL}/api/commissions").json()
            if item["order_id"] == exchange["id"]
        ]

    def test_vendor_signatures_are_only_returned_by_detail_endpoint(self, admin):
        signature = "data:image/png;base64,Zm9v"
        created = admin.post(
            f"{BASE_URL}/api/vendors",
            json={"name": "TEST_Assinatura", "signature": signature},
        )
        assert created.status_code == 200, created.text
        vendor_id = created.json()["id"]
        try:
            listing = admin.get(f"{BASE_URL}/api/vendors")
            assert listing.status_code == 200
            listed_vendor = next(item for item in listing.json() if item["id"] == vendor_id)
            assert "signature" not in listed_vendor

            detail = admin.get(f"{BASE_URL}/api/vendors/{vendor_id}")
            assert detail.status_code == 200
            assert detail.json()["signature"] == signature
        finally:
            admin.delete(f"{BASE_URL}/api/vendors/{vendor_id}")

    def test_orcamento_to_aprovado_once(self, admin):
        p = _prod(admin, "TEST_Mochila", [{"size": "U", "stock": 5}])
        o = admin.post(f"{BASE_URL}/api/orders", json={"customer_name": "TEST_Cli", "status": "Orçamento",
                                                        "items": [{"product_id": p["id"], "name": p["name"], "size": "U", "qty": 2, "unit_price": 10}]}).json()
        CREATED["orders"].append(o["id"])
        assert _stock(admin, p["id"], "U") == 5
        admin.put(f"{BASE_URL}/api/orders/{o['id']}", json={**o, "status": "Aprovado"})
        admin.put(f"{BASE_URL}/api/orders/{o['id']}", json={**o, "status": "Entregue"})
        assert _stock(admin, p["id"], "U") == 3
        coms = [c for c in admin.get(f"{BASE_URL}/api/commissions").json() if c["order_id"] == o["id"]]
        assert len(coms) == 1 and coms[0]["amount"] == 2

    def test_retirada_lanca_estoque_uma_unica_vez(self, admin):
        p = _prod(admin, "TEST_Bota", [{"size": "42", "stock": 5}])
        o = admin.post(f"{BASE_URL}/api/orders", json={"customer_name": "TEST_Cli", "status": "Aprovado",
                                                        "items": [{"product_id": p["id"], "name": p["name"], "size": "42", "qty": 2, "unit_price": 10}]}).json()
        CREATED["orders"].append(o["id"])

        response = admin.post(f"{BASE_URL}/api/orders/{o['id']}/fulfill", json={"delivery_type": "RETIRADA"})
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "Retirado"
        assert _stock(admin, p["id"], "42") == 3
        movements = [m for m in admin.get(f"{BASE_URL}/api/stock_movements").json() if m.get("order_id") == o["id"]]
        assert len(movements) == 1 and movements[0]["kind"] == "SAIDA"

        repeated = admin.post(f"{BASE_URL}/api/orders/{o['id']}/fulfill", json={"delivery_type": "RETIRADA"})
        assert repeated.status_code == 400
        assert _stock(admin, p["id"], "42") == 3

    def test_usuario_nao_admin_precisa_assinatura_para_concluir(self, admin):
        created_user = admin.post(
            f"{BASE_URL}/api/auth/users",
            json={
                "email": f"test_assinatura_{uuid.uuid4().hex[:8]}@lokal.com",
                "password": "vend123",
                "name": "TEST_Vendedor",
                "role": "vendedor",
            },
        )
        assert created_user.status_code == 200, created_user.text
        CREATED["users"].append(created_user.json()["id"])
        login = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": created_user.json()["email"], "password": "vend123"},
        )
        assert login.status_code == 200, login.text
        vendor = requests.Session()
        vendor.headers["Authorization"] = f"Bearer {login.json()['access_token']}"

        product = _prod(admin, "TEST_Assinatura", [{"size": "U", "stock": 2}])
        order_response = admin.post(
            f"{BASE_URL}/api/orders",
            json={
                "customer_name": "TEST_Assinatura",
                "status": "Separado",
                "items": [{
                    "product_id": product["id"],
                    "name": product["name"],
                    "size": "U",
                    "qty": 1,
                    "unit_price": 10,
                }],
            },
        )
        assert order_response.status_code == 200, order_response.text
        order = order_response.json()
        CREATED["orders"].append(order["id"])

        without_signature = vendor.post(
            f"{BASE_URL}/api/orders/{order['id']}/fulfill",
            json={"delivery_type": "RETIRADA"},
        )
        assert without_signature.status_code == 400
        assert _stock(admin, product["id"], "U") == 1

        with_signature = vendor.post(
            f"{BASE_URL}/api/orders/{order['id']}/fulfill",
            json={
                "delivery_type": "RETIRADA",
                "signature": "data:image/png;base64,Zm9v",
            },
        )
        assert with_signature.status_code == 200, with_signature.text
        assert _stock(admin, product["id"], "U") == 1

    def test_entrega_por_transportadora_baixa_estoque_sem_viagem(self, admin):
        p = _prod(admin, "TEST_Casaco", [{"size": "M", "stock": 4}])
        o = admin.post(f"{BASE_URL}/api/orders", json={"customer_name": "TEST_Cli", "status": "Aprovado",
                                                        "items": [{"product_id": p["id"], "name": p["name"], "size": "M", "qty": 1, "unit_price": 25}]}).json()
        CREATED["orders"].append(o["id"])

        response = admin.post(f"{BASE_URL}/api/orders/{o['id']}/fulfill", json={"delivery_type": "CORREIO"})
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "Entregue"
        assert response.json()["delivery_type"] == "CORREIO"
        assert _stock(admin, p["id"], "M") == 3
        trips = [expense for expense in admin.get(f"{BASE_URL}/api/expenses").json() if expense.get("order_id") == o["id"]]
        assert trips == []

    def test_reabrir_pedido_remove_viagem_e_atualiza_fechamento(self, admin):
        product = _prod(admin, "TEST_Rota_ao_Reabrir", [{"size": "U", "stock": 3}])
        created = admin.post(
            f"{BASE_URL}/api/orders",
            json={
                "customer_name": "TEST_Cliente_Rota_Livre",
                "items": [{
                    "product_id": product["id"],
                    "name": product["name"],
                    "size": "U",
                    "qty": 1,
                    "unit_price": 10,
                }],
            },
        )
        assert created.status_code == 200, created.text
        order = created.json()
        CREATED["orders"].append(order["id"])
        customer = next(
            item for item in admin.get(f"{BASE_URL}/api/customers").json()
            if item["id"] == order["customer_id"]
        )
        CREATED["customers"].append(customer["id"])
        assert customer["name"] == "TEST_Cliente_Rota_Livre"

        separated = admin.put(
            f"{BASE_URL}/api/orders/{order['id']}",
            json={"status": "Separado"},
        )
        assert separated.status_code == 200, separated.text
        assert _stock(admin, product["id"], "U") == 2
        delivered = admin.post(
            f"{BASE_URL}/api/orders/{order['id']}/fulfill",
            json={"delivery_type": "ENTREGA"},
        )
        assert delivered.status_code == 200, delivered.text
        trips = [
            expense for expense in admin.get(f"{BASE_URL}/api/expenses").json()
            if expense.get("order_id") == order["id"]
        ]
        assert len(trips) == 1

        report = admin.post(f"{BASE_URL}/api/dashboard/close-day")
        assert report.status_code == 200, report.text
        assert any(
            expense.get("order_id") == order["id"]
            for expense in report.json()["expenses"]
        )

        reopened = admin.put(
            f"{BASE_URL}/api/orders/{order['id']}",
            json={"status": "Separado"},
        )
        assert reopened.status_code == 200, reopened.text
        assert _stock(admin, product["id"], "U") == 2
        assert not [
            expense for expense in admin.get(f"{BASE_URL}/api/expenses").json()
            if expense.get("order_id") == order["id"]
        ]
        refreshed_report = admin.get(
            f"{BASE_URL}/api/dashboard/closures/{report.json()['date']}"
        )
        assert refreshed_report.status_code == 200, refreshed_report.text
        assert not [
            expense for expense in refreshed_report.json()["expenses"]
            if expense.get("order_id") == order["id"]
        ]

        delivered_again = admin.post(
            f"{BASE_URL}/api/orders/{order['id']}/fulfill",
            json={"delivery_type": "ENTREGA"},
        )
        assert delivered_again.status_code == 200, delivered_again.text
        assert len([
            expense for expense in admin.get(f"{BASE_URL}/api/expenses").json()
            if expense.get("order_id") == order["id"]
        ]) == 1
        redelivery_report = admin.get(
            f"{BASE_URL}/api/dashboard/closures/{report.json()['date']}"
        )
        assert redelivery_report.status_code == 200, redelivery_report.text
        assert any(
            expense.get("order_id") == order["id"]
            for expense in redelivery_report.json()["expenses"]
        )

        cancelled = admin.put(
            f"{BASE_URL}/api/orders/{order['id']}",
            json={"status": "Cancelado"},
        )
        assert cancelled.status_code == 200, cancelled.text
        assert _stock(admin, product["id"], "U") == 3
        assert not [
            expense for expense in admin.get(f"{BASE_URL}/api/expenses").json()
            if expense.get("order_id") == order["id"]
        ]
        final_report = admin.get(
            f"{BASE_URL}/api/dashboard/closures/{report.json()['date']}"
        )
        assert final_report.status_code == 200, final_report.text
        assert not [
            expense for expense in final_report.json()["expenses"]
            if expense.get("order_id") == order["id"]
        ]

    def test_excluir_viagem_vinculada_ao_pedido_atualiza_km_e_fechamento(self, admin):
        customer_response = admin.post(
            f"{BASE_URL}/api/customers",
            json={
                "name": f"TEST_Cliente_Excluir_Viagem_{uuid.uuid4().hex[:6]}",
                "address": "Rua da Teste",
                "distance_km": 12,
            },
        )
        assert customer_response.status_code == 200, customer_response.text
        customer = customer_response.json()
        CREATED["customers"].append(customer["id"])
        vehicle_response = admin.post(
            f"{BASE_URL}/api/vehicles",
            json={
                "name": f"TEST_Veiculo_Excluir_Viagem_{uuid.uuid4().hex[:6]}",
                "current_km": 100,
            },
        )
        assert vehicle_response.status_code == 200, vehicle_response.text
        vehicle = vehicle_response.json()
        CREATED["vehicles"].append(vehicle["id"])
        product = _prod(admin, "TEST_Produto_Excluir_Viagem", [{"size": "U", "stock": 2}])
        order_response = admin.post(
            f"{BASE_URL}/api/orders",
            json={
                "customer_id": customer["id"],
                "customer_name": customer["name"],
                "items": [{
                    "product_id": product["id"],
                    "name": product["name"],
                    "size": "U",
                    "qty": 1,
                    "unit_price": 10,
                }],
            },
        )
        assert order_response.status_code == 200, order_response.text
        order = order_response.json()
        CREATED["orders"].append(order["id"])
        delivered = admin.post(
            f"{BASE_URL}/api/orders/{order['id']}/fulfill",
            json={"delivery_type": "ENTREGA", "vehicle_id": vehicle["id"]},
        )
        assert delivered.status_code == 200, delivered.text
        trips = [
            expense for expense in admin.get(f"{BASE_URL}/api/expenses").json()
            if expense.get("order_id") == order["id"]
        ]
        assert len(trips) == 1
        trip = trips[0]
        assert trip["km"] == 24
        report = admin.post(f"{BASE_URL}/api/dashboard/close-day")
        assert report.status_code == 200, report.text
        assert any(expense.get("id") == trip["id"] for expense in report.json()["expenses"])

        deleted = admin.delete(f"{BASE_URL}/api/expenses/{trip['id']}")
        assert deleted.status_code == 200, deleted.text
        assert deleted.json()["deleted"] == 1
        assert not [
            expense for expense in admin.get(f"{BASE_URL}/api/expenses").json()
            if expense.get("id") == trip["id"]
        ]
        updated_vehicle = next(
            item for item in admin.get(f"{BASE_URL}/api/vehicles").json()
            if item["id"] == vehicle["id"]
        )
        assert updated_vehicle["current_km"] == 100
        updated_report = admin.get(
            f"{BASE_URL}/api/dashboard/closures/{report.json()['date']}"
        )
        assert updated_report.status_code == 200, updated_report.text
        assert not any(
            expense.get("id") == trip["id"]
            for expense in updated_report.json()["expenses"]
        )

    def test_admin_altera_status_e_sincroniza_estoque(self, admin):
        p = _prod(admin, "TEST_Coturno", [{"size": "40", "stock": 5}])
        o = admin.post(f"{BASE_URL}/api/orders", json={"customer_name": "TEST_Cli", "status": "Aprovado",
                                                        "items": [{"product_id": p["id"], "name": p["name"], "size": "40", "qty": 2, "unit_price": 10}],
                                                        "returned_items": [{"product_id": p["id"], "name": p["name"], "size": "40", "qty": 1, "reason": "TEST_troca"}]}).json()
        CREATED["orders"].append(o["id"])

        completed = admin.put(f"{BASE_URL}/api/orders/{o['id']}", json={**o, "status": "Retirado"})
        assert completed.status_code == 200, completed.text
        assert _stock(admin, p["id"], "40") == 4
        movements = [m for m in admin.get(f"{BASE_URL}/api/stock_movements").json() if m.get("order_id") == o["id"]]
        assert sorted((movement["kind"], movement["qty"]) for movement in movements) == [("ENTRADA", 1), ("SAIDA", 2)]

        reopened = admin.put(f"{BASE_URL}/api/orders/{o['id']}", json={**completed.json(), "status": "Separado"})
        assert reopened.status_code == 200, reopened.text
        assert _stock(admin, p["id"], "40") == 4
        movements = [m for m in admin.get(f"{BASE_URL}/api/stock_movements").json() if m.get("order_id") == o["id"]]
        assert sorted((movement["kind"], movement["qty"]) for movement in movements) == [
            ("ENTRADA", 1), ("SAIDA", 2),
        ]

    def test_sync_anotado_order_reverses_stale_stock_movement(self, admin):
        from pymongo import MongoClient

        product = _prod(admin, "TEST_Sincronizar_Separado", [{"size": "U", "stock": 5}])
        created = admin.post(
            f"{BASE_URL}/api/orders",
            json={
                "customer_name": "TEST_Sincronizar_Separado",
                "status": "Anotado",
                "items": [{
                    "product_id": product["id"],
                    "name": product["name"],
                    "size": "U",
                    "qty": 2,
                    "unit_price": 10,
                }],
            },
        )
        assert created.status_code == 200, created.text
        order = created.json()
        CREATED["orders"].append(order["id"])
        with MongoClient(os.environ["MONGO_URL"]) as client:
            database = client[os.environ["DB_NAME"]]
            sizes = database.products.find_one({"id": product["id"]})["sizes"]
            sizes[0]["stock"] = 3
            database.products.update_one({"id": product["id"]}, {"$set": {"sizes": sizes}})
            database.stock_movements.insert_one({
                "id": uuid.uuid4().hex,
                "product_id": product["id"],
                "product_name": product["name"],
                "size": "U",
                "qty": 2,
                "kind": "SAIDA",
                "reason": f"VENDA pedido #{order['number']}",
                "order_id": order["id"],
                "created_at": "2025-01-01T00:00:00+00:00",
            })

        synchronized = admin.post(f"{BASE_URL}/api/orders/{order['id']}/sync-stock-status")
        assert synchronized.status_code == 200, synchronized.text
        assert synchronized.json()["status"] == "Anotado"
        assert synchronized.json()["stock_applied"] is False
        assert _stock(admin, product["id"], "U") == 5
        assert not [
            movement
            for movement in admin.get(f"{BASE_URL}/api/stock_movements").json()
            if movement.get("order_id") == order["id"]
        ]

    def test_sync_separated_order_reverses_legacy_empty_size_from_original_stock_size(self, admin):
        from pymongo import MongoClient

        product = _prod(
            admin,
            "TEST_Sincronizar_Tamanho_Legado",
            [{"size": "", "stock": 4}, {"size": "-", "stock": -2}],
        )
        created = admin.post(
            f"{BASE_URL}/api/orders",
            json={
                "customer_name": "TEST_Sincronizar_Tamanho_Legado",
                "status": "Anotado",
                "items": [{
                    "product_id": product["id"],
                    "name": product["name"],
                    "size": "",
                    "qty": 2,
                    "unit_price": 10,
                }],
            },
        )
        assert created.status_code == 200, created.text
        order = created.json()
        CREATED["orders"].append(order["id"])
        with MongoClient(os.environ["MONGO_URL"]) as client:
            client[os.environ["DB_NAME"]].stock_movements.insert_one({
                "id": uuid.uuid4().hex,
                "product_id": product["id"],
                "product_name": product["name"],
                "size": "",
                "qty": 2,
                "kind": "SAIDA",
                "reason": f"VENDA pedido #{order['number']}",
                "order_id": order["id"],
                "created_at": "2025-01-01T00:00:00+00:00",
            })

        synchronized = admin.post(f"{BASE_URL}/api/orders/{order['id']}/sync-stock-status")
        assert synchronized.status_code == 200, synchronized.text
        product_after = next(
            item for item in admin.get(f"{BASE_URL}/api/products").json()
            if item["id"] == product["id"]
        )
        assert product_after["sizes"] == [
            {"size": "", "stock": 4, "stock_min": 0},
            {"size": "-", "stock": 0, "stock_min": 0},
        ]
        assert not [
            movement
            for movement in admin.get(f"{BASE_URL}/api/stock_movements").json()
            if movement.get("order_id") == order["id"]
        ]

    def test_repair_completed_legacy_empty_size_moves_stock_to_correct_variant(self, admin):
        from pymongo import MongoClient

        product = _prod(
            admin,
            "TEST_Corrigir_Tamanho_Legado_Entregue",
            [{"size": "", "stock": 4}, {"size": "-", "stock": -2}],
        )
        created = admin.post(
            f"{BASE_URL}/api/orders",
            json={
                "customer_name": "TEST_Corrigir_Tamanho_Legado_Entregue",
                "status": "Anotado",
                "items": [{
                    "product_id": product["id"],
                    "name": product["name"],
                    "size": "",
                    "qty": 2,
                    "unit_price": 10,
                }],
            },
        )
        assert created.status_code == 200, created.text
        order = created.json()
        CREATED["orders"].append(order["id"])
        with MongoClient(os.environ["MONGO_URL"]) as client:
            database = client[os.environ["DB_NAME"]]
            database.orders.update_one(
                {"id": order["id"]},
                {"$set": {"status": "Entregue", "stock_applied": True}},
            )
            database.stock_movements.insert_one({
                "id": uuid.uuid4().hex,
                "product_id": product["id"],
                "product_name": product["name"],
                "size": "",
                "qty": 2,
                "kind": "SAIDA",
                "reason": f"VENDA pedido #{order['number']}",
                "order_id": order["id"],
                "created_at": "2025-01-01T00:00:00+00:00",
            })

        repaired = admin.post(f"{BASE_URL}/api/orders/{order['id']}/repair-stock")
        assert repaired.status_code == 200, repaired.text
        product_after = next(
            item for item in admin.get(f"{BASE_URL}/api/products").json()
            if item["id"] == product["id"]
        )
        assert product_after["sizes"] == [
            {"size": "", "stock": 2, "stock_min": 0},
            {"size": "-", "stock": 0, "stock_min": 0},
        ]
        movement = next(
            item for item in admin.get(f"{BASE_URL}/api/stock_movements").json()
            if item.get("order_id") == order["id"]
        )
        assert movement["kind"] == "SAIDA" and movement["stock_size"] == ""

    def test_cancelamento_reverte_apenas_saida_de_pedido_concluido(self, admin):
        product = _prod(admin, "TEST_Cancelamento", [{"size": "U", "stock": 5}])
        created = admin.post(
            f"{BASE_URL}/api/orders",
            json={
                "customer_name": "TEST_Cancelamento",
                "status": "Separado",
                "items": [{
                    "product_id": product["id"],
                    "name": product["name"],
                    "size": "U",
                    "qty": 2,
                    "unit_price": 10,
                }],
                "returned_items": [{
                    "product_id": product["id"],
                    "name": product["name"],
                    "size": "U",
                    "qty": 1,
                    "reason": "TEST_devolucao",
                }],
            },
        )
        assert created.status_code == 200, created.text
        order = created.json()
        CREATED["orders"].append(order["id"])
        assert _stock(admin, product["id"], "U") == 4

        completed = admin.post(
            f"{BASE_URL}/api/orders/{order['id']}/fulfill",
            json={"delivery_type": "RETIRADA"},
        )
        assert completed.status_code == 200, completed.text
        assert _stock(admin, product["id"], "U") == 4

        cancelled = admin.put(
            f"{BASE_URL}/api/orders/{order['id']}",
            json={"status": "Cancelado"},
        )
        assert cancelled.status_code == 200, cancelled.text
        assert cancelled.json()["status"] == "Cancelado"
        assert _stock(admin, product["id"], "U") == 6
        movements = [
            movement
            for movement in admin.get(f"{BASE_URL}/api/stock_movements").json()
            if movement.get("order_id") == order["id"]
        ]
        assert len(movements) == 1 and movements[0]["kind"] == "ENTRADA"

        repeated_cancel = admin.put(
            f"{BASE_URL}/api/orders/{order['id']}",
            json={"status": "Cancelado"},
        )
        assert repeated_cancel.status_code == 200, repeated_cancel.text
        assert _stock(admin, product["id"], "U") == 6

        separated_order = admin.post(
            f"{BASE_URL}/api/orders",
            json={
                "customer_name": "TEST_Cancelamento_sem_saida",
                "status": "Separado",
                "items": [{
                    "product_id": product["id"],
                    "name": product["name"],
                    "size": "U",
                    "qty": 2,
                    "unit_price": 10,
                }],
            },
        )
        assert separated_order.status_code == 200, separated_order.text
        separated = separated_order.json()
        CREATED["orders"].append(separated["id"])
        cancelled_separated = admin.put(
            f"{BASE_URL}/api/orders/{separated['id']}",
            json={"status": "Cancelado"},
        )
        assert cancelled_separated.status_code == 200, cancelled_separated.text
        assert _stock(admin, product["id"], "U") == 6
        assert not [
            movement
            for movement in admin.get(f"{BASE_URL}/api/stock_movements").json()
            if movement.get("order_id") == separated["id"]
        ]

    def test_desmontagem_farda(self, admin):
        calca = _prod(admin, "TEST_CALÇA CAMUFLADA", [{"size": "M", "stock": 0}])
        gandola = _prod(admin, "TEST_GANDOLA CAMUFLADA", [{"size": "M", "stock": 0}])
        farda = _prod(
            admin,
            "TEST_FARDA CAMUFLADA",
            [{"size": "M", "stock": 1}],
            linked_ids=[calca["id"], gandola["id"]],
        )
        created = admin.post(f"{BASE_URL}/api/orders", json={"customer_name": "TEST_Cli", "status": "Separado",
                                                        "items": [{"product_id": calca["id"], "name": calca["name"], "size": "M", "qty": 1, "unit_price": 100}]}).json()
        CREATED["orders"].append(created["id"])
        assert _stock(admin, farda["id"], "M") == 0
        assert _stock(admin, calca["id"], "M") == 0
        assert _stock(admin, gandola["id"], "M") == 1

        completed = admin.put(
            f"{BASE_URL}/api/orders/{created['id']}",
            json={"status": "Entregue"},
        )
        assert completed.status_code == 200, completed.text
        assert _stock(admin, farda["id"], "M") == 0
        assert _stock(admin, calca["id"], "M") == 0
        assert _stock(admin, gandola["id"], "M") == 1
        od = next(x for x in admin.get(f"{BASE_URL}/api/orders").json() if x["id"] == created["id"])
        assert any("FARDA" in l for l in od.get("log", []))
        order_movements = [
            movement
            for movement in admin.get(f"{BASE_URL}/api/stock_movements").json()
            if movement.get("order_id") == created["id"]
        ]
        assert sorted((movement["kind"], movement["product_id"], movement["qty"]) for movement in order_movements) == sorted([
            ("DESMONTAGEM_SAIDA", farda["id"], 1),
            ("DESMONTAGEM_ENTRADA", calca["id"], 1),
            ("DESMONTAGEM_ENTRADA", gandola["id"], 1),
            ("SAIDA", calca["id"], 1),
        ])

    def test_invalid_stock_item_does_not_complete_order_or_lock_application(self, admin):
        product = _prod(admin, "TEST_Tamanho_Invalido_Entrega", [{"size": "M", "stock": 2}])
        created = admin.post(
            f"{BASE_URL}/api/orders",
            json={
                "customer_name": "TEST_Tamanho_Invalido_Entrega",
                "status": "Separado",
                "items": [{
                    "product_id": product["id"],
                    "name": product["name"],
                    "size": "PP",
                    "qty": 1,
                    "unit_price": 10,
                }],
            },
        )
        assert created.status_code == 200, created.text
        order = created.json()
        CREATED["orders"].append(order["id"])

        rejected = admin.put(
            f"{BASE_URL}/api/orders/{order['id']}",
            json={"status": "Entregue"},
        )
        assert rejected.status_code == 400
        current_order = admin.get(f"{BASE_URL}/api/orders/{order['id']}").json()
        assert current_order["status"] == "Separado"
        assert current_order["stock_applied"] is False
        assert _stock(admin, product["id"], "M") == 2
        assert not [
            movement
            for movement in admin.get(f"{BASE_URL}/api/stock_movements").json()
            if movement.get("order_id") == order["id"]
        ]

    def test_troca_linked_and_avulsa(self, admin):
        p = _prod(admin, "TEST_Camiseta", [{"size": "G", "stock": 5}, {"size": "M", "stock": 5}])
        v = admin.post(f"{BASE_URL}/api/orders", json={"customer_name": "TEST_Cli", "status": "Aprovado",
                                                        "items": [{"product_id": p["id"], "name": p["name"], "size": "G", "qty": 1, "unit_price": 50}]}).json()
        CREATED["orders"].append(v["id"])
        original_fulfillment = admin.post(f"{BASE_URL}/api/orders/{v['id']}/fulfill", json={"delivery_type": "RETIRADA"})
        assert original_fulfillment.status_code == 200, original_fulfillment.text
        assert _stock(admin, p["id"], "G") == 4
        t_response = admin.post(f"{BASE_URL}/api/orders", json={"type": "TROCA", "status": "Aprovado", "customer_name": "TEST_Cli",
                                                        "original_order_id": v["id"],
                                                        "items": [{"product_id": p["id"], "name": p["name"], "size": "M", "qty": 1, "unit_price": 50}],
                                                        "returned_items": [{"product_id": p["id"], "name": p["name"], "size": "G", "qty": 1, "reason": "tamanho"}]})
        assert t_response.status_code == 200, t_response.text
        t = t_response.json()
        CREATED["orders"].append(t["id"])
        assert t["original_order_id"] == v["id"]
        exchange_fulfillment = admin.post(f"{BASE_URL}/api/orders/{t['id']}/fulfill", json={"delivery_type": "RETIRADA"})
        assert exchange_fulfillment.status_code == 200, exchange_fulfillment.text
        assert _stock(admin, p["id"], "G") == 5
        assert _stock(admin, p["id"], "M") == 4
        exchange_movements = [m for m in admin.get(f"{BASE_URL}/api/stock_movements").json() if m.get("order_id") == t["id"]]
        assert sorted((movement["kind"], movement["size"], movement["qty"]) for movement in exchange_movements) == [
            ("ENTRADA", "G", 1), ("SAIDA", "M", 1),
        ]
        return_response = admin.post(f"{BASE_URL}/api/orders", json={"type": "DEVOLUCAO", "status": "Aprovado", "customer_name": "TEST_Cli", "avulsa": True,
                                                        "items": [], "returned_items": [{"product_id": p["id"], "name": p["name"], "size": "M", "qty": 1}]})
        assert return_response.status_code == 200, return_response.text
        d = return_response.json()
        CREATED["orders"].append(d["id"])
        assert d["avulsa"] is True
        return_fulfillment = admin.post(f"{BASE_URL}/api/orders/{d['id']}/fulfill", json={"delivery_type": "RETIRADA"})
        assert return_fulfillment.status_code == 200, return_fulfillment.text
        assert _stock(admin, p["id"], "M") == 5
        return_movements = [m for m in admin.get(f"{BASE_URL}/api/stock_movements").json() if m.get("order_id") == d["id"]]
        assert len(return_movements) == 1 and return_movements[0]["kind"] == "ENTRADA"
        # no commission for troca
        assert not [c for c in admin.get(f"{BASE_URL}/api/commissions").json() if c["order_id"] == t["id"]]


# --- Generic CRUD ---
@pytest.mark.parametrize("coll,payload", [
    ("customers", {"name": "TEST_Loja X", "nome_guerra": "Silva"}),
    ("categories", {"name": "TEST_Cat", "color": "#000000"}),
    ("suppliers", {"name": "TEST_Forn", "cnpj": "00"}),
    ("expenses", {"type": "VIAGEM", "description": "TEST_Viagem", "fuel_cost": 100, "toll_cost": 20, "route": "RJ-SP"}),
    ("expenses", {"type": "MANUTENCAO", "description": "TEST_Oleo", "amount": 50, "plate": "ABC1D23"}),
    ("expenses", {"type": "INSUMO", "description": "TEST_Linha", "amount": 10}),
])
def test_crud(admin, coll, payload):
    r = admin.post(f"{BASE_URL}/api/{coll}", json=payload)
    assert r.status_code == 200, r.text
    i = r.json()["id"]
    g = admin.get(f"{BASE_URL}/api/{coll}/{i}")
    assert g.status_code == 200 and g.json()["description" if coll == "expenses" else "name"].startswith("TEST_")
    u = admin.put(f"{BASE_URL}/api/{coll}/{i}", json={"notes": "upd"} if coll == "suppliers" else {"name": "TEST_upd"} if coll != "expenses" else {"description": "TEST_upd"})
    assert u.status_code == 200
    d = admin.delete(f"{BASE_URL}/api/{coll}/{i}")
    assert d.json()["deleted"] == 1
    assert admin.get(f"{BASE_URL}/api/{coll}/{i}").status_code == 404


# --- Settings & dashboard ---
def test_settings_persist(admin):
    old = admin.get(f"{BASE_URL}/api/settings").json()
    r = admin.put(f"{BASE_URL}/api/settings", json={"background_color": "#E8E4D9"})
    assert r.status_code == 200 and r.json()["background_color"] == "#E8E4D9"
    assert admin.get(f"{BASE_URL}/api/settings").json()["background_color"] == "#E8E4D9"
    admin.put(f"{BASE_URL}/api/settings", json={"background_color": old.get("background_color", "#F5F5F5")})

def test_vehicle_fuels_and_trip_cost_use_settings(admin):
    old_fuel_prices = admin.get(f"{BASE_URL}/api/settings").json().get("fuel_prices", {})
    invalid_price = admin.put(
        f"{BASE_URL}/api/settings",
        json={"fuel_prices": {"Diesel": -1}},
    )
    assert invalid_price.status_code == 400, invalid_price.text
    settings_update = admin.put(
        f"{BASE_URL}/api/settings",
        json={"fuel_prices": {**old_fuel_prices, "Diesel": 6.5}},
    )
    assert settings_update.status_code == 200, settings_update.text

    vehicle_response = admin.post(
        f"{BASE_URL}/api/vehicles",
        json={
            "name": f"TEST_Combustivel_{uuid.uuid4().hex[:6]}",
            "avg_consumption": 12,
            "fuel_types": ["Gasolina", "Diesel"],
        },
    )
    assert vehicle_response.status_code == 200, vehicle_response.text
    vehicle = vehicle_response.json()
    CREATED["vehicles"].append(vehicle["id"])
    assert vehicle["fuel_types"] == ["Gasolina", "Diesel"]

    trip_response = admin.post(
        f"{BASE_URL}/api/expenses",
        json={
            "type": "VIAGEM",
            "description": "TEST_Consumo Diesel",
            "vehicle_id": vehicle["id"],
            "fuel_type": "Diesel",
            "km": 120,
        },
    )
    assert trip_response.status_code == 200, trip_response.text
    trip = trip_response.json()
    CREATED["expenses"].append(trip["id"])
    assert trip["avg_consumption"] == 12
    assert trip["fuel_liters"] == 10
    assert trip["fuel_quantity"] == 10
    assert trip["fuel_quantity_unit"] == "L"
    assert trip["fuel_price_per_liter"] == 6.5
    assert trip["fuel_cost"] == 65

    gnv_vehicle_response = admin.post(
        f"{BASE_URL}/api/vehicles",
        json={
            "name": f"TEST_GNV_{uuid.uuid4().hex[:6]}",
            "avg_consumption": 25,
            "fuel_types": ["GNV", "Gasolina"],
        },
    )
    assert gnv_vehicle_response.status_code == 200, gnv_vehicle_response.text
    gnv_vehicle = gnv_vehicle_response.json()
    CREATED["vehicles"].append(gnv_vehicle["id"])
    gnv_trip_response = admin.post(
        f"{BASE_URL}/api/expenses",
        json={
            "type": "VIAGEM",
            "description": "TEST_Consumo GNV",
            "vehicle_id": gnv_vehicle["id"],
            "fuel_type": "GNV",
            "km": 100,
            "fuel_price_per_unit": 2,
            "fuelings": [
                {"amount": 10, "price_per_unit": 2, "fuel_type": "GNV"},
                {"amount": 24, "price_per_unit": 6, "fuel_type": "Gasolina"},
            ],
        },
    )
    assert gnv_trip_response.status_code == 200, gnv_trip_response.text
    gnv_trip = gnv_trip_response.json()
    CREATED["expenses"].append(gnv_trip["id"])
    assert gnv_trip["fuel_quantity"] == 5
    assert gnv_trip["fuel_quantities"] == {
        "GNV": {"quantity": 5, "unit": "m³"},
        "Gasolina": {"quantity": 4, "unit": "L"},
    }
    assert gnv_trip["fuel_quantity_unit"] == "m³"
    assert gnv_trip["estimated_fuel_quantity"] == 4
    assert gnv_trip["fuel_liters"] == 0
    assert gnv_trip["fuel_cost"] == 34

    invalid_fuel = admin.post(
        f"{BASE_URL}/api/expenses",
        json={
            "type": "VIAGEM",
            "description": "TEST_Combustível incompatível",
            "vehicle_id": vehicle["id"],
            "fuel_type": "GNV",
            "km": 10,
        },
    )
    assert invalid_fuel.status_code == 400, invalid_fuel.text
    admin.put(f"{BASE_URL}/api/settings", json={"fuel_prices": old_fuel_prices})

def test_trip_supports_multiple_destinations_fuelings_tolls_and_allowance(admin):
    customer_response = admin.post(
        f"{BASE_URL}/api/customers",
        json={"name": f"TEST_Cliente_{uuid.uuid4().hex[:6]}", "address": "Rua A", "distance_km": 10},
    )
    supplier_response = admin.post(
        f"{BASE_URL}/api/suppliers",
        json={
            "name": f"TEST_Fornecedor_{uuid.uuid4().hex[:6]}",
            "cep": "21745590",
            "address_number": "550",
            "address": "Rua Salustiano Silva, 550, CEP 21745-590",
            "distance_km": 15,
        },
    )
    vehicle_response = admin.post(
        f"{BASE_URL}/api/vehicles",
        json={"name": f"TEST_Veiculo_{uuid.uuid4().hex[:6]}", "avg_consumption": 10, "fuel_type": "Gasolina"},
    )
    assert customer_response.status_code == 200, customer_response.text
    assert supplier_response.status_code == 200, supplier_response.text
    assert vehicle_response.status_code == 200, vehicle_response.text
    customer = customer_response.json()
    supplier = supplier_response.json()
    vehicle = vehicle_response.json()
    assert supplier["cep"] == "21745590"
    assert supplier["address_number"] == "550"
    assert supplier["address"] == "Rua Salustiano Silva, 550, CEP 21745-590"
    CREATED["customers"].append(customer["id"])
    CREATED["suppliers"].append(supplier["id"])
    CREATED["vehicles"].append(vehicle["id"])

    trip_response = admin.post(
        f"{BASE_URL}/api/expenses",
        json={
            "type": "VIAGEM",
            "description": "TEST_Rota múltipla",
            "vehicle_id": vehicle["id"],
            "destinations": [
                {"destination_type": "cliente", "destination_id": customer["id"]},
                {"destination_type": "fornecedor", "destination_id": supplier["id"]},
            ],
            "fuelings": [
                {"amount": 100, "price_per_liter": 5},
                {"amount": 60, "price_per_liter": 6},
            ],
            "tolls": [{"description": "Praça 1", "amount": 8}, {"amount": 12}],
            "daily_allowance": 50,
        },
    )
    assert trip_response.status_code == 200, trip_response.text
    trip = trip_response.json()
    CREATED["expenses"].append(trip["id"])
    assert len(trip["destinations"]) == 2
    assert trip["km"] == 50
    assert trip["route"] == "Depósito → Rua A → " + supplier["name"] + " → Depósito"
    assert trip["fuel_cost"] == 160
    assert trip["fuel_liters"] == 30
    assert trip["estimated_fuel_liters"] == 5
    assert trip["toll_cost"] == 20
    assert trip["daily_allowance"] == 50

def test_order_number_sequence_is_admin_configurable_without_decreasing(admin):
    sequence = admin.get(f"{BASE_URL}/api/orders/number-sequence")
    assert sequence.status_code == 200, sequence.text
    current_number = sequence.json()["current_number"]
    assert isinstance(current_number, int)

    unchanged = admin.put(
        f"{BASE_URL}/api/orders/number-sequence",
        json={"current_number": current_number},
    )
    assert unchanged.status_code == 200, unchanged.text
    assert unchanged.json()["current_number"] == current_number

    if current_number > 0:
        lower = admin.put(
            f"{BASE_URL}/api/orders/number-sequence",
            json={"current_number": current_number - 1},
        )
        assert lower.status_code == 400

    invalid = admin.put(
        f"{BASE_URL}/api/orders/number-sequence",
        json={"current_number": -1},
    )
    assert invalid.status_code == 422


def test_deleting_latest_order_reuses_its_number(admin):
    current_number = admin.get(f"{BASE_URL}/api/orders/number-sequence").json()["current_number"]

    order = admin.post(
        f"{BASE_URL}/api/orders",
        json={"customer_name": "TEST_Numeração", "items": [], "status": "Orçamento"},
    )
    assert order.status_code == 200, order.text
    CREATED["orders"].append(order.json()["id"])
    order_number = order.json()["number"]
    assert order_number == current_number + 1

    deleted = admin.delete(f"{BASE_URL}/api/orders/{order.json()['id']}")
    assert deleted.status_code == 200, deleted.text
    assert admin.get(f"{BASE_URL}/api/orders/number-sequence").json()["current_number"] == current_number

    replacement = admin.post(
        f"{BASE_URL}/api/orders",
        json={"customer_name": "TEST_Numeração", "items": [], "status": "Orçamento"},
    )
    assert replacement.status_code == 200, replacement.text
    CREATED["orders"].append(replacement.json()["id"])
    assert replacement.json()["number"] == order_number

    deleted_replacement = admin.delete(f"{BASE_URL}/api/orders/{replacement.json()['id']}")
    assert deleted_replacement.status_code == 200, deleted_replacement.text
    assert admin.get(f"{BASE_URL}/api/orders/number-sequence").json()["current_number"] == current_number


def test_dashboard(admin):
    r = admin.get(f"{BASE_URL}/api/dashboard")
    assert r.status_code == 200
    d = r.json()
    for k in ("totals_by_cat", "orders_today", "pending", "chart", "low_stock", "commission_month"):
        assert k in d
    assert "Fardamento" in d["totals_by_cat"] and len(d["chart"]) == 7


def test_vendor_login_assignment(admin):
    vendor_response = admin.post(
        f"{BASE_URL}/api/vendors",
        json={"name": f"TEST_Vendedor_{uuid.uuid4().hex[:6]}"},
    )
    assert vendor_response.status_code == 200, vendor_response.text
    vendor_id = vendor_response.json()["id"]
    user_id = None
    try:
        user_response = admin.post(
            f"{BASE_URL}/api/auth/users",
            json={
                "email": f"test_vinculo_{uuid.uuid4().hex[:6]}@lokal.com",
                "password": "seller1234",
                "name": "TEST_Vendedor_Login",
                "role": "vendedor",
                "vendor_id": vendor_id,
            },
        )
        assert user_response.status_code == 200, user_response.text
        user_id = user_response.json()["id"]
        assert user_response.json()["vendor_id"] == vendor_id

        duplicate_response = admin.post(
            f"{BASE_URL}/api/auth/users",
            json={
                "email": f"test_vinculo_dup_{uuid.uuid4().hex[:6]}@lokal.com",
                "password": "seller1234",
                "name": "TEST_Vendedor_Duplicado",
                "role": "vendedor",
                "vendor_id": vendor_id,
            },
        )
        assert duplicate_response.status_code == 400
    finally:
        if user_id:
            admin.delete(f"{BASE_URL}/api/auth/users/{user_id}")
        admin.delete(f"{BASE_URL}/api/vendors/{vendor_id}")


def test_dashboard_event_flow(admin):
    response = admin.post(
        f"{BASE_URL}/api/dashboard/events",
        json={
            "title": f"TEST_Evento_{uuid.uuid4().hex[:6]}",
            "description": "Aviso de teste",
            "event_date": "2030-01-02",
        },
    )
    assert response.status_code == 200, response.text
    event = response.json()
    try:
        assert event["event_date"] == "2030-01-02"
        events_response = admin.get(f"{BASE_URL}/api/dashboard/events")
        assert events_response.status_code == 200, events_response.text
        assert event["id"] in {item["id"] for item in events_response.json()}
        archived_response = admin.patch(
            f"{BASE_URL}/api/dashboard/events/{event['id']}",
            json={"archived": True},
        )
        assert archived_response.status_code == 200, archived_response.text
        assert archived_response.json()["archived"] is True
        archived_events = admin.get(f"{BASE_URL}/api/dashboard/events").json()
        assert next(item for item in archived_events if item["id"] == event["id"])["archived"] is True
    finally:
        admin.delete(f"{BASE_URL}/api/dashboard/events/{event['id']}")

def test_dashboard_pending_can_be_archived_for_current_account(admin):
    response = admin.post(
        f"{BASE_URL}/api/dashboard/events",
        json={
            "title": f"TEST_Pendencia_{uuid.uuid4().hex[:6]}",
            "description": "Confirmação de arquivamento",
            "event_date": "2030-01-02",
        },
    )
    assert response.status_code == 200, response.text
    event = response.json()
    try:
        pending_id = f"event:{event['id']}"
        pending = admin.get(f"{BASE_URL}/api/dashboard/pending")
        assert pending.status_code == 200, pending.text
        assert pending_id in {item["id"] for item in pending.json()["items"]}

        archived = admin.post(
            f"{BASE_URL}/api/dashboard/pending/{pending_id}/archive"
        )
        assert archived.status_code == 200, archived.text
        assert archived.json() == {"archived": True}

        board_events = admin.get(f"{BASE_URL}/api/dashboard/events")
        assert board_events.status_code == 200, board_events.text
        assert next(item for item in board_events.json() if item["id"] == event["id"])["archived"] is True

        remaining = admin.get(f"{BASE_URL}/api/dashboard/pending")
        assert remaining.status_code == 200, remaining.text
        assert pending_id not in {item["id"] for item in remaining.json()["items"]}

        repeated_archive = admin.post(
            f"{BASE_URL}/api/dashboard/pending/{pending_id}/archive"
        )
        assert repeated_archive.status_code == 200, repeated_archive.text
    finally:
        admin.delete(f"{BASE_URL}/api/dashboard/events/{event['id']}")

def test_seller_can_archive_dashboard_announcement_from_pending(admin):
    created_user = admin.post(
        f"{BASE_URL}/api/auth/users",
        json={
            "email": f"test_archive_event_{uuid.uuid4().hex[:8]}@lokal.com",
            "password": "event123",
            "name": "TEST_Archive_Event_Seller",
            "role": "vendedor",
        },
    )
    assert created_user.status_code == 200, created_user.text
    user = created_user.json()
    CREATED["users"].append(user["id"])
    event_response = admin.post(
        f"{BASE_URL}/api/dashboard/events",
        json={
            "title": f"TEST_Aviso_vendedor_{uuid.uuid4().hex[:6]}",
            "description": "Arquivamento pelo aviso de pendências",
            "event_date": "2030-01-02",
        },
    )
    assert event_response.status_code == 200, event_response.text
    event = event_response.json()
    try:
        login = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": user["email"], "password": "event123"},
        )
        assert login.status_code == 200, login.text
        seller = requests.Session()
        seller.headers["Authorization"] = "Bearer " + login.json()["access_token"]

        pending_id = f"event:{event['id']}"
        pending = seller.get(f"{BASE_URL}/api/dashboard/pending")
        assert pending.status_code == 200, pending.text
        assert pending_id in {item["id"] for item in pending.json()["items"]}

        archived = seller.post(
            f"{BASE_URL}/api/dashboard/pending/{pending_id}/archive"
        )
        assert archived.status_code == 200, archived.text
        assert archived.json() == {"archived": True}

        dashboard_events = admin.get(f"{BASE_URL}/api/dashboard/events")
        assert dashboard_events.status_code == 200, dashboard_events.text
        assert next(item for item in dashboard_events.json() if item["id"] == event["id"])["archived"] is True
    finally:
        admin.delete(f"{BASE_URL}/api/dashboard/events/{event['id']}")

@pytest.mark.parametrize("role", ["vendedor", "visualizador"])
def test_non_admin_users_can_register_dashboard_events(admin, role):
    created_user = admin.post(
        f"{BASE_URL}/api/auth/users",
        json={
            "email": f"test_evento_{role}_{uuid.uuid4().hex[:8]}@lokal.com",
            "password": "event123",
            "name": f"TEST_Evento_{role}",
            "role": role,
        },
    )
    assert created_user.status_code == 200, created_user.text
    user = created_user.json()
    CREATED["users"].append(user["id"])
    event_id = None
    try:
        login = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": user["email"], "password": "event123"},
        )
        assert login.status_code == 200, login.text
        account = requests.Session()
        account.headers["Authorization"] = f"Bearer {login.json()['access_token']}"
        response = account.post(
            f"{BASE_URL}/api/dashboard/events",
            json={
                "title": f"TEST_Evento_{role}_{uuid.uuid4().hex[:6]}",
                "description": "Evento registrado por perfil não administrador",
                "event_date": "2030-01-02",
            },
        )
        assert response.status_code == 200, response.text
        event_id = response.json()["id"]
        assert response.json()["created_by"] == user["name"]
    finally:
        if event_id:
            admin.delete(f"{BASE_URL}/api/dashboard/events/{event_id}")


def test_day_close_is_saved_and_idempotent(admin):
    product = _prod(admin, "TEST_Fechamento_Estoque", [{"size": "U", "stock": 100}])
    order_response = admin.post(
        f"{BASE_URL}/api/orders",
        json={
            "customer_name": "TEST_Fechamento",
            "items": [{
                "product_id": product["id"],
                "name": product["name"],
                "size": "U",
                "qty": 23,
                "unit_price": 1,
            }],
            "returned_items": [{
                "product_id": product["id"],
                "name": product["name"],
                "size": "U",
                "qty": 5,
                "reason": "TEST_Devolução",
            }],
            "status": "Aprovado",
        },
    )
    assert order_response.status_code == 200, order_response.text
    order = order_response.json()
    CREATED["orders"].append(order["id"])
    fulfilled = admin.post(
        f"{BASE_URL}/api/orders/{order['id']}/fulfill",
        json={"delivery_type": "RETIRADA", "signer_name": "TEST_Responsável pela retirada"},
    )
    assert fulfilled.status_code == 200, fulfilled.text
    assert fulfilled.json()["fulfilled_at"]
    assert fulfilled.json()["signer_name"] == "TEST_Responsável pela retirada"
    order_movements = [
        movement
        for movement in admin.get(f"{BASE_URL}/api/stock_movements").json()
        if movement.get("order_id") == order["id"]
    ]
    assert sum(
        float(movement["qty"])
        for movement in order_movements
        if movement["kind"] == "ENTRADA"
    ) == 5
    assert sum(
        float(movement["qty"])
        for movement in order_movements
        if movement["kind"] == "SAIDA"
    ) == 23
    repeated_fulfillment = admin.post(
        f"{BASE_URL}/api/orders/{order['id']}/fulfill",
        json={"delivery_type": "RETIRADA"},
    )
    assert repeated_fulfillment.status_code == 400
    assert len([
        movement
        for movement in admin.get(f"{BASE_URL}/api/stock_movements").json()
        if movement.get("order_id") == order["id"]
    ]) == len(order_movements)

    vehicle_response = admin.post(
        f"{BASE_URL}/api/vehicles",
        json={"name": f"TEST_Fechamento_{uuid.uuid4().hex[:6]}", "current_km": 120},
    )
    assert vehicle_response.status_code == 200, vehicle_response.text
    vehicle = vehicle_response.json()
    CREATED["vehicles"].append(vehicle["id"])

    lower_odometer = admin.post(
        f"{BASE_URL}/api/dashboard/close-day",
        json={"vehicle_id": vehicle["id"], "current_km": 119},
    )
    assert lower_odometer.status_code == 400, lower_odometer.text

    first = admin.post(
        f"{BASE_URL}/api/dashboard/close-day",
        json={"vehicle_id": vehicle["id"], "current_km": 157.5},
    )
    assert first.status_code == 200, first.text
    report = first.json()
    assert {"id", "date", "closed_at", "summary", "orders", "stock_movements", "expenses"} <= report.keys()
    assert {"orders_count", "orders_total", "stock_movements_count", "expenses_count", "expenses_total"} <= report["summary"].keys()
    assert report["summary"]["stock_out_quantity"] >= 23
    assert report["summary"]["stock_return_quantity"] >= 5
    assert "stock_reconciliation" not in report
    assert "global_logout_done" not in report
    assert any(
        movement.get("order_id") == order["id"] and movement["kind"] == "ENTRADA"
        for movement in report["stock_movements"]
    )
    assert any(item["id"] == order["id"] for item in report["orders"])
    mileage_trip = next(
        expense for expense in report["expenses"]
        if expense.get("description") == "Quilometragem fora das entregas"
        and expense.get("vehicle_id") == vehicle["id"]
    )
    assert mileage_trip["km"] == 37.5
    assert mileage_trip["odometer_km"] == 157.5
    updated_vehicle = next(
        item for item in admin.get(f"{BASE_URL}/api/vehicles").json()
        if item["id"] == vehicle["id"]
    )
    assert updated_vehicle["current_km"] == 157.5
    assert report.get("backup_id")
    backup_response = admin.get(f"{BASE_URL}/api/dashboard/backups/{report['backup_id']}")
    assert backup_response.status_code == 200, backup_response.text
    assert backup_response.content.startswith(b"PK")
    with zipfile.ZipFile(io.BytesIO(backup_response.content)) as backup_archive:
        assert "manifest.json" in backup_archive.namelist()
        assert "data/orders.json" in backup_archive.namelist()

    repeated = admin.post(f"{BASE_URL}/api/dashboard/close-day")
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["id"] == report["id"]
    assert repeated.json()["already_closed"] is True
    history = admin.get(f"{BASE_URL}/api/dashboard/closures")
    assert history.status_code == 200, history.text
    assert any(closure["date"] == report["date"] for closure in history.json())
    saved_report = admin.get(f"{BASE_URL}/api/dashboard/closures/{report['date']}")
    assert saved_report.status_code == 200, saved_report.text
    assert saved_report.json()["id"] == report["id"]
    assert any(item["id"] == order["id"] for item in saved_report.json()["orders"])
    assert admin.get(f"{BASE_URL}/api/auth/me").status_code == 200

    confirmed = admin.post(f"{BASE_URL}/api/dashboard/close-day/confirm")
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["global_logout_done"] is True
    assert admin.get(f"{BASE_URL}/api/auth/me").status_code == 401


def test_auto_endpoint_aliases_vehicle_crud(admin):
    name = f"TEST_Auto_{uuid.uuid4().hex[:6]}"
    created = admin.post(
        f"{BASE_URL}/api/auto",
        json={"name": name, "current_km": 120},
    )
    assert created.status_code == 200, created.text
    vehicle = created.json()
    CREATED["vehicles"].append(vehicle["id"])
    assert any(item["id"] == vehicle["id"] for item in admin.get(f"{BASE_URL}/api/vehicles").json())

    fetched = admin.get(f"{BASE_URL}/api/auto/{vehicle['id']}")
    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["name"] == name

    updated = admin.put(
        f"{BASE_URL}/api/auto/{vehicle['id']}",
        json={"current_km": 135},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["current_km"] == 135
    assert admin.get(f"{BASE_URL}/api/vehicles/{vehicle['id']}").json()["current_km"] == 135

    deleted = admin.delete(f"{BASE_URL}/api/auto/{vehicle['id']}")
    assert deleted.status_code == 200, deleted.text
    assert admin.get(f"{BASE_URL}/api/vehicles/{vehicle['id']}").status_code == 404


def test_vehicle_maintenance_uses_registered_vehicle_details(admin):
    vehicle_response = admin.post(
        f"{BASE_URL}/api/vehicles",
        json={
            "name": f"TEST_Manutencao_{uuid.uuid4().hex[:6]}",
            "model": "Civic",
            "plate": "ABC1D23",
            "current_km": 48250,
        },
    )
    assert vehicle_response.status_code == 200, vehicle_response.text
    vehicle = vehicle_response.json()
    CREATED["vehicles"].append(vehicle["id"])

    maintenance_response = admin.post(
        f"{BASE_URL}/api/expenses",
        json={
            "type": "MANUTENCAO",
            "description": "Troca de óleo",
            "amount": 250,
            "vehicle_id": vehicle["id"],
            "vehicle_model": "Dados digitados",
            "plate": "ERRADA",
            "km": 1,
        },
    )
    assert maintenance_response.status_code == 200, maintenance_response.text
    maintenance = maintenance_response.json()
    CREATED["expenses"].append(maintenance["id"])
    assert maintenance["vehicle_id"] == vehicle["id"]
    assert maintenance["vehicle_model"] == f"{vehicle['name']} · Civic"
    assert maintenance["plate"] == vehicle["plate"]
    assert maintenance["km"] == vehicle["current_km"]

    updated_vehicle = admin.put(
        f"{BASE_URL}/api/vehicles/{vehicle['id']}",
        json={"current_km": 50000},
    )
    assert updated_vehicle.status_code == 200, updated_vehicle.text

    updated = admin.put(
        f"{BASE_URL}/api/expenses/{maintenance['id']}",
        json={"km": 2, "plate": "TROCADA"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["plate"] == vehicle["plate"]
    assert updated.json()["km"] == vehicle["current_km"]

    invalid_vehicle = admin.post(
        f"{BASE_URL}/api/expenses",
        json={
            "type": "MANUTENCAO",
            "description": "Serviço inválido",
            "amount": 100,
            "vehicle_id": "missing-vehicle",
        },
    )
    assert invalid_vehicle.status_code == 400


def test_reset_orders_preserves_settings_and_customers(admin):
    customer_response = admin.post(
        f"{BASE_URL}/api/customers",
        json={"name": f"TEST_Reset_{uuid.uuid4().hex[:6]}"},
    )
    assert customer_response.status_code == 200, customer_response.text
    customer = customer_response.json()
    CREATED["customers"].append(customer["id"])

    first_order = admin.post(
        f"{BASE_URL}/api/orders",
        json={"customer_name": "TEST_Ordem para zerar", "items": []},
    )
    assert first_order.status_code == 200, first_order.text
    CREATED["orders"].append(first_order.json()["id"])

    old_settings = admin.get(f"{BASE_URL}/api/settings").json()
    result = admin.post(f"{BASE_URL}/api/settings/data-reset", json={"groups": ["orders"]})
    assert result.status_code == 200, result.text
    assert result.json()["order_number_reset"] is True
    assert result.json()["preserved"] == ["users", "settings", "backups"]
    assert admin.get(f"{BASE_URL}/api/orders/number-sequence").json()["current_number"] == 0
    assert any(item["id"] == customer["id"] for item in admin.get(f"{BASE_URL}/api/customers").json())
    assert admin.get(f"{BASE_URL}/api/settings").json()["store_name"] == old_settings["store_name"]

    next_order = admin.post(
        f"{BASE_URL}/api/orders",
        json={"customer_name": "TEST_Primeiro após zerar", "items": []},
    )
    assert next_order.status_code == 200, next_order.text
    CREATED["orders"].append(next_order.json()["id"])
    assert next_order.json()["number"] == 1
