from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest

from atomicmail.credentials import (
    CredentialArtifacts,
    Credentials,
    default_files_from_out_dir,
    read_credentials,
    write_credentials,
)
from atomicmail.session import (
    AgentSession,
    AgentSessionConfig,
    create_agent_session,
    inbox_id_to_mailbox_email,
    register,
)


def _make_jwt(payload: dict[str, object]) -> str:
    header = {"alg": "none", "typ": "JWT"}

    def _segment(value: dict[str, object]) -> str:
        raw = json.dumps(value, separators=(",", ":")).encode("utf-8")
        return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")

    return f"{_segment(header)}.{_segment(payload)}."


def _cfg(tmp_path: Path, *, api_key: str | None, inbox_id: str | None) -> AgentSessionConfig:
    return AgentSessionConfig(
        authUrl="https://auth.atomicmail.ai",
        apiUrl="https://api.atomicmail.ai",
        scryptSalt="salt",
        apiKey=api_key,
        inboxId=inbox_id,
        credentialDir=str(tmp_path),
        files=default_files_from_out_dir(str(tmp_path)),
    )


def test_register_rejects_username_switch_without_forced(tmp_path: Path) -> None:
    session = AgentSession.create(
        _cfg(
            tmp_path,
            api_key="existing-api-key",
            inbox_id="current-user@atomicmail.ai",
        )
    )

    with pytest.raises(ValueError, match="Register refused"):
        session.register("new-user")


def test_agent_session_can_load_from_in_memory_store(tmp_path: Path) -> None:
    artifacts = CredentialArtifacts(
        credentials=Credentials(
            apiKey="existing-api-key",
            inboxId="current-user@atomicmail.ai",
            authUrl="https://auth.atomicmail.ai",
            apiUrl="https://api.atomicmail.ai",
            scryptSalt="salt",
            uploadUrl="https://api.atomicmail.ai/upload/{accountId}",
            downloadUrl="https://api.atomicmail.ai/download/{accountId}/{blobId}",
        ),
        session_jwt="session-jwt",
        capability_jwt="capability-jwt",
    )

    class _InMemoryStore:
        def load(self) -> CredentialArtifacts:
            return artifacts

        def save(self, incoming: CredentialArtifacts) -> None:
            if incoming.credentials is not None:
                artifacts.credentials = incoming.credentials
            if incoming.session_jwt is not None:
                artifacts.session_jwt = incoming.session_jwt
            if incoming.capability_jwt is not None:
                artifacts.capability_jwt = incoming.capability_jwt

        def clear(self) -> None:
            artifacts.credentials = None
            artifacts.session_jwt = None
            artifacts.capability_jwt = None

    session = AgentSession.create(
        AgentSessionConfig(
            authUrl="https://auth.atomicmail.ai",
            apiUrl="https://api.atomicmail.ai",
            scryptSalt="salt",
            apiKey=None,
            inboxId=None,
            credentialDir=str(tmp_path),
            store=_InMemoryStore(),
        )
    )

    assert session.has_api_key is True
    assert session.current_inbox_id == "current-user@atomicmail.ai"
    with pytest.raises(ValueError, match="Register refused"):
        session.register("new-user")


def test_inbox_id_to_mailbox_email_keeps_full_address() -> None:
    assert inbox_id_to_mailbox_email("agent@example.com") == "agent@example.com"


def test_inbox_id_to_mailbox_email_uses_default_domain() -> None:
    assert inbox_id_to_mailbox_email("agent", env={}) == "agent@atomicmail.ai"


def test_inbox_id_to_mailbox_email_uses_configured_domain() -> None:
    assert (
        inbox_id_to_mailbox_email("agent", env={"ATOMIC_MAIL_INBOX_DOMAIN": "@mail.example"})
        == "agent@mail.example"
    )


