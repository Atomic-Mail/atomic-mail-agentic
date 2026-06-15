"""Helpers for loading repo-level shared assets."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

_SHARED_ENV = "ATOMIC_MAIL_SHARED_DIR"


def shared_dir() -> Path:
    """Resolve the shared asset directory."""
    from_env = os.getenv(_SHARED_ENV)
    if from_env:
        return Path(from_env).expanduser().resolve()

    here = Path(__file__).resolve()
    for parent in [here, *here.parents]:
        candidate = parent / "shared" / "consts.json"
        if candidate.exists():
            return candidate.parent

    raise RuntimeError(
        "Could not locate shared assets. Set ATOMIC_MAIL_SHARED_DIR explicitly."
    )


def read_shared_json(relative_path: str) -> Any:
    """Read JSON from the shared asset directory."""
    path = shared_dir() / relative_path
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def try_read_shared_json(relative_path: str) -> Any | None:
    """Read shared JSON if present, otherwise return None."""
    try:
        return read_shared_json(relative_path)
    except (OSError, json.JSONDecodeError):
        return None


def read_shared_text(relative_path: str) -> str:
    """Read UTF-8 text from the shared asset directory."""
    path = shared_dir() / relative_path
    return path.read_text(encoding="utf-8")


def try_read_shared_text(relative_path: str) -> str | None:
    """Read shared UTF-8 text if present, otherwise return None."""
    try:
        return read_shared_text(relative_path)
    except OSError:
        return None
