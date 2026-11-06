import base64
import hashlib
import json
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid

from backend import google_calendar


def test_local_date_keeps_date_only_values_in_sao_paulo():
    assert google_calendar.local_date("2026-11-03") == date(2026, 11, 3)


def test_calendar_events_include_dashboard_maintenance_and_open_orders():
    events = google_calendar.build_calendar_events(
        [
            {"id": "event-1", "title": "Evento", "event_date": "2026-11-05"},
            {"id": "event-archived", "title": "Executado", "event_date": "2026-11-05", "archived": True},
        ],
        [
            {
                "id": "maintenance-1",
                "type": "MANUTENCAO",
                "description": "Troca de óleo",
                "next_review_date": "2026-11-06",
                "vehicle_model": "Honda Civic",
                "plate": "ABC1D23",
            }
        ],
        [
            {
                "id": "order-1",
                "number": 12,
                "status": "Separado",
                "created_at": "2026-11-03T13:00:00+00:00",
            },
            {
                "id": "order-2",
                "number": 13,
                "status": "Retirado",
                "created_at": "2026-11-03T13:00:00+00:00",
            },
            {
                "id": "order-3",
                "number": 14,
                "status": "Cancelado",
                "created_at": "2026-11-03T13:00:00+00:00",
            },
        ],
    )

    assert set(events) == {
        "dashboard_event:event-1",
        "maintenance:maintenance-1",
        "pending_order:order-1",
    }
    assert events["dashboard_event:event-1"]["start"]["dateTime"].startswith(
        "2026-11-05T09:00:00"
    )
    assert "ABC1D23" in events["maintenance:maintenance-1"]["summary"]
    assert events["pending_order:order-1"]["start"]["dateTime"].startswith(
        "2026-11-04T09:00:00"
    )
    assert events["pending_order:order-1"]["recurrence"] == ["RRULE:FREQ=DAILY"]


def test_due_notifications_cover_event_day_previous_day_and_pending_orders():
    today = date(2026, 11, 3)
    notifications = google_calendar.build_due_notifications(
        [
            {"id": "event-tomorrow", "title": "Reunião", "event_date": "2026-11-04"},
            {"id": "event-today", "title": "Entrega", "event_date": "2026-11-03"},
            {"id": "event-later", "title": "Futuro", "event_date": "2026-11-08"},
            {"id": "event-archived", "title": "Executado", "event_date": "2026-11-03", "archived": True},
        ],
        [
            {
                "id": "maintenance-today",
                "type": "MANUTENCAO",
                "next_review_date": "2026-11-03",
                "plate": "ABC1D23",
            }
        ],
        [
            {
                "id": "order-pending",
                "number": 3,
                "status": "Separado",
                "created_at": "2026-11-02T14:00:00+00:00",
            },
            {
                "id": "order-complete",
                "status": "Entregue",
                "created_at": "2026-11-02T14:00:00+00:00",
            },
        ],
        today,
    )

    assert {item["id"] for item in notifications} == {
        "dashboard_event:event-tomorrow:2026-11-04:1",
        "dashboard_event:event-today:2026-11-03:0",
        "maintenance:maintenance-today:2026-11-03:0",
        "pending_order:order-pending:2026-11-03",
    }


def test_google_tokens_are_encrypted_and_require_the_server_key(monkeypatch):
    key = Fernet.generate_key().decode()
    monkeypatch.setenv("GOOGLE_TOKEN_ENCRYPTION_KEY", key)
    token = {
        "access_token": "private-access-token",
        "refresh_token": "private-refresh-token",
    }

    encrypted = google_calendar.encrypt_token(token)

    assert "private-access-token" not in encrypted
    assert google_calendar.decrypt_token(encrypted) == token


def test_push_configuration_checks_that_vapid_key_pair_matches(monkeypatch):
    key = Vapid()
    key.generate_keys()
    private_key = key.private_key.private_numbers().private_value.to_bytes(32, "big")
    public_key = key.public_key.public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    encoded_private_key = base64.urlsafe_b64encode(private_key).decode().rstrip("=")
    encoded_public_key = base64.urlsafe_b64encode(public_key).decode().rstrip("=")
    monkeypatch.setenv("WEB_PUSH_VAPID_PRIVATE_KEY", encoded_private_key)
    monkeypatch.setenv("WEB_PUSH_VAPID_PUBLIC_KEY", encoded_public_key)
    monkeypatch.setenv("WEB_PUSH_VAPID_SUBJECT", "mailto:admin@example.com")

    assert google_calendar.push_configuration_missing() == []
    monkeypatch.setenv("WEB_PUSH_VAPID_PUBLIC_KEY", "mismatched-key")
    assert google_calendar.push_configuration_missing() == [
        "WEB_PUSH_VAPID_PUBLIC_KEY (não corresponde à chave privada)"
    ]


def test_calendar_sync_updates_existing_events_and_removes_stale_events():
    future = (datetime.now(timezone.utc) + timedelta(hours=1)).timestamp()
    token = {"access_token": "token", "refresh_token": "refresh", "expires_at": future}
    events = {"dashboard_event:keep": {"summary": "Updated"}}
    mappings = {
        "dashboard_event:keep": {"event_id": "google-keep"},
        "maintenance:remove": {"event_id": "google-remove"},
    }

    def request(method, path, token, **kwargs):
        event_id = path.rsplit("/", 1)[-1] if method == "PUT" else "google-new"
        response = type(
            "Response",
            (),
            {
                "status_code": 204,
                "json": lambda self: {"id": event_id},
            },
        )()
        calls.append((method, path, kwargs))
        return response

    calls = []
    with patch.object(google_calendar, "_google_request", side_effect=request):
        refreshed, updated = google_calendar.sync_calendar(token, events, mappings)

    assert refreshed == token
    expected_hash = hashlib.sha256(
        json.dumps(
            events["dashboard_event:keep"], sort_keys=True, ensure_ascii=False
        ).encode()
    ).hexdigest()
    assert updated == {
        "dashboard_event:keep": {
            "event_id": "google-keep",
            "event_hash": expected_hash,
        }
    }
    assert calls[0][:2] == ("PUT", "/calendars/primary/events/google-keep")
    assert calls[1][:2] == ("DELETE", "/calendars/primary/events/google-remove")


def test_calendar_sync_skips_events_with_unchanged_payload():
    event = {"summary": "Same event"}
    event_hash = hashlib.sha256(
        json.dumps(event, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()
    token = {
        "access_token": "token",
        "refresh_token": "refresh",
        "expires_at": float("inf"),
    }

    with patch.object(google_calendar, "_google_request") as request:
        _, mappings = google_calendar.sync_calendar(
            token,
            {"dashboard_event:1": event},
            {"dashboard_event:1": {"event_id": "google-1", "event_hash": event_hash}},
        )

    request.assert_not_called()
    assert mappings["dashboard_event:1"]["event_id"] == "google-1"
