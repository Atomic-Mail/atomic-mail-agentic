"""Seen-message bookkeeping under ``<hermes home>/plugin-data/atomicmail/`` (no secrets here)."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

PLUGIN_NAME = "atomicmail"
MAX_SEEN = 500


def _path() -> Optional[Path]:
    try:
        from plugins.plugin_storage import plugin_data_dir
    except Exception:  # noqa: BLE001 - outside Hermes
        return None
    return plugin_data_dir(PLUGIN_NAME) / "state.json"


def load(address: str) -> dict:
    path = _path()
    if path is None:
        return {}
    try:
        from utils import read_json_or_empty
        data = read_json_or_empty(path)
    except Exception:  # noqa: BLE001
        return {}
    entry = data.get(address.lower()) if isinstance(data, dict) else None
    return entry if isinstance(entry, dict) else {}


def save(address: str, *, seen: Iterable[str], initialized: bool = True, last_rejection: Optional[dict] = None) -> None:
    path = _path()
    if path is None:
        return
    try:
        from utils import atomic_json_write, read_json_or_empty
        data = read_json_or_empty(path)
        if not isinstance(data, dict):
            data = {}
        entry = data.get(address.lower()) if isinstance(data.get(address.lower()), dict) else {}
        entry["initialized"] = initialized
        entry["seen"] = list(seen)[-MAX_SEEN:]
        if last_rejection is not None:
            entry["last_rejection"] = last_rejection
        data[address.lower()] = entry
        atomic_json_write(path, data)
    except Exception as exc:  # noqa: BLE001 - bookkeeping must never break the channel
        logger.warning("[Atomic Mail] Could not save state: %s", exc)
