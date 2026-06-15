from __future__ import annotations

import base64
import json
from typing import Any

import pytest

from atomicmail.auth_http import (
    SessionResponse,
    exchange_session,
    fetch_capability,
    fetch_challenge,
    perform_pow_and_session,
)


def _make_jwt(payload: dict[str, Any]) -> str:
    header = {"alg": "none", "typ": "JWT"}

    def _segment(value: dict[str, Any]) -> str:
        raw = json.dumps(value, separators=(",", ":")).encode("utf-8")
        return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")

    return f"{_segment(header)}.{_segment(payload)}."


def test_fetch_challenge_reads_authorization_header(monkeypatch) -> None:
    token = _make_jwt({"jti": "abc", "difficulty": 6})

    def fake_post(url: str, **_: object):
        assert url == "https://auth.example/api/v1/challenge"
        return 200, "", {"Authorization": f"Bearer {token}"}

    monkeypatch.setattr("atomicmail.auth_http._http_post", fake_post)
    challenge = fetch_challenge("https://auth.example/")

    assert challenge.challengeJWT == token
    assert challenge.challenge == "abc"
    assert challenge.difficulty == 6


def test_fetch_challenge_requires_authorization_header(monkeypatch) -> None:
    monkeypatch.setattr(
        "atomicmail.auth_http._http_post",
        lambda *_args, **_kwargs: (200, "", {}),
    )

    with pytest.raises(ValueError, match="Challenge response missing Authorization"):
        fetch_challenge("https://auth.example")


def test_exchange_session_posts_challenge_header_and_json(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_post(url: str, **kwargs: object):
        captured["url"] = url
        captured["headers"] = kwargs.get("headers")
        captured["json_body"] = kwargs.get("json_body")
        return 200, '{"apiKey":"api-key"}', {"Authorization": "Bearer session-token"}

    monkeypatch.setattr("atomicmail.auth_http._http_post", fake_post)
    out = exchange_session(
        "https://auth.example",
        challenge_jwt="challenge-token",
        pow_hex="pow-hex",
        nonce="42",
        username="agent",
    )

    assert out.sessionJWT == "session-token"
    assert out.apiKey == "api-key"
    assert captured["url"] == "https://auth.example/api/v1/session"
    assert captured["headers"] == {"Authorization": "Bearer challenge-token"}
    assert captured["json_body"] == {"powHex": "pow-hex", "nonce": "42", "username": "agent"}


def test_fetch_capability_reads_bearer_token(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_post(url: str, **kwargs: object):
        captured["url"] = url
        captured["headers"] = kwargs.get("headers")
        return 200, "", {"Authorization": "Bearer capability-token"}

    monkeypatch.setattr("atomicmail.auth_http._http_post", fake_post)
    token = fetch_capability("https://auth.example", "session-token")

    assert token == "capability-token"
    assert captured["url"] == "https://auth.example/api/v1/capability"
    assert captured["headers"] == {"Authorization": "Bearer session-token"}


def test_perform_pow_and_session_chains_challenge_pow_and_session(monkeypatch) -> None:
    monkeypatch.setattr(
        "atomicmail.auth_http.fetch_challenge",
        lambda _auth_url: type(
            "Challenge",
            (),
            {"challengeJWT": "challenge-jwt", "challenge": "pow-challenge", "difficulty": 4},
        )(),
    )
    monkeypatch.setattr(
        "atomicmail.auth_http.solve_pow",
        lambda **_kwargs: type("Solved", (), {"powHex": "pow-hex", "nonce": "99"})(),
    )
    monkeypatch.setattr(
        "atomicmail.auth_http.exchange_session",
        lambda *_args, **_kwargs: SessionResponse(sessionJWT="session-jwt", apiKey="api-key"),
    )

    out = perform_pow_and_session(
        auth_url="https://auth.example",
        scrypt_salt="salt",
        username="alice",
    )
    assert out.sessionJWT == "session-jwt"
    assert out.apiKey == "api-key"
