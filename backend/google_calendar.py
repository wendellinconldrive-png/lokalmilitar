import base64
import hashlib
import json
import os
from datetime import date, datetime, time, timedelta, timezone
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import requests
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_API_URL = "https://www.googleapis.com/calendar/v3"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
GOOGLE_SCOPE = "openid email https://www.googleapis.com/auth/calendar.events"
TIME_ZONE = "America/Sao_Paulo"
LOCAL_TZ = ZoneInfo(TIME_ZONE)


def google_configuration_missing():
    missing = [
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "GOOGLE_REDIRECT_URI",
        "GOOGLE_TOKEN_ENCRYPTION_KEY",
    ]
    missing = [key for key in missing if not os.environ.get(key)]
    allowed_origins = [
        origin.strip().rstrip("/")
        for origin in os.environ.get("CORS_ORIGINS", "").split(",")
        if origin.strip() and origin.strip() != "*"
    ]
    if not os.environ.get("FRONTEND_URL", "").strip() and not allowed_origins:
        missing.append("FRONTEND_URL")
    if "GOOGLE_TOKEN_ENCRYPTION_KEY" not in missing:
        try:
            _fernet()
        except ValueError:
            missing.append("GOOGLE_TOKEN_ENCRYPTION_KEY (inválida)")
    return missing


def push_configuration_missing():
    required = (
        "WEB_PUSH_VAPID_PUBLIC_KEY",
        "WEB_PUSH_VAPID_PRIVATE_KEY",
        "WEB_PUSH_VAPID_SUBJECT",
    )
    missing = [key for key in required if not os.environ.get(key)]
    if missing:
        return missing
    try:
        key = Vapid.from_string(os.environ["WEB_PUSH_VAPID_PRIVATE_KEY"])
        public_key = (
            base64.urlsafe_b64encode(
                key.public_key.public_bytes(
                    serialization.Encoding.X962,
                    serialization.PublicFormat.UncompressedPoint,
                )
            )
            .decode()
            .rstrip("=")
        )
    except (TypeError, ValueError):
        return ["WEB_PUSH_VAPID_PRIVATE_KEY (inválida)"]
    if public_key != os.environ["WEB_PUSH_VAPID_PUBLIC_KEY"].rstrip("="):
        return ["WEB_PUSH_VAPID_PUBLIC_KEY (não corresponde à chave privada)"]
    return []


def _fernet():
    key = os.environ.get("GOOGLE_TOKEN_ENCRYPTION_KEY", "")
    try:
        return Fernet(key.encode())
    except (ValueError, TypeError) as error:
        raise ValueError(
            "A chave GOOGLE_TOKEN_ENCRYPTION_KEY não é uma chave Fernet válida"
        ) from error


def encrypt_token(token):
    return _fernet().encrypt(json.dumps(token).encode()).decode()


def decrypt_token(ciphertext):
    try:
        return json.loads(_fernet().decrypt(ciphertext.encode()))
    except (InvalidToken, json.JSONDecodeError, TypeError) as error:
        raise ValueError(
            "Não foi possível descriptografar a conexão do Google Agenda"
        ) from error


