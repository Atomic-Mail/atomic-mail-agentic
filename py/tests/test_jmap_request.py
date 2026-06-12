from __future__ import annotations

import importlib
import json
from pathlib import Path

import pytest

from atomicmail.jmap_request import JmapRequestResult, jmap_request, run_jmap_request

JMAP_MODULE = importlib.import_module("atomicmail.jmap_request")


class _FakeSession:
    def __init__(self, *, inbox_id: str | None = "agent@atomicmail.ai") -> None:
        self.current_inbox_id = inbox_id
        self.credentialDir = "/tmp/fake"

    def get_primary_mail_account_id(self) -> str:
        return "acc-1"

    def get_capability_token(self) -> str:
        return "cap-token"

    def get_jmap_post_url(self) -> str:
        return "https://api.atomicmail.ai/jmap"


def test_jmap_request_validates_ops_inputs() -> None:
    with pytest.raises(ValueError, match="mutually exclusive"):
        jmap_request(ops="[]", ops_file="send_mail.json")

    with pytest.raises(ValueError, match="Provide either ops or ops_file"):
        jmap_request()


def test_jmap_request_uses_bundled_ops_fallback(
    tmp_path: Path, monkeypatch
) -> None:
    captured: dict[str, object] = {}

    monkeypatch.setattr(JMAP_MODULE, "resolve_agent_config_from_env", lambda *_args, **_kwargs: object())
    monkeypatch.setattr(
        JMAP_MODULE.AgentSession,
        "from_resolved_config",
        lambda _cfg: _FakeSession(),
    )

    def fake_run(**kwargs):
        captured.update(kwargs)
        return JmapRequestResult(ok=True, status=200, bodyText="{}")

    monkeypatch.setattr(JMAP_MODULE, "run_jmap_request", fake_run)

    out = jmap_request(ops_file="send_mail.json", credentials_dir=str(tmp_path))
    assert out.ok is True
    assert captured["source_label"] == "ops_file 'send_mail.json'"
    assert "Email/set" in str(captured["ops_json"])


def test_run_jmap_request_uses_default_using_and_adds_next_hints(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_post(jmap_post_url: str, capability_jwt: str, envelope: dict[str, object]):
        captured["url"] = jmap_post_url
        captured["token"] = capability_jwt
        captured["envelope"] = envelope
        return JmapRequestResult(ok=True, status=200, bodyText='{"methodResponses":[]}')

    monkeypatch.setattr(JMAP_MODULE, "_post_jmap", fake_post)
    out = run_jmap_request(
        session=_FakeSession(),
        ops_json='[["Mailbox/get",{}, "m0"]]',
    )

    assert out.ok is True
    assert out.status == 200
    parsed = json.loads(out.bodyText)
    assert isinstance(parsed.get("_next"), list)
    assert captured["url"] == "https://api.atomicmail.ai/jmap"
    assert captured["token"] == "cap-token"
    assert captured["envelope"] == {
        "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
        "methodCalls": [["Mailbox/get", {}, "m0"]],
    }


def test_run_jmap_request_keeps_explicit_using(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_post(_url: str, _token: str, envelope: dict[str, object]):
        captured["using"] = envelope["using"]
        return JmapRequestResult(ok=True, status=200, bodyText='{"ok":true}')

    monkeypatch.setattr(JMAP_MODULE, "_post_jmap", fake_post)
    run_jmap_request(
        session=_FakeSession(),
        ops_json='{"using":["urn:test"],"methodCalls":[]}',
    )
    assert captured["using"] == ["urn:test"]


def test_run_jmap_request_reports_missing_placeholder() -> None:
    with pytest.raises(ValueError, match=r"\$TO"):
        run_jmap_request(
            session=_FakeSession(),
            ops_json='[["Email/set",{"to":"$TO"},"m0"]]',
        )


def test_run_jmap_request_reports_missing_session_placeholder() -> None:
    with pytest.raises(ValueError, match=r"\$INBOX"):
        run_jmap_request(
            session=_FakeSession(inbox_id=None),
            ops_json='[["Email/set",{"from":"$INBOX"},"m0"]]',
        )


def test_run_jmap_request_returns_failed_response_without_hints(monkeypatch) -> None:
    monkeypatch.setattr(
        JMAP_MODULE,
        "_post_jmap",
        lambda *_args, **_kwargs: JmapRequestResult(ok=False, status=500, bodyText='{"type":"error"}'),
    )
    out = run_jmap_request(session=_FakeSession(), ops_json='[["Mailbox/get",{},"m0"]]')
    assert out.ok is False
    assert out.status == 500
    assert out.bodyText == '{"type":"error"}'


def test_jmap_request_ops_file_missing_reports_template(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setattr(JMAP_MODULE, "resolve_agent_config_from_env", lambda *_args, **_kwargs: object())
    monkeypatch.setattr(
        JMAP_MODULE.AgentSession,
        "from_resolved_config",
        lambda _cfg: _FakeSession(),
    )

    with pytest.raises(ValueError, match="not among bundled presets"):
        jmap_request(ops_file="does_not_exist.json", credentials_dir=str(tmp_path))
