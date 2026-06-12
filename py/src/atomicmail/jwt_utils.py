"""JWT payload/expiry helpers."""

from __future__ import annotations

import base64
import json
import time
from typing import Any

SESSION_SAFETY_MARGIN_MS = 60_000
CAPABILITY_SAFETY_MARGIN_MS = 20_000


def decode_jwt_payload(jwt: str) -> dict[str, Any]:
    parts = jwt.split(".")
    if len(parts) < 2:
        raise ValueError("Malformed JWT: expected at least 2 dot-separated segments.")

    payload = parts[1]
    pad_len = (4 - (len(payload) % 4)) % 4
    payload_b64 = payload.replace("-", "+").replace("_", "/") + ("=" * pad_len)
    decoded = base64.b64decode(payload_b64.encode("utf-8"))
    return json.loads(decoded.decode("utf-8"))


def is_jwt_expired(jwt: str, margin_ms: int) -> bool:
    try:
        payload = decode_jwt_payload(jwt)
        exp = payload.get("exp")
        if not isinstance(exp, (int, float)):
            return True
        return int(time.time() * 1000) >= int(exp * 1000) - margin_ms
    except Exception:
        return True