def oauth_authorization_url(state):
    params = {
        "client_id": os.environ["GOOGLE_CLIENT_ID"],
        "redirect_uri": os.environ["GOOGLE_REDIRECT_URI"],
        "response_type": "code",
        "scope": GOOGLE_SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


def _token_request(payload):
    response = requests.post(GOOGLE_TOKEN_URL, data=payload, timeout=20)
    if not response.ok:
        raise ValueError(
            "O Google recusou a autorização. Confira o cliente OAuth e o URI de redirecionamento."
        )
    token = response.json()
    token["expires_at"] = time_now_timestamp() + int(token.get("expires_in", 3600))
    return token


def time_now_timestamp():
    return datetime.now(timezone.utc).timestamp()


def exchange_code(code, existing_token=None):
    token = _token_request(
        {
            "code": code,
            "client_id": os.environ["GOOGLE_CLIENT_ID"],
            "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
            "redirect_uri": os.environ["GOOGLE_REDIRECT_URI"],
            "grant_type": "authorization_code",
        }
    )
    if not token.get("refresh_token") and existing_token:
        token["refresh_token"] = existing_token.get("refresh_token")
    if not token.get("refresh_token"):
        raise ValueError(
            "O Google não forneceu um token de renovação. Desconecte o app na conta Google e tente novamente."
        )
    return token


def google_account_email(token):
    response = requests.get(
        GOOGLE_USERINFO_URL,
        headers={"Authorization": f"Bearer {token['access_token']}"},
        timeout=20,
    )
    if not response.ok:
        raise ValueError("Não foi possível confirmar a conta Google autorizada")
    return response.json().get("email", "")


def _refresh_token(token):
    refreshed = _token_request(
        {
            "client_id": os.environ["GOOGLE_CLIENT_ID"],
            "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
            "refresh_token": token["refresh_token"],
            "grant_type": "refresh_token",
        }
    )
    refreshed["refresh_token"] = token["refresh_token"]
    return refreshed


def local_date(value):
    if not value:
        return None
    try:
        if isinstance(value, date) and not isinstance(value, datetime):
            return value
        if isinstance(value, str) and len(value) == 10:
            return date.fromisoformat(value)
        if isinstance(value, datetime):
            parsed = value
        else:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(LOCAL_TZ).date()
    except (TypeError, ValueError):
        return None


def _timed_event(source_key, summary, description, event_date, recurrence=None):
    event_id = hashlib.sha256(source_key.encode()).hexdigest()
    start = datetime.combine(event_date, time(9, 0), tzinfo=LOCAL_TZ)
    end = start + timedelta(minutes=15)
    event = {
        "id": event_id,
        "summary": summary[:250],
        "description": description[:4000],
        "start": {"dateTime": start.isoformat(), "timeZone": TIME_ZONE},
        "end": {"dateTime": end.isoformat(), "timeZone": TIME_ZONE},
        "reminders": {
            "useDefault": False,
            "overrides": [
                {"method": "email", "minutes": 1440},
                {"method": "popup", "minutes": 1440},
                {"method": "email", "minutes": 0},
                {"method": "popup", "minutes": 0},
            ],
        },
        "extendedProperties": {"private": {"lokalSourceKey": source_key}},
    }
    if recurrence:
        event["recurrence"] = recurrence
        event["reminders"]["overrides"] = [
            {"method": "email", "minutes": 0},
            {"method": "popup", "minutes": 0},
        ]
    return event


def build_calendar_events(dashboard_events, expenses, orders):
    result = {}
    for event in dashboard_events:
        if event.get("archived") is True:
            continue
        event_date = local_date(event.get("event_date"))
        if not event_date:
            continue
        source_key = f"dashboard_event:{event['id']}"
        result[source_key] = _timed_event(
            source_key,
            event.get("title") or "Evento Lokal Militar",
            event.get("description") or "",
            event_date,
        )

    for expense in expenses:
        if expense.get("type") != "MANUTENCAO" or not expense.get("next_review_date"):
            continue
        event_date = local_date(expense["next_review_date"])
        if not event_date:
            continue
        vehicle = " · ".join(
            filter(None, (expense.get("vehicle_model"), expense.get("plate")))
        )
        title = f"Revisão do veículo: {vehicle}" if vehicle else "Revisão de veículo"
        source_key = f"maintenance:{expense['id']}"
        result[source_key] = _timed_event(
            source_key,
            title,
            expense.get("description") or "",
            event_date,
        )

    for order in orders:
        if order.get("status") in ("Entregue", "Retirado", "Cancelado"):
            continue
        created = local_date(order.get("created_at"))
        if not created:
            continue
        first_reminder = created + timedelta(days=1)
        number = order.get("number", "")
        source_key = f"pending_order:{order['id']}"
        result[source_key] = _timed_event(
            source_key,
            f"Pedido #{number} pendente",
            f"Status atual: {order.get('status') or 'Pendente'}",
            first_reminder,
            ["RRULE:FREQ=DAILY"],
        )
    return result


def build_due_notifications(dashboard_events, expenses, orders, today=None):
    today = today or datetime.now(LOCAL_TZ).date()
    notifications = []
    for event in dashboard_events:
        if event.get("archived") is True:
            continue
        event_date = local_date(event.get("event_date"))
        if not event_date:
            continue
        days_before = (event_date - today).days
        if days_before in (0, 1):
            label = "hoje" if days_before == 0 else "amanhã"
            notifications.append(
                {
                    "id": f"dashboard_event:{event['id']}:{event_date}:{days_before}",
                    "title": f"Evento {label}: {event.get('title') or 'Lokal Militar'}",
                    "body": event.get("description") or "Confira o quadro de avisos.",
                    "url": "/",
                }
            )

    for expense in expenses:
        if expense.get("type") != "MANUTENCAO" or not expense.get("next_review_date"):
            continue
        event_date = local_date(expense["next_review_date"])
        if not event_date:
            continue
        days_before = (event_date - today).days
        if days_before in (0, 1):
            vehicle = " · ".join(
                filter(None, (expense.get("vehicle_model"), expense.get("plate")))
            )
            label = "hoje" if days_before == 0 else "amanhã"
            notifications.append(
                {
                    "id": f"maintenance:{expense['id']}:{event_date}:{days_before}",
                    "title": f"Revisão {label}: {vehicle or 'veículo'}",
                    "body": expense.get("description")
                    or "Há uma revisão de veículo programada.",
                    "url": "/manutencao",
                }
            )

    for order in orders:
        if order.get("status") in ("Entregue", "Retirado", "Cancelado"):
            continue
        created = local_date(order.get("created_at"))
        if not created or today <= created:
            continue
        notifications.append(
            {
                "id": f"pending_order:{order['id']}:{today}",
                "title": f"Pedido #{order.get('number', '')} ainda pendente",
                "body": f"Status: {order.get('status') or 'Pendente'}",
                "url": "/pedidos",
            }
        )
    return notifications


def _google_request(method, path, token, **kwargs):
    response = requests.request(
        method,
        f"{GOOGLE_API_URL}{path}",
        headers={"Authorization": f"Bearer {token['access_token']}"},
        timeout=30,
        **kwargs,
    )
    if response.status_code == 401:
        raise PermissionError("A conexão do Google Agenda expirou ou foi revogada")
    if response.status_code >= 400 and response.status_code not in (404, 409, 410):
        raise ValueError(f"Falha na API do Google Agenda (HTTP {response.status_code})")
    return response


def sync_calendar(token, events, mappings):
    refreshed = token
    if float(token.get("expires_at", 0)) <= time_now_timestamp() + 60:
        refreshed = _refresh_token(token)

    updated_mappings = {}
    for source_key, event in events.items():
        existing = mappings.get(source_key)
        event_id = existing.get("event_id") if existing else None
        event_hash = hashlib.sha256(
            json.dumps(event, sort_keys=True, ensure_ascii=False).encode()
        ).hexdigest()
        if existing and event_id and existing.get("event_hash") == event_hash:
            updated_mappings[source_key] = {
                "event_id": event_id,
                "event_hash": event_hash,
            }
            continue
        if event_id:
            response = _google_request(
                "PUT",
                f"/calendars/primary/events/{event_id}",
                refreshed,
                json=event,
            )
            if response.status_code in (404, 410):
                event_id = event["id"]
                response = _google_request(
                    "POST",
                    "/calendars/primary/events",
                    refreshed,
                    json=event,
                )
        else:
            event_id = event["id"]
            response = _google_request(
                "POST",
                "/calendars/primary/events",
                refreshed,
                json=event,
            )
        if response.status_code == 409:
            response = _google_request(
                "PUT",
                f"/calendars/primary/events/{event_id}",
                refreshed,
                json=event,
            )
        if response.status_code not in (404, 409):
            event_id = response.json().get("id", event_id)
        updated_mappings[source_key] = {"event_id": event_id, "event_hash": event_hash}

    for source_key, mapping in mappings.items():
        if source_key in events:
            continue
        event_id = mapping.get("event_id")
        if event_id:
            _google_request(
                "DELETE",
                f"/calendars/primary/events/{event_id}",
                refreshed,
            )
    return refreshed, updated_mappings