def test_register_same_username_is_idempotent(tmp_path: Path, monkeypatch) -> None:
    capability = _make_jwt({"inboxId": "alice@atomicmail.ai", "exp": 4_000_000_000})
    files = default_files_from_out_dir(str(tmp_path))
    files.capabilityFile.write_text(capability, encoding="utf-8")

    monkeypatch.setattr(
        "atomicmail.session.fetch_jmap_well_known",
        lambda *_args, **_kwargs: {
            "primaryAccounts": {"urn:ietf:params:jmap:mail": "acc-1"},
            "uploadUrl": "https://api.atomicmail.ai/upload/{accountId}",
            "downloadUrl": "https://api.atomicmail.ai/download/{accountId}/{blobId}",
            "apiUrl": "https://api.atomicmail.ai/jmap",
        },
    )

    session = AgentSession.create(
        _cfg(
            tmp_path,
            api_key="existing-api-key",
            inbox_id="alice@atomicmail.ai",
        )
    )
    out = session.register("alice")

    assert out.idempotent is True
    assert out.apiKey is None
    assert out.inbox == "alice@atomicmail.ai"
    assert out.accountId == "acc-1"


def test_register_signup_persists_credentials_and_jwts(
    tmp_path: Path, monkeypatch
) -> None:
    session_jwt = _make_jwt({"sub": "session", "exp": 4_000_000_000})
    capability_jwt = _make_jwt(
        {"inboxId": "new-user@atomicmail.ai", "exp": 4_000_000_000}
    )
    monkeypatch.setattr(
        "atomicmail.session.perform_pow_and_session",
        lambda **_kwargs: type(
            "SessionResponse", (), {"sessionJWT": session_jwt, "apiKey": "new-api-key"}
        )(),
    )
    monkeypatch.setattr(
        "atomicmail.session.fetch_capability",
        lambda *_args, **_kwargs: capability_jwt,
    )
    monkeypatch.setattr(
        "atomicmail.session.fetch_jmap_well_known",
        lambda *_args, **_kwargs: {
            "primaryAccounts": {"urn:ietf:params:jmap:mail": "acc-2"},
            "uploadUrl": "https://api.atomicmail.ai/upload/{accountId}",
            "downloadUrl": "https://api.atomicmail.ai/download/{accountId}/{blobId}",
            "apiUrl": "https://api.atomicmail.ai/jmap",
        },
    )

    session = AgentSession.create(_cfg(tmp_path, api_key=None, inbox_id=None))
    out = session.register("new-user")

    assert out.inbox == "new-user@atomicmail.ai"
    assert out.accountId == "acc-2"
    assert out.apiKey == "new-api-key"
    assert out.idempotent is None

    creds = read_credentials(default_files_from_out_dir(str(tmp_path)).credentialsFile)
    assert creds == Credentials(
        apiKey="new-api-key",
        inboxId="new-user@atomicmail.ai",
        authUrl="https://auth.atomicmail.ai",
        apiUrl="https://api.atomicmail.ai",
        scryptSalt="salt",
        uploadUrl="https://api.atomicmail.ai/upload/{accountId}",
        downloadUrl="https://api.atomicmail.ai/download/{accountId}/{blobId}",
    )
    assert default_files_from_out_dir(str(tmp_path)).sessionFile.read_text(
        encoding="utf-8"
    ) == session_jwt
    assert default_files_from_out_dir(str(tmp_path)).capabilityFile.read_text(
        encoding="utf-8"
    ) == capability_jwt


