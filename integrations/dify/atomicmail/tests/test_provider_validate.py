from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from dify_plugin.errors.tool import ToolProviderCredentialValidationError

from conftest import FakeStorage
from provider.atomicmail import AtomicmailProvider


def _provider() -> AtomicmailProvider:
    provider = AtomicmailProvider()
    provider.runtime = SimpleNamespace(credentials={})
    provider.session = SimpleNamespace(storage=FakeStorage())
    return provider


def test_provider_validate_skips_when_api_key_not_provided(monkeypatch) -> None:
    provider = _provider()
    create_session = Mock()
    monkeypatch.setattr("provider.atomicmail.create_agent_session", create_session)

    provider._validate_credentials({"auth_url": "https://auth.atomicmail.ai"})

    create_session.assert_not_called()


def test_provider_validate_logs_in_and_persists_default_account(monkeypatch) -> None:
    provider = _provider()
    login = Mock()
    fake_session = SimpleNamespace(login_with_api_key=login)
    create_session = Mock(return_value=fake_session)
    monkeypatch.setattr("provider.atomicmail.create_agent_session", create_session)

    provider._validate_credentials(
        {
            "api_key": "  api-key-123  ",
            "auth_url": " https://auth.atomicmail.ai ",
            "api_url": " https://api.atomicmail.ai ",
        }
    )

    create_session.assert_called_once()
    kwargs = create_session.call_args.kwargs
    assert kwargs["provider_api_key"] == "api-key-123"
    assert kwargs["env"] == {
        "ATOMIC_MAIL_AUTH_URL": "https://auth.atomicmail.ai",
        "ATOMIC_MAIL_API_URL": "https://api.atomicmail.ai",
    }
    assert kwargs["store"].account_id == "default"
    login.assert_called_once_with("api-key-123")


def test_provider_validate_wraps_login_errors(monkeypatch) -> None:
    provider = _provider()
    fake_session = SimpleNamespace(
        login_with_api_key=Mock(side_effect=RuntimeError("invalid api key"))
    )
    monkeypatch.setattr(
        "provider.atomicmail.create_agent_session",
        Mock(return_value=fake_session),
    )

    with pytest.raises(ToolProviderCredentialValidationError, match="invalid api key"):
        provider._validate_credentials({"api_key": "bad-key"})
