from __future__ import annotations

import importlib
import json
from pathlib import Path

import pytest

from atomicmail.credentials import Credentials, write_credentials
from atomicmail.jmap_request import JmapRequestResult, jmap_request, run_jmap_request

JMAP_MODULE = importlib.import_module("atomicmail.jmap_request")


class _FakeSession:
    def __init__(
        self,
        *,
        inbox_id: str | None = "agent@atomicmail.ai",
        upload_url: str | None = "https://api.atomicmail.ai/upload/{accountId}",
        limits: dict[str, int | None] | None = None,
    ) -> None:
        self.current_inbox_id = inbox_id
        self.current_upload_url = upload_url
        self.credentialDir = "/tmp/fake"
        self.files = type("Files", (), {"credentialsFile": "/tmp/fake/credentials.json"})()
        self._limits = limits or {"maxSizeBlobSet": None}

    def get_primary_mail_account_id(self) -> str:
        return "acc-1"

    def get_capability_token(self) -> str:
        return "cap-token"

    def get_jmap_post_url(self) -> str:
        return "https://api.atomicmail.ai/jmap"

    def get_blob_upload_limits_for_account(self, _account_id: str) -> dict[str, int | None] | None:
        return self._limits


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
    with pytest.raises(ValueError, match="No inbox in session"):
        run_jmap_request(
            session=_FakeSession(inbox_id=None),
            ops_json='[["Email/set",{"from":"$INBOX"},"m0"]]',
        )


def test_run_jmap_request_resolves_inbox_from_credentials_fallback(
    tmp_path: Path, monkeypatch
) -> None:
    captured: dict[str, object] = {}
    fake = _FakeSession(inbox_id=None)
    fake.files = type(
        "Files",
        (),
        {"credentialsFile": str(tmp_path / "credentials.json")},
    )()
    write_credentials(
        fake.files.credentialsFile,
        Credentials(
            apiKey="k",
            inboxId="fallback",
            authUrl="https://auth.atomicmail.ai",
            apiUrl="https://api.atomicmail.ai",
            scryptSalt="salt",
            uploadUrl="https://api.atomicmail.ai/upload/{accountId}",
            downloadUrl="https://api.atomicmail.ai/download/{accountId}/{blobId}",
        ),
    )

    def fake_post(_url: str, _token: str, envelope: dict[str, object]):
        captured["envelope"] = envelope
        return JmapRequestResult(ok=True, status=200, bodyText='{"ok":true}')

    monkeypatch.setattr(JMAP_MODULE, "_post_jmap", fake_post)
    monkeypatch.setenv("ATOMIC_MAIL_INBOX_DOMAIN", "mail.example")
    run_jmap_request(
        session=fake,
        ops_json='[["Email/set",{"create":{"m1":{"from":[{"email":"$INBOX"}]}}},"m0"]]',
    )

    envelope = captured["envelope"]
    assert isinstance(envelope, dict)
    method_calls = envelope["methodCalls"]
    assert isinstance(method_calls, list)
    first_call = method_calls[0]
    assert isinstance(first_call, list)
    arg = first_call[1]
    assert isinstance(arg, dict)
    create = arg["create"]
    assert isinstance(create, dict)
    m1 = create["m1"]
    assert isinstance(m1, dict)
    from_list = m1["from"]
    assert isinstance(from_list, list)
    first_from = from_list[0]
    assert isinstance(first_from, dict)
    assert first_from["email"] == "fallback@mail.example"


