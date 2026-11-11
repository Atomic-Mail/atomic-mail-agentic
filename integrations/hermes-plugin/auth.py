"""Atomic Mail auth-service: proof-of-work sign-up and short-lived JMAP tokens.

Flow (same as the official clients): ``POST /api/v1/challenge`` -> solve the
scrypt proof-of-work -> ``POST /api/v1/session`` (with a username to create an
inbox, or the inbox API key to sign in) -> ``POST /api/v1/capability`` for a
~2 minute JMAP bearer token. A solve costs roughly 20 s of one CPU core at the
current difficulty, so sessions are cached until shortly before they expire.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import threading
import time
from dataclasses import dataclass
from typing import Callable, Optional

import httpx

from . import __version__

USER_AGENT = f"atomicmail-hermes/{__version__}"

POW_SCRYPT_SALT = "0b980734412c292d6549110276b604ab1dea4883bd460d77d1b984adf8bca083"
SCRYPT_N, SCRYPT_R, SCRYPT_P, POW_HASH_BYTES = 16_384, 8, 1, 64
SESSION_MARGIN_S = 60
CAPABILITY_MARGIN_S = 15
CHALLENGE_ATTEMPTS = 3  # a challenge lives 180 s; a slow or sleeping machine can miss it
CLOCK_SLACK_S = 5
USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{3,19}[a-z0-9]$")


class AuthError(Exception):
    def __init__(self, message: str, *, retryable: bool = False, status: Optional[int] = None) -> None:
        super().__init__(message)
        self.retryable = retryable
        self.status = status


class PowCancelled(AuthError):
    pass


def decode_jwt_claims(token: str) -> dict:
    parts = token.split(".")
    if len(parts) < 2:
        raise AuthError("Malformed token from auth-service.")
    payload = parts[1] + "=" * (-len(parts[1]) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(payload.encode()))
    except ValueError as exc:
        raise AuthError("Malformed token from auth-service.") from exc


def _expired(token: Optional[str], margin_s: int) -> bool:
    if not token:
        return True
    try:
        exp = decode_jwt_claims(token).get("exp")
    except AuthError:
        return True
    return not isinstance(exp, (int, float)) or time.time() >= float(exp) - margin_s


def _leading_zero_bits(digest: bytes, bits: int) -> bool:
    full, rest = divmod(bits, 8)
    if any(digest[:full]):
        return False
    return rest == 0 or (digest[full] >> (8 - rest)) == 0


def solve_pow(challenge: str, difficulty: int, *, salt: str = POW_SCRYPT_SALT,
              on_progress: Optional[Callable[[int], None]] = None,
              should_stop: Optional[Callable[[], bool]] = None) -> tuple[str, str]:
    """Return ``(pow_hex, nonce)`` for ``scrypt(f"{challenge}:{nonce}")`` with *difficulty* leading zero bits."""
    if not hasattr(hashlib, "scrypt"):
        raise AuthError("This Python build has no hashlib.scrypt; proof-of-work is impossible.")
    nonce = 0
    salt_bytes = salt.encode()
    while True:
        digest = hashlib.scrypt(f"{challenge}:{nonce}".encode(), salt=salt_bytes, n=SCRYPT_N, r=SCRYPT_R,
                                p=SCRYPT_P, dklen=POW_HASH_BYTES)
        if _leading_zero_bits(digest, difficulty):
            return digest.hex(), str(nonce)
        nonce += 1
        if nonce % 64 == 0:
            if on_progress:
                on_progress(nonce)
            if should_stop and should_stop():
                raise PowCancelled("Proof-of-work cancelled.")


def _bearer(response: httpx.Response, what: str) -> str:
    raw = (response.headers.get("authorization") or "").strip()
    if not raw.lower().startswith("bearer ") or not raw[7:].strip():
        raise AuthError(f"auth-service {what} reply has no bearer token.")
    return raw[7:].strip()


def _check(response: httpx.Response, what: str) -> None:
    if response.status_code == 429:
        raise AuthError(f"auth-service {what}: rate limited, try again in a few minutes.", retryable=True)
    if response.status_code >= 500:
        raise AuthError(f"auth-service {what}: server error {response.status_code}.", retryable=True)
    if response.status_code >= 400:
        detail = response.text[:300].strip()
        raise AuthError(f"auth-service {what} refused ({response.status_code}): {detail}",
                        status=response.status_code)


def _challenge_expired(exc: AuthError) -> bool:
    """The auth-service answer to a proof-of-work that arrived after its challenge ran out."""
    text = str(exc).lower()
    return exc.status == 400 and "challenge" in text and ("exp" in text or "expired" in text)


@dataclass
class Registered:
    api_key: str
    address: str


class AuthClient:
    def __init__(self, auth_url: str, *, transport: Optional[httpx.BaseTransport] = None,
                 timeout: float = 30.0) -> None:
        self._base = auth_url.rstrip("/")
        self._client = httpx.Client(timeout=timeout, transport=transport, headers={"User-Agent": USER_AGENT})

    def close(self) -> None:
        self._client.close()

    def _post(self, path: str, what: str, **kwargs) -> httpx.Response:
        try:
            response = self._client.post(f"{self._base}{path}", **kwargs)
        except httpx.HTTPError as exc:
            raise AuthError(f"auth-service unreachable ({exc.__class__.__name__}).", retryable=True) from exc
        _check(response, what)
        return response

    def session(self, *, api_key: Optional[str] = None, username: Optional[str] = None,
                on_progress: Optional[Callable[[int], None]] = None,
                should_stop: Optional[Callable[[], bool]] = None) -> tuple[str, Optional[str]]:
        """Solve a challenge and open a session. Returns ``(session_jwt, api_key_from_signup)``.

        A challenge that runs out before the proof-of-work is done (a slow, busy or sleeping
        machine) is replaced with a fresh one instead of failing the sign-in.
        """
        for _attempt in range(CHALLENGE_ATTEMPTS):
            challenge_jwt = _bearer(self._post("/api/v1/challenge", "challenge"), "challenge")
            claims = decode_jwt_claims(challenge_jwt)
            challenge, difficulty = claims.get("jti"), claims.get("difficulty")
            if not isinstance(challenge, str) or not isinstance(difficulty, (int, float)):
                raise AuthError("auth-service challenge is malformed.")
            exp = claims.get("exp")
            deadline = float(exp) + CLOCK_SLACK_S if isinstance(exp, (int, float)) else None

            def stop(deadline: Optional[float] = deadline) -> bool:
                if should_stop is not None and should_stop():
                    return True
                return deadline is not None and time.time() > deadline

            try:
                pow_hex, nonce = solve_pow(challenge, int(difficulty), on_progress=on_progress, should_stop=stop)
            except PowCancelled:
                if should_stop is not None and should_stop():
                    raise
                continue  # the challenge ran out mid-solve
            body: dict = {"powHex": pow_hex, "nonce": nonce}
            if api_key:
                body["apiKey"] = api_key
            if username:
                body["username"] = username
            try:
                response = self._post("/api/v1/session", "session", json=body,
                                      headers={"Authorization": f"Bearer {challenge_jwt}"})
            except AuthError as exc:
                if _challenge_expired(exc):
                    continue
                raise
            issued_key = None
            if response.text.strip():
                try:
                    data = response.json()
                except ValueError:
                    data = {}
                if isinstance(data, dict) and isinstance(data.get("apiKey"), str):
                    issued_key = data["apiKey"]
            return _bearer(response, "session"), issued_key
        raise AuthError(f"auth-service challenge ran out before the proof-of-work finished ({CHALLENGE_ATTEMPTS} "
                        "tries); will try again.", retryable=True)

    def capability(self, session_jwt: str) -> str:
        response = self._post("/api/v1/capability", "capability",
                              headers={"Authorization": f"Bearer {session_jwt}"})
        return _bearer(response, "capability")

    def register(self, username: str, *, inbox_domain: str = "atomicmail.ai",
                 on_progress: Optional[Callable[[int], None]] = None) -> Registered:
        """Create a new inbox ``<username>@atomicmail.ai``. The address is permanent."""
        name = normalize_username(username)
        session_jwt, api_key = self.session(username=name, on_progress=on_progress)
        if not api_key:
            raise AuthError("Sign-up returned no API key; nothing was saved. Try again or contact Atomic Mail.")
        try:
            # The key is already issued: never lose it over a failed follow-up call.
            inbox = str(decode_jwt_claims(self.capability(session_jwt)).get("inboxId") or name)
        except AuthError:
            inbox = name
        address = inbox if "@" in inbox else f"{inbox}@{inbox_domain}"
        return Registered(api_key=api_key, address=address.lower())


def normalize_username(username: str) -> str:
    name = (username or "").strip().lower()
    if name.endswith("@atomicmail.ai"):
        name = name[: -len("@atomicmail.ai")]
    if not USERNAME_RE.match(name):
        raise AuthError("The name must be 5-21 characters: letters, digits, dot, dash or underscore, "
                        "starting and ending with a letter or digit.")
    return name


class SessionManager:
    """Keeps one inbox's session and capability fresh (thread-safe, proof-of-work on demand)."""

    def __init__(self, api_key: str, auth_url: str, *, client: Optional[AuthClient] = None,
                 should_stop: Optional[Callable[[], bool]] = None) -> None:
        self._api_key = api_key
        self._client = client or AuthClient(auth_url)
        self._should_stop = should_stop
        self._session: Optional[str] = None
        self._capability: Optional[str] = None
        self._lock = threading.Lock()

    def close(self) -> None:
        self._client.close()

    @property
    def has_live_session(self) -> bool:
        return not _expired(self._session, SESSION_MARGIN_S)

    def capability(self, *, force: bool = False) -> str:
        with self._lock:
            if force:
                self._capability = None
            if not _expired(self._capability, CAPABILITY_MARGIN_S):
                return self._capability  # type: ignore[return-value]
            if _expired(self._session, SESSION_MARGIN_S):
                self._session, _ = self._client.session(api_key=self._api_key, should_stop=self._should_stop)
            try:
                self._capability = self._client.capability(self._session)
            except AuthError:
                # A session revoked server-side: one fresh sign-in, then give up.
                self._session, _ = self._client.session(api_key=self._api_key, should_stop=self._should_stop)
                self._capability = self._client.capability(self._session)
            return self._capability
