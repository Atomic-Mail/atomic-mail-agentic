from __future__ import annotations

from atomicmail.credentials import CredentialArtifacts, Credentials

from conftest import FakeStorage
from utils.dify_kv_store import DifyKvCredentialStore


def test_load_returns_none_for_missing_keys() -> None:
    store = DifyKvCredentialStore(storage=FakeStorage(), account_id="acc")
    loaded = store.load()
    assert loaded.credentials is None
    assert loaded.session_jwt is None
    assert loaded.capability_jwt is None


def test_save_and_load_roundtrip() -> None:
    storage = FakeStorage()
    store = DifyKvCredentialStore(storage=storage, account_id="acc")

    store.save(
        CredentialArtifacts(
            credentials=Credentials(
                apiKey="api-key",
                inboxId="inbox@atomicmail.ai",
                authUrl="https://auth.atomicmail.ai",
                apiUrl="https://api.atomicmail.ai",
                scryptSalt="salt",
                uploadUrl="https://api.atomicmail.ai/upload/{accountId}",
                downloadUrl="https://api.atomicmail.ai/download/{accountId}/{blobId}",
            ),
            session_jwt="session-token",
            capability_jwt="cap-token",
        )
    )
    loaded = store.load()

    assert loaded.credentials is not None
    assert loaded.credentials.inboxId == "inbox@atomicmail.ai"
    assert loaded.session_jwt == "session-token"
    assert loaded.capability_jwt == "cap-token"


def test_clear_removes_all_artifacts() -> None:
    storage = FakeStorage()
    store = DifyKvCredentialStore(storage=storage, account_id="acc")
    store.save(CredentialArtifacts(session_jwt="session-token", capability_jwt="cap-token"))

    store.clear()
    loaded = store.load()
    assert loaded.session_jwt is None
    assert loaded.capability_jwt is None


def test_account_isolation_uses_separate_keyspaces() -> None:
    storage = FakeStorage()
    primary = DifyKvCredentialStore(storage=storage, account_id="acc-primary")
    secondary = DifyKvCredentialStore(storage=storage, account_id="acc-secondary")

    primary.save(
        CredentialArtifacts(
            credentials=Credentials(
                apiKey="api-key-1",
                inboxId="primary@atomicmail.ai",
                authUrl="https://auth.atomicmail.ai",
                apiUrl="https://api.atomicmail.ai",
                scryptSalt="salt",
                uploadUrl="https://api.atomicmail.ai/upload/{accountId}",
                downloadUrl="https://api.atomicmail.ai/download/{accountId}/{blobId}",
            ),
            session_jwt="session-primary",
            capability_jwt="cap-primary",
        )
    )
    secondary.save(
        CredentialArtifacts(
            credentials=Credentials(
                apiKey="api-key-2",
                inboxId="secondary@atomicmail.ai",
                authUrl="https://auth.atomicmail.ai",
                apiUrl="https://api.atomicmail.ai",
                scryptSalt="salt",
                uploadUrl="https://api.atomicmail.ai/upload/{accountId}",
                downloadUrl="https://api.atomicmail.ai/download/{accountId}/{blobId}",
            ),
            session_jwt="session-secondary",
            capability_jwt="cap-secondary",
        )
    )

    loaded_primary = primary.load()
    loaded_secondary = secondary.load()

    assert loaded_primary.credentials is not None
    assert loaded_secondary.credentials is not None
    assert loaded_primary.credentials.inboxId == "primary@atomicmail.ai"
    assert loaded_secondary.credentials.inboxId == "secondary@atomicmail.ai"
    assert loaded_primary.session_jwt == "session-primary"
    assert loaded_secondary.session_jwt == "session-secondary"
    assert "account:acc-primary:credentials.json" in storage._data
    assert "account:acc-secondary:credentials.json" in storage._data
