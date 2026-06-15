from __future__ import annotations

from types import SimpleNamespace

from dify_plugin.entities.tool import ToolRuntime

from conftest import FakeStorage
from utils.session_factory import create_session_from_dify


def _tool() -> SimpleNamespace:
    runtime = ToolRuntime(
        credentials={
            "api_key": "provider-api-key",
            "auth_url": "https://auth.atomicmail.ai",
            "api_url": "https://api.atomicmail.ai",
        },
        user_id="u1",
        session_id="s1",
    )
    session = SimpleNamespace(storage=FakeStorage())
    return SimpleNamespace(runtime=runtime, session=session)


def test_create_session_from_dify_without_home_uses_store(monkeypatch) -> None:
    monkeypatch.delenv("HOME", raising=False)
    monkeypatch.delenv("USERPROFILE", raising=False)

    session = create_session_from_dify(_tool())

    assert session.credentialDir == ""
    assert session.has_api_key is True