def test_register_forced_replaces_existing_credentials(
    tmp_path: Path, monkeypatch
) -> None:
    files = default_files_from_out_dir(str(tmp_path))
    write_credentials(
        files.credentialsFile,
        Credentials(
            apiKey="old-api-key",
            inboxId="old-user@atomicmail.ai",
            authUrl="https://auth.atomicmail.ai",
            apiUrl="https://api.atomicmail.ai",
            scryptSalt="salt",
            uploadUrl="https://api.atomicmail.ai/upload/{accountId}",
            downloadUrl="https://api.atomicmail.ai/download/{accountId}/{blobId}",
        ),
    )

    session_jwt = _make_jwt({"sub": "session", "exp": 4_000_000_000})
    capability_jwt = _make_jwt(
        {"inboxId": "replacement@atomicmail.ai", "exp": 4_000_000_000}
    )
    monkeypatch.setattr(
        "atomicmail.session.perform_pow_and_session",
        lambda **_kwargs: type(
            "SessionResponse",
            (),
            {"sessionJWT": session_jwt, "apiKey": "replacement-api-key"},
        )(),
    )
    monkeypatch.setattr(
        "atomicmail.session.fetch_capability",
        lambda *_args, **_kwargs: capability_jwt,
    )
    monkeypatch.setattr(
        "atomicmail.session.fetch_jmap_well_known",
        lambda *_args, **_kwargs: {
            "primaryAccounts": {"urn:ietf:params:jmap:mail": "acc-3"},
            "uploadUrl": "https://api.atomicmail.ai/upload/{accountId}",
            "downloadUrl": "https://api.atomicmail.ai/download/{accountId}/{blobId}",
            "apiUrl": "https://api.atomicmail.ai/jmap",
        },
    )

    session = AgentSession.create(_cfg(tmp_path, api_key="old-api-key", inbox_id="old-user@atomicmail.ai"))
    out = session.register("replacement", forced=True)

    assert out.inbox == "replacement@atomicmail.ai"
    assert out.accountId == "acc-3"
    assert out.apiKey == "replacement-api-key"


def test_login_with_api_key_persists_credentials_and_jwts(
    tmp_path: Path, monkeypatch
) -> None:
    session_jwt = _make_jwt({"sub": "session", "exp": 4_000_000_000})
    capability_jwt = _make_jwt(
        {"inboxId": "api-login@atomicmail.ai", "exp": 4_000_000_000}
    )

    def _fake_pow_and_session(**kwargs):
        assert kwargs["api_key"] == "existing-api-key"
        assert kwargs.get("username") is None
        return type(
            "SessionResponse", (), {"sessionJWT": session_jwt, "apiKey": None}
        )()

    monkeypatch.setattr("atomicmail.session.perform_pow_and_session", _fake_pow_and_session)
    monkeypatch.setattr(
        "atomicmail.session.fetch_capability",
        lambda *_args, **_kwargs: capability_jwt,
    )
    monkeypatch.setattr(
        "atomicmail.session.fetch_jmap_well_known",
        lambda *_args, **_kwargs: {
            "primaryAccounts": {"urn:ietf:params:jmap:mail": "acc-4"},
            "uploadUrl": "https://api.atomicmail.ai/upload/{accountId}",
            "downloadUrl": "https://api.atomicmail.ai/download/{accountId}/{blobId}",
            "apiUrl": "https://api.atomicmail.ai/jmap",
        },
    )

    session = AgentSession.create(_cfg(tmp_path, api_key=None, inbox_id=None))
    out = session.login_with_api_key("existing-api-key")

    assert out.inbox == "api-login@atomicmail.ai"
    assert out.accountId == "acc-4"
    assert out.apiKey is None

    creds = read_credentials(default_files_from_out_dir(str(tmp_path)).credentialsFile)
    assert creds == Credentials(
        apiKey="existing-api-key",
        inboxId="api-login@atomicmail.ai",
        authUrl="https://auth.atomicmail.ai",
        apiUrl="https://api.atomicmail.ai",
        scryptSalt="salt",
        uploadUrl="https://api.atomicmail.ai/upload/{accountId}",
        downloadUrl="https://api.atomicmail.ai/download/{accountId}/{blobId}",
    )
    assert default_files_from_out_dir(str(tmp_path)).sessionFile.read_text(
        encoding="utf-8"
    ) == session_jwt
    assert default_files_from_out_dir(str(tmp_path)).capabilityFile.read_text(
        encoding="utf-8"
    ) == capability_jwt


def test_register_requires_exactly_one_mode() -> None:
    with pytest.raises(ValueError, match="exactly one"):
        register(username=None, api_key=None, env={})
    with pytest.raises(ValueError, match="exactly one"):
        register(username="alice", api_key="existing-api-key", env={})


