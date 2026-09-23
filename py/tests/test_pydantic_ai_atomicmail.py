from __future__ import annotations

import json

import pytest

pytest.importorskip("pydantic_ai", reason="pydantic-ai is not installed")

from pydantic_ai import Agent  # noqa: E402
from pydantic_ai.models.test import TestModel  # noqa: E402

from atomicmail.jmap_request import DEFAULT_JMAP_USING, JmapRequestResult  # noqa: E402
from atomicmail.session import RegisterResult  # noqa: E402
from pydantic_ai_atomicmail import (  # noqa: E402
    AtomicMailCapability,
    AtomicMailToolset,
    help_tool,
    jmap_request_tool,
    register_tool,
)

TOOL_NAMES = {"register", "jmap_request", "help"}


def _fake_jmap_result(body: str = "{}", *, ok: bool = True, status: int = 200):
    return JmapRequestResult(ok=ok, status=status, bodyText=body)


# --- register ---------------------------------------------------------------


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
        captured.update(
            username=username,
            api_key=api_key,
            credentials_dir=credentials_dir,
            forced=forced,
        )
        return RegisterResult(inbox="alice@atomicmail.ai", accountId="acc-1", apiKey="k")

    monkeypatch.setattr(
        "pydantic_ai_atomicmail.tools.atomicmail_register", _fake_register
    )
    parsed = json.loads(
        register_tool(username="alice", credentials_dir="/tmp/creds", forced=True)
    )

    assert captured == {
        "username": "alice",
        "api_key": None,
        "credentials_dir": "/tmp/creds",
        "forced": True,
    }
    assert parsed["inbox"] == "alice@atomicmail.ai"
    assert parsed["accountId"] == "acc-1"


def test_register_tool_includes_cron_reminder(monkeypatch) -> None:
    monkeypatch.setattr(
        "pydantic_ai_atomicmail.tools.atomicmail_register",
        lambda **_kwargs: RegisterResult(
            inbox="alice@atomicmail.ai", accountId="acc-1", apiKey="k"
        ),
    )
    parsed = json.loads(register_tool(username="alice"))

    assert isinstance(parsed["_next"], list)
    assert len(parsed["_next"]) == 1
    assert "watch" in parsed["_next"][0]


# --- jmap_request -----------------------------------------------------------


