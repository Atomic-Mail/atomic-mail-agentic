"""Auth-service HTTP helpers: challenge -> session -> capability."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Callable, Mapping
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from .jwt_utils import decode_jwt_payload
from .pow import solve_pow


@dataclass
class ChallengeResponse:
    challengeJWT: str
    challenge: str
    difficulty: int


@dataclass
class SessionResponse:
    sessionJWT: str
    apiKey: str | None = None


def fetch_challenge(auth_url: str) -> ChallengeResponse:
    base = auth_url.rstrip("/")
    status, text, headers = _http_post(f"{base}/api/v1/challenge")
    if status < 200 or status >= 300:
        raise ValueError(
            f"auth-service /api/v1/challenge returned {status}: {text}"
        )

    challenge_jwt = _read_bearer_token(
        headers.get("Authorization"),
        "Challenge response missing Authorization bearer token.",
    )
    payload = decode_jwt_payload(challenge_jwt)
    challenge = payload.get("jti")
    difficulty = payload.get("difficulty")
    if not isinstance(challenge, str) or not isinstance(difficulty, (int, float)):
        raise ValueError("Challenge JWT payload malformed (missing jti or difficulty).")

    return ChallengeResponse(
        challengeJWT=challenge_jwt,
        challenge=challenge,
        difficulty=int(difficulty),
    )


def exchange_session(
    auth_url: str,
    *,
    challenge_jwt: str,
    pow_hex: str,
    nonce: str,
    api_key: str | None = None,
    username: str | None = None,
) -> SessionResponse:
    base = auth_url.rstrip("/")
    payload: dict[str, str] = {"powHex": pow_hex, "nonce": nonce}
    if api_key:
        payload["apiKey"] = api_key
    if username:
        payload["username"] = username

    status, text, headers = _http_post(
        f"{base}/api/v1/session",
        headers={"Authorization": f"Bearer {challenge_jwt}"},
        json_body=payload,
    )
    if status < 200 or status >= 300:
        raise ValueError(f"auth-service /api/v1/session returned {status}: {text}")

    session_jwt = _read_bearer_token(
        headers.get("Authorization"),
        "Session response missing Authorization bearer token.",
    )

    data: dict[str, object] = {}
    if text.strip():
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as err:
            raise ValueError(
                "auth-service /api/v1/session returned non-JSON body."
            ) from err
        if not isinstance(parsed, dict):
            raise ValueError("auth-service /api/v1/session returned non-JSON body.")
        data = parsed

    api_key_out = data.get("apiKey")
    return SessionResponse(
        sessionJWT=session_jwt,
        apiKey=api_key_out if isinstance(api_key_out, str) else None,
    )


def fetch_capability(auth_url: str, session_jwt: str) -> str:
    base = auth_url.rstrip("/")
    status, text, headers = _http_post(
        f"{base}/api/v1/capability",
        headers={"Authorization": f"Bearer {session_jwt}"},
    )
    if status < 200 or status >= 300:
        raise ValueError(f"auth-service /api/v1/capability returned {status}: {text}")

    return _read_bearer_token(
        headers.get("Authorization"),
        "Capability response missing Authorization bearer token.",
    )


def perform_pow_and_session(
    *,
    auth_url: str,
    scrypt_salt: str,
    api_key: str | None = None,
    username: str | None = None,
    on_pow_progress: Callable[[int], None] | None = None,
) -> SessionResponse:
    challenge = fetch_challenge(auth_url)
    solved = solve_pow(
        challenge=challenge.challenge,
        difficulty=challenge.difficulty,
        salt=scrypt_salt,
        on_progress=on_pow_progress,
    )
    return exchange_session(
        auth_url,
        challenge_jwt=challenge.challengeJWT,
        pow_hex=solved.powHex,
        nonce=solved.nonce,
        api_key=api_key,
        username=username,
    )


def _read_bearer_token(header_value: str | None, missing_error: str) -> str:
    if not header_value:
        raise ValueError(missing_error)

    raw = header_value.strip()
    prefix = "bearer "
    if not raw.lower().startswith(prefix):
        raise ValueError("Authorization header must use Bearer scheme.")

    token = raw[len(prefix) :].strip()
    if not token:
        raise ValueError("Authorization header must use Bearer scheme.")
    return token


def _http_post(
    url: str,
    *,
    headers: Mapping[str, str] | None = None,
    json_body: object | None = None,
) -> tuple[int, str, Mapping[str, str]]:
    req_headers = dict(headers or {})
    body_bytes: bytes | None = None
    if json_body is not None:
        body_bytes = json.dumps(json_body).encode("utf-8")
        req_headers.setdefault("Content-Type", "application/json")

    req = Request(url, data=body_bytes, headers=req_headers, method="POST")
    try:
        with urlopen(req) as response:
            return (
                int(response.getcode()),
                response.read().decode("utf-8"),
                response.headers,
            )
    except HTTPError as err:
        return err.code, err.read().decode("utf-8", errors="replace"), err.headers
