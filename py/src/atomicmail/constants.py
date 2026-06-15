"""Cross-language constants loaded from shared assets."""

from __future__ import annotations

from .shared_assets import try_read_shared_json

_DEFAULTS = {
    "DEFAULT_POW_SCRYPT_SALT_HEX": "0b980734412c292d6549110276b604ab1dea4883bd460d77d1b984adf8bca083",
    "DEFAULT_AUTH_URL": "https://auth.atomicmail.ai",
    "DEFAULT_API_URL": "https://api.atomicmail.ai",
    "ONE_SEC_MS": 1_000,
    "ONE_MIN_MS": 60_000,
    "ONE_HOUR_MS": 3_600_000,
    "ONE_DAY_MS": 86_400_000,
    "ONE_MONTH_MS": 2_592_000_000,
    "ONE_YEAR_MS": 31_536_000_000,
}

_SHARED = try_read_shared_json("consts.json") or {}

DEFAULT_POW_SCRYPT_SALT_HEX = _SHARED.get(
    "DEFAULT_POW_SCRYPT_SALT_HEX", _DEFAULTS["DEFAULT_POW_SCRYPT_SALT_HEX"]
)
DEFAULT_AUTH_URL = _SHARED.get("DEFAULT_AUTH_URL", _DEFAULTS["DEFAULT_AUTH_URL"])
DEFAULT_API_URL = _SHARED.get("DEFAULT_API_URL", _DEFAULTS["DEFAULT_API_URL"])

ONE_SEC_MS = int(_SHARED.get("ONE_SEC_MS", _DEFAULTS["ONE_SEC_MS"]))
ONE_MIN_MS = int(_SHARED.get("ONE_MIN_MS", _DEFAULTS["ONE_MIN_MS"]))
ONE_HOUR_MS = int(_SHARED.get("ONE_HOUR_MS", _DEFAULTS["ONE_HOUR_MS"]))
ONE_DAY_MS = int(_SHARED.get("ONE_DAY_MS", _DEFAULTS["ONE_DAY_MS"]))
ONE_MONTH_MS = int(_SHARED.get("ONE_MONTH_MS", _DEFAULTS["ONE_MONTH_MS"]))
ONE_YEAR_MS = int(_SHARED.get("ONE_YEAR_MS", _DEFAULTS["ONE_YEAR_MS"]))