def test_jmap_request_tool_returns_body(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def _fake_jmap(**kwargs):
        captured.update(kwargs)
        return _fake_jmap_result('{"methodResponses": []}')

    monkeypatch.setattr(
        "pydantic_ai_atomicmail.tools.atomicmail_jmap_request", _fake_jmap
    )
    out = jmap_request_tool(ops='{"methodCalls": []}', vars={"FOO": "bar"})

    assert out == '{"methodResponses": []}'
    assert captured["ops"] == '{"methodCalls": []}'
    assert captured["ops_file"] is None
    assert captured["vars"] == {"FOO": "bar"}
    assert captured["using"] == list(DEFAULT_JMAP_USING)


def test_jmap_request_tool_rejects_both_ops_and_ops_file() -> None:
    with pytest.raises(ValueError, match="mutually exclusive"):
        jmap_request_tool(ops="{}", ops_file="presets/list_inbox.json")


def test_jmap_request_tool_requires_ops_or_ops_file() -> None:
    with pytest.raises(ValueError):
        jmap_request_tool()


def test_jmap_request_tool_rejects_dry_run_with_attachments() -> None:
    with pytest.raises(ValueError):
        jmap_request_tool(
            ops="{}", dry_run=True, attachments=[{"path": "/tmp/report.pdf"}]
        )


def test_jmap_request_tool_rejects_invalid_var_key() -> None:
    with pytest.raises(ValueError, match="vars key 'foo'"):
        jmap_request_tool(ops="{}", vars={"foo": "bar"})


def test_jmap_request_tool_coerces_attachments(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def _fake_jmap(**kwargs):
        captured.update(kwargs)
        return _fake_jmap_result()

    monkeypatch.setattr(
        "pydantic_ai_atomicmail.tools.atomicmail_jmap_request", _fake_jmap
    )
    jmap_request_tool(
        ops="{}",
        attachments=[
            {
                "path": "/tmp/report.pdf",
                "filename": "report.pdf",
                "content_type": "application/pdf",
            }
        ],
    )

    attachment = captured["attachments"][0]
    assert attachment.path == "/tmp/report.pdf"
    assert attachment.filename == "report.pdf"
    assert attachment.contentType == "application/pdf"


def test_jmap_request_tool_rejects_attachment_without_path() -> None:
    with pytest.raises(ValueError, match=r"attachments\[0\].path"):
        jmap_request_tool(ops="{}", attachments=[{"filename": "report.pdf"}])


def test_jmap_request_tool_raises_on_http_error(monkeypatch) -> None:
    monkeypatch.setattr(
        "pydantic_ai_atomicmail.tools.atomicmail_jmap_request",
        lambda **_kwargs: _fake_jmap_result("nope", ok=False, status=401),
    )
    with pytest.raises(ValueError, match="HTTP 401"):
        jmap_request_tool(ops="{}")


# --- help -------------------------------------------------------------------


def test_help_tool_delegates_topic(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def _fake_help(*, topic=None):
        captured["topic"] = topic
        return "help text"

    monkeypatch.setattr("pydantic_ai_atomicmail.tools.atomicmail_help", _fake_help)

    assert help_tool(topic="cron") == "help text"
    assert captured["topic"] == "cron"


# --- toolset ----------------------------------------------------------------


def _registered_tools(toolset_or_capability) -> dict:
    model = TestModel(call_tools=[])
    if isinstance(toolset_or_capability, AtomicMailToolset):
        agent = Agent(model, toolsets=[toolset_or_capability])
    else:
        agent = Agent(model, capabilities=[toolset_or_capability])
    agent.run_sync("hi")
    return {t.name: t for t in model.last_model_request_parameters.function_tools}


def test_toolset_registers_three_tools() -> None:
    assert set(_registered_tools(AtomicMailToolset())) == TOOL_NAMES


def test_toolset_tool_schemas_expose_expected_arguments() -> None:
    tools = _registered_tools(AtomicMailToolset())

    assert set(tools["register"].parameters_json_schema["properties"]) == {
        "username",
        "credentials_dir",
        "forced",
    }
    assert set(tools["jmap_request"].parameters_json_schema["properties"]) == {
        "ops",
        "ops_file",
        "vars",
        "dry_run",
        "attachments",
        "using",
        "credentials_dir",
    }
    assert set(tools["help"].parameters_json_schema["properties"]) == {"topic"}


def test_toolset_tools_have_descriptions() -> None:
    tools = _registered_tools(AtomicMailToolset())

    assert "Atomic Mail inbox" in tools["register"].description
    assert "JMAP" in tools["jmap_request"].description
    assert "Topics:" in tools["help"].description


def test_toolset_credentials_dir_is_used_as_default(monkeypatch) -> None:
    captured: dict[str, object] = {}
    monkeypatch.setattr(
        "pydantic_ai_atomicmail.tools.atomicmail_register",
        lambda **kwargs: captured.update(kwargs)
        or RegisterResult(inbox="a@atomicmail.ai", accountId="acc", apiKey="k"),
    )
    toolset = AtomicMailToolset(credentials_dir="/tmp/shared")
    toolset._register(username="alice")

    assert captured["credentials_dir"] == "/tmp/shared"


def test_toolset_explicit_credentials_dir_overrides_default(monkeypatch) -> None:
    captured: dict[str, object] = {}
    monkeypatch.setattr(
        "pydantic_ai_atomicmail.tools.atomicmail_jmap_request",
        lambda **kwargs: captured.update(kwargs) or _fake_jmap_result(),
    )
    toolset = AtomicMailToolset(credentials_dir="/tmp/shared")
    toolset._jmap_request(ops="{}", credentials_dir="/tmp/per-call")

    assert captured["credentials_dir"] == "/tmp/per-call"


# --- capability -------------------------------------------------------------


def test_capability_registers_the_toolset() -> None:
    assert set(_registered_tools(AtomicMailCapability())) == TOOL_NAMES


def test_capability_provides_instructions() -> None:
    instructions = AtomicMailCapability().get_instructions()

    assert instructions is not None
    assert "Atomic Mail inbox" in instructions


def test_capability_instructions_can_be_disabled() -> None:
    assert AtomicMailCapability(instructions=None).get_instructions() is None


def test_capability_passes_credentials_dir_to_toolset() -> None:
    capability = AtomicMailCapability(credentials_dir="/tmp/shared")

    assert capability.get_toolset().credentials_dir == "/tmp/shared"


def test_capability_serialization_name() -> None:
    assert AtomicMailCapability.get_serialization_name() == "AtomicMailCapability"
