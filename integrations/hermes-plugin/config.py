"""Settings for the Atomic Mail plugin.

Every value is read through Hermes's profile-scoped secret reader, then from
``platforms.atomicmail.extra`` in config.yaml. Env wins over YAML.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Mapping, Optional

DEFAULT_AUTH_URL = "https://auth.atomicmail.ai"
DEFAULT_API_URL = "https://api.atomicmail.ai"
DEFAULT_POLL_INTERVAL = 20
MIN_POLL_INTERVAL = 10

TRUTHY = {"1", "true", "yes", "on"}

# env var -> config.yaml extra key
ENV_KEYS = {
    "ATOMICMAIL_API_KEY": "api_key",
    "ATOMICMAIL_ADDRESS": "address",
    "ATOMICMAIL_ALLOWED_USERS": "allowed_users",
    "ATOMICMAIL_ALLOW_ALL_USERS": "allow_all_users",
    "ATOMICMAIL_HOME_ADDRESS": "home_address",
    "ATOMICMAIL_POLL_INTERVAL": "poll_interval",
    "ATOMICMAIL_TRUST_FROM_HEADER": "trust_from_header",
    "ATOMICMAIL_AUTH_URL": "auth_url",
    "ATOMICMAIL_API_URL": "api_url",
    "ATOMICMAIL_DNS_OVER_HTTPS": "dns_over_https",
}


def secret(name: str, default: str = "") -> str:
    """Profile-scoped read of one setting (never a bare process-env read)."""
    try:
        from agent.secret_scope import get_secret
    except Exception:  # noqa: BLE001 - outside Hermes (unit tests patch this function)
        return default
    value = get_secret(name, None)
    if value is None:
        return default
    return str(value)


def _setting(name: str, extra: Mapping[str, Any]) -> str:
    value = secret(name, "").strip()
    if value:
        return value
    raw = extra.get(ENV_KEYS[name])
    if raw is None:
        return ""
    if isinstance(raw, (list, tuple)):
        return ",".join(str(item) for item in raw)
    return str(raw).strip()


def parse_address_list(raw: str) -> frozenset[str]:
    """Comma-separated addresses or a JSON list literal -> lower-cased set."""
    raw = (raw or "").strip()
    if not raw:
        return frozenset()
    items: list[str]
    if raw.startswith("["):
        try:
            decoded = json.loads(raw)
        except ValueError:
            decoded = None
        items = [str(x) for x in decoded] if isinstance(decoded, list) else raw.strip("[]").split(",")
    else:
        items = raw.split(",")
    return frozenset(item.strip().strip("\"'").lower() for item in items if item.strip().strip("\"'"))


def _truthy(raw: str) -> bool:
    return (raw or "").strip().lower() in TRUTHY


def _poll_interval(raw: str) -> int:
    try:
        value = int(float(raw)) if raw else DEFAULT_POLL_INTERVAL
    except ValueError:
        value = DEFAULT_POLL_INTERVAL
    return max(MIN_POLL_INTERVAL, value)


@dataclass(frozen=True)
class Settings:
    api_key: str
    address: str
    allowed_users: frozenset[str]
    allow_all_users: bool
    home_address: str
    poll_interval: int
    trust_from_header: bool
    auth_url: str
    api_url: str
    dns_over_https: str = "auto"

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def public_view(self) -> dict:
        """Everything except the key, for status output and the whoami tool."""
        return {
            "address": self.address or None,
            "allowed_senders": sorted(self.allowed_users),
            "allow_all_senders": self.allow_all_users,
            "home_address": self.home_address or None,
            "dkim_required": not self.trust_from_header,
            "poll_interval_seconds": self.poll_interval,
        }


def read_settings(extra: Optional[Mapping[str, Any]] = None) -> Settings:
    extra = extra or {}
    allowed = parse_address_list(_setting("ATOMICMAIL_ALLOWED_USERS", extra))
    home = _setting("ATOMICMAIL_HOME_ADDRESS", extra)
    if not home and len(allowed) == 1:
        home = next(iter(allowed))
    return Settings(
        api_key=_setting("ATOMICMAIL_API_KEY", extra),
        address=_setting("ATOMICMAIL_ADDRESS", extra).lower(),
        allowed_users=allowed,
        allow_all_users=_truthy(_setting("ATOMICMAIL_ALLOW_ALL_USERS", extra)),
        home_address=home.lower(),
        poll_interval=_poll_interval(_setting("ATOMICMAIL_POLL_INTERVAL", extra)),
        trust_from_header=_truthy(_setting("ATOMICMAIL_TRUST_FROM_HEADER", extra)),
        auth_url=(_setting("ATOMICMAIL_AUTH_URL", extra) or DEFAULT_AUTH_URL).rstrip("/"),
        api_url=(_setting("ATOMICMAIL_API_URL", extra) or DEFAULT_API_URL).rstrip("/"),
        dns_over_https=(_setting("ATOMICMAIL_DNS_OVER_HTTPS", extra) or "auto").lower(),
    )
