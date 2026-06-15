from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from atomicmail.credentials import (
    CredentialArtifacts,
    CredentialStore,
    parse_credentials_json,
    serialize_credentials,
)


def _storage_exists(storage: Any, key: str) -> bool:
    try:
        return bool(storage.exist(key))
    except Exception:
        return False


def _storage_get_text(storage: Any, key: str) -> str | None:
    try:
        if not _storage_exists(storage, key):
            return None
        raw = storage.get(key)
    except Exception:
        return None
    if isinstance(raw, bytes):
        return raw.decode("utf-8").strip()
    return str(raw).strip()


@dataclass
class DifyKvCredentialStore(CredentialStore):
    storage: Any
    account_id: str = "default"

    def _key(self, suffix: str) -> str:
        return f"account:{self.account_id}:{suffix}"

    @property
    def _credentials_key(self) -> str:
        return self._key("credentials.json")

    @property
    def _session_key(self) -> str:
        return self._key("session.jwt")

    @property
    def _capability_key(self) -> str:
        return self._key("capability.jwt")

    def load(self) -> CredentialArtifacts:
        credentials = None
        raw_credentials = _storage_get_text(self.storage, self._credentials_key)
        if raw_credentials:
            try:
                credentials = parse_credentials_json(
                    raw_credentials, path_for_errors=self._credentials_key
                )
            except Exception:
                credentials = None

        return CredentialArtifacts(
            credentials=credentials,
            session_jwt=_storage_get_text(self.storage, self._session_key),
            capability_jwt=_storage_get_text(self.storage, self._capability_key),
        )

    def save(self, artifacts: CredentialArtifacts) -> None:
        if artifacts.credentials is not None:
            self.storage.set(
                self._credentials_key,
                serialize_credentials(artifacts.credentials).encode("utf-8"),
            )
        if artifacts.session_jwt is not None:
            self.storage.set(self._session_key, artifacts.session_jwt.encode("utf-8"))
        if artifacts.capability_jwt is not None:
            self.storage.set(
                self._capability_key, artifacts.capability_jwt.encode("utf-8")
            )

    def clear(self) -> None:
        for key in (self._credentials_key, self._session_key, self._capability_key):
            try:
                if _storage_exists(self.storage, key):
                    self.storage.delete(key)
            except Exception:
                continue
