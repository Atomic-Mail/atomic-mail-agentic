from __future__ import annotations

import base64
import json

from atomicmail.jwt_utils import (
    CAPABILITY_SAFETY_MARGIN_MS,
    SESSION_SAFETY_MARGIN_MS,
    decode_jwt_payload,
    is_jwt_expired,
)


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def make_jwt(payload: dict[str, object]) -> str:
    header = _b64url(json.dumps({"alg": "none", "typ": "JWT"}).encode("utf-8"))
    body = _b64url(json.dumps(payload).encode("utf-8"))
    return f"{header}.{body}."


def test_decode_jwt_payload_parses_payload() -> None:
    token = make_jwt({"exp": 1_700_000_000, "inboxId": "agent@example.com"})
    decoded = decode_jwt_payload(token)
    assert decoded == {"exp": 1_700_000_000, "inboxId": "agent@example.com"}


def test_is_jwt_expired_respects_margin(monkeypatch) -> None:
    monkeypatch.setattr("time.time", lambda: 1_700_000_000.0)
    now_sec = int(1_700_000_000.0)

    safely_valid = make_jwt(
        {"exp": now_sec + ((SESSION_SAFETY_MARGIN_MS + 500) // 1000) + 1}
    )
    within_margin = make_jwt(
        {"exp": now_sec + max(0, ((SESSION_SAFETY_MARGIN_MS - 500) // 1000))}
    )

    assert is_jwt_expired(safely_valid, SESSION_SAFETY_MARGIN_MS) is False
    assert is_jwt_expired(within_margin, SESSION_SAFETY_MARGIN_MS) is True


def test_is_jwt_expired_depends_on_exp_claim(monkeypatch) -> None:
    monkeypatch.setattr("time.time", lambda: 1_700_000_000.0)
    now_sec = int(1_700_000_000.0)

    long_session = make_jwt({"exp": now_sec + 3 * 60 * 60})
    short_capability = make_jwt(
        {"exp": now_sec + max(0, (CAPABILITY_SAFETY_MARGIN_MS - 1_000) // 1_000)}
    )

    assert is_jwt_expired(long_session, SESSION_SAFETY_MARGIN_MS) is False
    assert is_jwt_expired(short_capability, CAPABILITY_SAFETY_MARGIN_MS) is True


def test_is_jwt_expired_handles_malformed() -> None:
    assert is_jwt_expired("malformed", SESSION_SAFETY_MARGIN_MS) is True