def test_register_rejects_forced_in_api_key_mode() -> None:
    with pytest.raises(ValueError, match="forced is only supported"):
        register(
            username=None,
            api_key="existing-api-key",
            forced=True,
            env={},
        )


def test_create_agent_session_with_store_uses_overrides(tmp_path: Path) -> None:
    class _InMemoryStore:
        def __init__(self) -> None:
            self._artifacts = CredentialArtifacts(
                credentials=Credentials(
                    apiKey="stored-api-key",
                    inboxId="stored@atomicmail.ai",
                    authUrl="https://stored-auth.atomicmail.ai",
                    apiUrl="https://stored-api.atomicmail.ai",
                    scryptSalt="stored-salt",
                    uploadUrl="https://stored-api.atomicmail.ai/upload/{accountId}",
                    downloadUrl="https://stored-api.atomicmail.ai/download/{accountId}/{blobId}",
                )
            )

        def load(self) -> CredentialArtifacts:
            return self._artifacts

        def save(self, incoming: CredentialArtifacts) -> None:
            if incoming.credentials is not None:
                self._artifacts.credentials = incoming.credentials
            if incoming.session_jwt is not None:
                self._artifacts.session_jwt = incoming.session_jwt
            if incoming.capability_jwt is not None:
                self._artifacts.capability_jwt = incoming.capability_jwt

        def clear(self) -> None:
            self._artifacts = CredentialArtifacts()

    session = create_agent_session(
        store=_InMemoryStore(),
        env={"ATOMIC_MAIL_AUTH_URL": "https://env-auth.atomicmail.ai"},
        provider_api_key="provider-api-key",
        credentials_dir=str(tmp_path),
    )

    assert session.has_api_key is True
    assert session.current_inbox_id == "stored@atomicmail.ai"


def test_create_agent_session_with_store_does_not_require_home(monkeypatch) -> None:
    class _InMemoryStore:
        def load(self) -> CredentialArtifacts:
            return CredentialArtifacts()

        def save(self, incoming: CredentialArtifacts) -> None:
            return None

        def clear(self) -> None:
            return None

    monkeypatch.delenv("HOME", raising=False)
    monkeypatch.delenv("USERPROFILE", raising=False)

    session = create_agent_session(store=_InMemoryStore(), env={})

    assert session.credentialDir == ""


def test_create_agent_session_with_store_expands_explicit_credentials_dir(
    tmp_path: Path, monkeypatch
) -> None:
    class _InMemoryStore:
        def load(self) -> CredentialArtifacts:
            return CredentialArtifacts()

        def save(self, incoming: CredentialArtifacts) -> None:
            return None

        def clear(self) -> None:
            return None

    monkeypatch.setenv("HOME", str(tmp_path))

    session = create_agent_session(
        store=_InMemoryStore(),
        env={},
        credentials_dir="~/custom-atomicmail-dir",
    )

    assert session.credentialDir == str((tmp_path / "custom-atomicmail-dir").resolve())


def test_register_uses_store_session_factory(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class _FakeSession:
        def register(self, username: str, *, forced: bool = False):
            captured["username"] = username
            captured["forced"] = forced
            return type(
                "RegisterResult",
                (),
                {"inbox": "ok@atomicmail.ai", "accountId": "acc-1", "apiKey": None, "idempotent": True},
            )()

        def login_with_api_key(self, api_key: str):
            captured["api_key"] = api_key
            return type(
                "RegisterResult",
                (),
                {"inbox": "ok@atomicmail.ai", "accountId": "acc-1", "apiKey": None, "idempotent": None},
            )()

    sentinel_store = object()

    def _fake_factory(**kwargs):
        captured.update(kwargs)
        return _FakeSession()

    monkeypatch.setattr("atomicmail.session.create_agent_session", _fake_factory)
    out = register(username="alice", store=sentinel_store, forced=True)

    assert out.inbox == "ok@atomicmail.ai"
    assert captured["store"] is sentinel_store
    assert captured["username"] == "alice"
    assert captured["forced"] is True