def test_run_jmap_request_normalizes_inbox_from_session(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_post(_url: str, _token: str, envelope: dict[str, object]):
        captured["envelope"] = envelope
        return JmapRequestResult(ok=True, status=200, bodyText='{"ok":true}')

    monkeypatch.setattr(JMAP_MODULE, "_post_jmap", fake_post)
    monkeypatch.setenv("ATOMIC_MAIL_INBOX_DOMAIN", "@relay.example")
    run_jmap_request(
        session=_FakeSession(inbox_id="agent"),
        ops_json='[["Email/set",{"create":{"m1":{"from":[{"email":"$INBOX"}]}}},"m0"]]',
    )

    envelope = captured["envelope"]
    assert isinstance(envelope, dict)
    method_calls = envelope["methodCalls"]
    assert isinstance(method_calls, list)
    first_call = method_calls[0]
    assert isinstance(first_call, list)
    arg = first_call[1]
    assert isinstance(arg, dict)
    create = arg["create"]
    assert isinstance(create, dict)
    m1 = create["m1"]
    assert isinstance(m1, dict)
    from_list = m1["from"]
    assert isinstance(from_list, list)
    first_from = from_list[0]
    assert isinstance(first_from, dict)
    assert first_from["email"] == "agent@relay.example"


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


def test_run_jmap_request_uploads_attachment_and_substitutes_vars(
    tmp_path: Path, monkeypatch
) -> None:
    sent_uploads: list[tuple[str, bytes, str]] = []
    captured: dict[str, object] = {}
    attachment_path = tmp_path / "hello.txt"
    attachment_path.write_text("hello", encoding="utf-8")

    def fake_upload(*, upload_url_expanded: str, capability_jwt: str, content: bytes, content_type: str):
        assert capability_jwt == "cap-token"
        sent_uploads.append((upload_url_expanded, content, content_type))
        return "blob-1", len(content)

    def fake_post(_url: str, _token: str, envelope: dict[str, object]):
        captured["envelope"] = envelope
        return JmapRequestResult(ok=True, status=200, bodyText='{"ok":true}')

    monkeypatch.setattr(JMAP_MODULE, "_post_binary_blob_upload", fake_upload)
    monkeypatch.setattr(JMAP_MODULE, "_post_jmap", fake_post)

    run_jmap_request(
        session=_FakeSession(),
        ops_json='[["Email/set",{"create":{"m1":{"attachments":[{"blobId":"$ATTACHMENT_0_BLOB_ID","type":"$ATTACHMENT_0_TYPE","name":"$ATTACHMENT_0_NAME","size":"$ATTACHMENT_0_SIZE"}]}}},"c0"]]',
        attachments=[{"path": str(attachment_path)}],
    )

    assert sent_uploads == [("https://api.atomicmail.ai/upload/acc-1", b"hello", "text/plain")]
    envelope = captured["envelope"]
    assert isinstance(envelope, dict)
    method_calls = envelope["methodCalls"]
    assert isinstance(method_calls, list)
    first = method_calls[0]
    assert isinstance(first, list)
    email_set_arg = first[1]
    assert isinstance(email_set_arg, dict)
    create = email_set_arg["create"]
    assert isinstance(create, dict)
    msg = create["m1"]
    assert isinstance(msg, dict)
    attachments = msg["attachments"]
    assert isinstance(attachments, list)
    first_attachment = attachments[0]
    assert isinstance(first_attachment, dict)
    assert first_attachment["blobId"] == "blob-1"
    assert first_attachment["type"] == "text/plain"
    assert first_attachment["name"] == "hello.txt"
    assert first_attachment["size"] == "5"


def test_run_jmap_request_attachment_upload_failure_bubbles(
    tmp_path: Path, monkeypatch
) -> None:
    attachment_path = tmp_path / "hello.txt"
    attachment_path.write_text("hello", encoding="utf-8")

    def fail_upload(**_kwargs):
        raise ValueError("RFC 8620 binary upload failed (HTTP 500)")

    monkeypatch.setattr(JMAP_MODULE, "_post_binary_blob_upload", fail_upload)

    with pytest.raises(ValueError, match="RFC 8620 binary upload failed"):
        run_jmap_request(
            session=_FakeSession(),
            ops_json='[["Email/set",{"create":{"m1":{"attachments":[{"blobId":"$ATTACHMENT_0_BLOB_ID"}]}}},"c0"]]',
            attachments=[{"path": str(attachment_path)}],
        )


def test_run_jmap_request_rejects_attachment_over_max_size(
    tmp_path: Path,
) -> None:
    attachment_path = tmp_path / "huge.bin"
    attachment_path.write_bytes(b"12345")
    with pytest.raises(ValueError, match="maxSizeBlobSet"):
        run_jmap_request(
            session=_FakeSession(limits={"maxSizeBlobSet": 3, "maxDataSources": 32}),
            ops_json='[["Email/set",{"create":{"m1":{"attachments":[{"blobId":"$ATTACHMENT_0_BLOB_ID"}]}}},"c0"]]',
            attachments=[{"path": str(attachment_path), "contentType": "application/octet-stream"}],
        )


def test_run_jmap_request_rejects_blob_upload_max_data_sources(monkeypatch) -> None:
    monkeypatch.setattr(JMAP_MODULE, "_post_jmap", lambda *_args, **_kwargs: pytest.fail("should not post"))
    with pytest.raises(ValueError, match="maxDataSources"):
        run_jmap_request(
            session=_FakeSession(limits={"maxSizeBlobSet": 100, "maxDataSources": 1}),
            ops_json='{"using":["urn:ietf:params:jmap:core","urn:ietf:params:jmap:blob"],"methodCalls":[["Blob/upload",{"accountId":"acc-1","create":{"x":{"data":[{"data:asText":"a"},{"data:asText":"b"}]}}},"m0"]]}',
        )


def test_run_jmap_request_rejects_blob_upload_max_size(
    monkeypatch,
) -> None:
    monkeypatch.setattr(JMAP_MODULE, "_post_jmap", lambda *_args, **_kwargs: pytest.fail("should not post"))
    with pytest.raises(ValueError, match="maxSizeBlobSet"):
        run_jmap_request(
            session=_FakeSession(limits={"maxSizeBlobSet": 4, "maxDataSources": 64}),
            ops_json='{"using":["urn:ietf:params:jmap:core","urn:ietf:params:jmap:blob"],"methodCalls":[["Blob/upload",{"accountId":"acc-1","create":{"x":{"data":[{"data:asBase64":"SGVsbG8="}]}}},"m0"]]}',
        )


def test_run_jmap_request_adds_charset_for_text_blob_parts(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_post(_url: str, _token: str, envelope: dict[str, object]):
        captured["envelope"] = envelope
        return JmapRequestResult(ok=True, status=200, bodyText='{"ok":true}')

    monkeypatch.setattr(JMAP_MODULE, "_post_jmap", fake_post)
    run_jmap_request(
        session=_FakeSession(),
        ops_json='[["Email/set",{"create":{"m1":{"attachments":[{"blobId":"G1","type":"text/plain","name":"a.txt"}],"textBody":[{"partId":"body1","type":"text/plain"}],"htmlBody":[{"blobId":"G2","type":"text/html"}]}}},"m0"]]',
    )

    envelope = captured["envelope"]
    assert isinstance(envelope, dict)
    method_calls = envelope["methodCalls"]
    assert isinstance(method_calls, list)
    call0 = method_calls[0]
    assert isinstance(call0, list)
    arg = call0[1]
    assert isinstance(arg, dict)
    create = arg["create"]
    assert isinstance(create, dict)
    m1 = create["m1"]
    assert isinstance(m1, dict)
    atts = m1["attachments"]
    assert isinstance(atts, list)
    assert isinstance(atts[0], dict)
    assert atts[0]["charset"] == "utf-8"
    text_body = m1["textBody"]
    assert isinstance(text_body, list)
    assert isinstance(text_body[0], dict)
    assert "charset" not in text_body[0]
    html_body = m1["htmlBody"]
    assert isinstance(html_body, list)
    assert isinstance(html_body[0], dict)
    assert html_body[0]["charset"] == "utf-8"


def test_run_jmap_request_dry_run_rejects_attachments(tmp_path: Path) -> None:
    attachment_path = tmp_path / "hello.txt"
    attachment_path.write_text("hello", encoding="utf-8")
    with pytest.raises(ValueError, match="dryRun cannot be used with attachments"):
        run_jmap_request(
            session=_FakeSession(),
            ops_json='[["Mailbox/get",{}, "m0"]]',
            dry_run=True,
            attachments=[{"path": str(attachment_path)}],
        )


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
