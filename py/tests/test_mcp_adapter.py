from __future__ import annotations

import json

from atomicmail.jmap_request import JmapRequestResult
from atomicmail.mcp_server import handle_tool_call
from atomicmail.session import RegisterResult


def _extract_text(result: dict[str, object]) -> str:
    content = result.get("content")
    assert isinstance(content, list)
    first = content[0]
    assert isinstance(first, dict)
    text = first.get("text")
    assert isinstance(text, str)
    return text


def test_mcp_help_tool_returns_topic_text() -> None:
    out = handle_tool_call("help", {"topic": "overview"})
    assert out.get("isError") is None
    assert len(_extract_text(out).strip()) > 0


def test_mcp_register_tool_wraps_errors(monkeypatch) -> None:
    def _boom(*_args, **_kwargs):
        raise ValueError("bad username")

    monkeypatch.setattr("atomicmail.mcp_server.register", _boom)

    out = handle_tool_call("register", {"username": "alice"})
    assert out.get("isError") is True
    assert _extract_text(out) == "Registration failed: bad username"


def test_mcp_register_tool_requires_username() -> None:
    out = handle_tool_call("register", {"forced": True})
    assert out.get("isError") is True
    assert "username must be a non-empty string" in _extract_text(out)


def test_mcp_register_tool_passes_username_contract(monkeypatch) -> None:
    def _fake_register(
        username: str | None,
        *,
        api_key: str | None = None,
        credentials_dir: str | None = None,
        forced: bool = False,
    ):
        assert username == "alice"
        assert api_key is None
        assert credentials_dir == "/tmp/creds"
        assert forced is True
        return RegisterResult(inbox="alice@atomicmail.ai", accountId="acc-1", apiKey="k")

    monkeypatch.setattr("atomicmail.mcp_server.register", _fake_register)
    out = handle_tool_call(
        "register",
        {"username": "alice", "credentials_dir": "/tmp/creds", "forced": True},
    )
    assert out.get("isError") is None
    text = _extract_text(out)
    assert "alice@atomicmail.ai" in text
    assert "acc-1" in text


def test_mcp_register_tool_rejects_non_boolean_forced() -> None:
    out = handle_tool_call("register", {"username": "alice", "forced": "false"})
    assert out.get("isError") is True
    assert "forced must be a boolean" in _extract_text(out)


def test_mcp_jmap_tool_validates_ops_exclusive() -> None:
    out = handle_tool_call("jmap_request", {"ops": "[]", "ops_file": "x.json"})
    assert out.get("isError") is True
    assert "mutually exclusive" in _extract_text(out)


def test_mcp_jmap_tool_dispatches_success(monkeypatch) -> None:
    def _fake_jmap_request(**kwargs):
        assert kwargs["ops"] == "[]"
        assert kwargs["vars"] == {"TO": "alice@atomicmail.ai"}
        attachments = kwargs["attachments"]
        assert attachments is not None and len(attachments) == 1
        assert attachments[0].path == "/tmp/file.txt"
        return JmapRequestResult(ok=True, status=200, bodyText=json.dumps({"ok": True}))

    monkeypatch.setattr("atomicmail.mcp_server.jmap_request", _fake_jmap_request)
    out = handle_tool_call(
        "jmap_request",
        {
            "ops": "[]",
            "vars": {"TO": "alice@atomicmail.ai"},
            "attachments": [{"path": "/tmp/file.txt"}],
        },
    )
    assert out.get("isError") is None
    assert '"ok": true' in _extract_text(out).lower()


def test_mcp_jmap_tool_rejects_invalid_vars_key() -> None:
    out = handle_tool_call("jmap_request", {"ops": "[]", "vars": {"lower": "x"}})
    assert out.get("isError") is True
    assert "must match /^[A-Z][A-Z0-9_]*$/" in _extract_text(out)


def test_mcp_jmap_tool_rejects_non_boolean_dry_run() -> None:
    out = handle_tool_call("jmap_request", {"ops": "[]", "dry_run": "true"})
    assert out.get("isError") is True
    assert "dry_run must be a boolean" in _extract_text(out)
