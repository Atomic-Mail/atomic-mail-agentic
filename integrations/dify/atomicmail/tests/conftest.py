from __future__ import annotations

import sys
from pathlib import Path


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
VENDOR_DIR = PLUGIN_ROOT / "vendor"
PLUGIN_SITE_PACKAGES = (
    PLUGIN_ROOT / ".venv312" / "lib" / "python3.12" / "site-packages"
)

for path in (PLUGIN_ROOT, VENDOR_DIR, PLUGIN_SITE_PACKAGES):
    if path.exists():
        path_str = str(path)
        if path_str not in sys.path:
            sys.path.append(path_str)


class FakeStorage:
    def __init__(self) -> None:
        self._data: dict[str, bytes] = {}

    def set(self, key: str, val: bytes) -> None:
        self._data[key] = val

    def get(self, key: str) -> bytes:
        if key not in self._data:
            raise KeyError(key)
        return self._data[key]

    def delete(self, key: str) -> None:
        self._data.pop(key, None)

    def exist(self, key: str) -> bool:
        return key in self._data
