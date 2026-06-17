from __future__ import annotations

import json

import pytest

from atomicmail.jmap_request import JmapRequestResult
from atomicmail.session import RegisterResult
from langchain_atomicmail import (
    AtomicMailToolkit,
    get_atomicmail_tools,
    help_tool,
    jmap_request_tool,
    register_tool,
)


def test_register_tool_delegates_to_core(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def _fake_register(
        username: str | None = None,
        *,
        api_key: str | None = None,
        credentials_dir: str | None = None,
        forced: bool = False,
        env=None,
        store=None,
    ):
        captured["username"] = username
        captured["api_key"] = api_key
        captured["credentials_dir"] = credentials_dir
        captured["forced"] = forced
        return RegisterResult(inbox="alice@atomicmail.ai", accountId="acc-1", apiKey="k")

    monkeypatch.setattr("langchain_atomicmail.tools.atomicmail_register", _fake_register)
    out = register_tool(username="alice", credentials_dir="/tmp/creds", forced=True)
    parsed = json.loads(out)

    assert captured == {
        "username": "alice",
        "api_key": None,
        "credentials_dir": "/tmp/creds",
        "forced": True,
    }
    assert parsed["inbox"] == "alice@atomicmail.ai"
    assert parsed["accountId"] == "acc-1"


def test_jmap_request_tool_validates_ops_exclusive() -> None:
    with pytest.raises(ValueError, match="mutually exclusive"):
        jmap_request_tool(ops="[]", ops_file="send_mail.json")


def test_jmap_request_tool_validates_ops_required() -> None:
    with pytest.raises(ValueError, match="Provide either ops or ops_file"):
        jmap_request_tool()


def test_jmap_request_tool_validates_vars_key_pattern() -> None:
    with pytest.raises(ValueError, match="must match"):
        jmap_request_tool(ops="[]", vars={"lower": "x"})


def test_jmap_request_tool_delegates_and_passes_constraints(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def _fake_jmap_request(**kwargs):
        captured.update(kwargs)
        return JmapRequestResult(ok=True, status=200, bodyText='{"ok":true}')

    monkeypatch.setattr("langchain_atomicmail.tools.atomicmail_jmap_request", _fake_jmap_request)
    out = jmap_request_tool(
        ops='[["Mailbox/get",{}, "m0"]]',
        vars={"TO": "agent@atomicmail.ai"},
        attachments=[{"path": "/tmp/file.txt"}],
    )

    assert out == '{"ok":true}'
    assert captured["ops"] == '[["Mailbox/get",{}, "m0"]]'
    assert captured["ops_file"] is None
    assert captured["vars"] == {"TO": "agent@atomicmail.ai"}
    assert captured["dry_run"] is False
    assert captured["using"] == ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"]
    assert captured["credentials_dir"] is None
    attachments = captured["attachments"]
    assert attachments is not None and len(attachments) == 1
    assert attachments[0].path == "/tmp/file.txt"


def test_jmap_request_tool_rejects_http_failure(monkeypatch) -> None:
    monkeypatch.setattr(
        "langchain_atomicmail.tools.atomicmail_jmap_request",
        lambda **_kwargs: JmapRequestResult(ok=False, status=500, bodyText='{"type":"error"}'),
    )
    with pytest.raises(ValueError, match=r"HTTP 500"):
        jmap_request_tool(ops='[["Mailbox/get",{}, "m0"]]')


def test_help_tool_delegates(monkeypatch) -> None:
    monkeypatch.setattr(
        "langchain_atomicmail.tools.atomicmail_help", lambda topic=None: f"topic={topic}"
    )
    assert help_tool(topic="overview") == "topic=overview"


def test_get_atomicmail_tools_names() -> None:
    tool_names = [tool.name for tool in get_atomicmail_tools()]
    assert tool_names == ["register", "jmap_request", "help"]


def test_toolkit_get_tools_returns_all_tools() -> None:
    toolkit = AtomicMailToolkit()
    tool_names = [tool.name for tool in toolkit.get_tools()]
    assert tool_names == ["register", "jmap_request", "help"]
