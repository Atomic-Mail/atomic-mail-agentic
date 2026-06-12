from __future__ import annotations

import os
from pathlib import Path

from atomicmail.config import (
    expand_credential_dir_input,
    resolve_agent_config_from_env,
    resolve_credential_dir,
)
from atomicmail.constants import DEFAULT_API_URL, DEFAULT_AUTH_URL
from atomicmail.credentials import Credentials, write_credentials


def test_resolve_agent_config_defaults_when_unset(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("ATOMIC_MAIL_CREDENTIALS_DIR", str(tmp_path))
    monkeypatch.delenv("ATOMIC_MAIL_AUTH_URL", raising=False)
    monkeypatch.delenv("ATOMIC_MAIL_API_URL", raising=False)
    monkeypatch.delenv("ATOMIC_MAIL_API_KEY", raising=False)
    monkeypatch.delenv("ATOMIC_MAIL_SCRYPT_SALT", raising=False)

    config = resolve_agent_config_from_env()

    assert config.authUrl == DEFAULT_AUTH_URL
    assert config.apiUrl == DEFAULT_API_URL
    assert config.source == "defaults"
    assert config.credentialDir == str(tmp_path)


def test_resolve_agent_config_prefers_env(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("ATOMIC_MAIL_CREDENTIALS_DIR", str(tmp_path))
    monkeypatch.setenv("ATOMIC_MAIL_AUTH_URL", "https://auth.example.test///")
    monkeypatch.setenv("ATOMIC_MAIL_API_URL", "https://api.example.test//")

    config = resolve_agent_config_from_env()

    assert config.authUrl == "https://auth.example.test"
    assert config.apiUrl == "https://api.example.test"
    assert config.source == "env"


def test_resolve_agent_config_mixed_sources(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("ATOMIC_MAIL_CREDENTIALS_DIR", str(tmp_path))
    write_credentials(
        tmp_path / "credentials.json",
        Credentials(
            apiKey="file-api-key",
            inboxId="alice@atomicmail.ai",
            authUrl="https://auth.file.test",
            apiUrl="https://api.file.test",
            scryptSalt="file-salt",
            uploadUrl="https://upload.file.test",
            downloadUrl="https://download.file.test",
        ),
    )
    monkeypatch.setenv("ATOMIC_MAIL_API_KEY", "env-api-key")

    config = resolve_agent_config_from_env()

    assert config.source == "mixed"
    assert config.apiKey == "env-api-key"
    assert config.inboxId == "alice@atomicmail.ai"


def test_resolve_credential_dir_uses_home(monkeypatch) -> None:
    monkeypatch.delenv("ATOMIC_MAIL_CREDENTIALS_DIR", raising=False)
    monkeypatch.setenv("HOME", "/tmp/home-for-test")
    monkeypatch.delenv("USERPROFILE", raising=False)

    assert resolve_credential_dir() == "/tmp/home-for-test/.atomicmail"


def test_resolve_credential_dir_requires_home(monkeypatch) -> None:
    monkeypatch.delenv("ATOMIC_MAIL_CREDENTIALS_DIR", raising=False)
    monkeypatch.delenv("HOME", raising=False)
    monkeypatch.delenv("USERPROFILE", raising=False)

    try:
        resolve_credential_dir()
    except ValueError as err:
        assert "ATOMIC_MAIL_CREDENTIALS_DIR" in str(err)
    else:
        raise AssertionError("Expected resolve_credential_dir to fail")


def test_expand_credential_dir_input_expands_tilde(monkeypatch) -> None:
    monkeypatch.delenv("ATOMIC_MAIL_CREDENTIALS_DIR", raising=False)
    expanded = expand_credential_dir_input("~/.atomicmail")
    assert expanded.endswith(f"{os.sep}.atomicmail")
