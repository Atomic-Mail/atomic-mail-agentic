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

    monkeypatch.setattr(JMAP_MODULE, "create_agent_session", lambda *_args, **_kwargs: _FakeSession())

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
    monkeypatch.setattr(JMAP_MODULE, "create_agent_session", lambda *_args, **_kwargs: _FakeSession())

    with pytest.raises(ValueError, match="not among bundled presets"):
        jmap_request(ops_file="does_not_exist.json", credentials_dir=str(tmp_path))


def test_jmap_request_uses_store_session_factory(monkeypatch) -> None:
    captured: dict[str, object] = {}
    sentinel_store = object()
    fake_session = _FakeSession()

    def _fake_factory(**kwargs):
        captured.update(kwargs)
        return fake_session

    def _fake_run(**kwargs):
        captured["session"] = kwargs.get("session")
        return JmapRequestResult(ok=True, status=200, bodyText="{}")

    monkeypatch.setattr(JMAP_MODULE, "create_agent_session", _fake_factory)
    monkeypatch.setattr(JMAP_MODULE, "run_jmap_request", _fake_run)
    out = jmap_request(ops='[["Mailbox/get", {}, "m0"]]', store=sentinel_store)

    assert out.ok is True
    assert captured["store"] is sentinel_store
    assert captured["session"] is fake_session


def _mailbox_query_post(ids_by_role: dict[str, list[str]], captured: list[dict[str, object]]):
    def fake_post(_url: str, _token: str, envelope: dict[str, object]):
        captured.append(envelope)
        call = envelope["methodCalls"][0]  # type: ignore[index]
        if call[0] == "Mailbox/query":
            role = call[1]["filter"]["role"]
            body = {"methodResponses": [["Mailbox/query", {"ids": ids_by_role.get(role, [])}, "mq0"]]}
            return JmapRequestResult(ok=True, status=200, bodyText=json.dumps(body))
        return JmapRequestResult(ok=True, status=200, bodyText='{"ok":true}')

    return fake_post


def test_run_jmap_request_resolves_sent_mailbox_id(monkeypatch) -> None:
    captured: list[dict[str, object]] = []
    monkeypatch.setattr(
        JMAP_MODULE,
        "_post_jmap",
        _mailbox_query_post({"inbox": ["mb-inbox"], "sent": ["mb-sent"]}, captured),
    )
    run_jmap_request(session=_FakeSession(), ops_json='[["Email/query",{"filter":{"inMailbox":"$SENT_MAILBOX_ID"}},"q0"]]')
    assert captured[-1]["methodCalls"][0][1]["filter"]["inMailbox"] == "mb-sent"  # type: ignore[index]


def test_run_jmap_request_sent_mailbox_falls_back_to_inbox(monkeypatch) -> None:
    captured: list[dict[str, object]] = []
    monkeypatch.setattr(JMAP_MODULE, "_post_jmap", _mailbox_query_post({"inbox": ["mb-inbox"]}, captured))
    run_jmap_request(session=_FakeSession(), ops_json='[["Email/query",{"filter":{"inMailbox":"$SENT_MAILBOX_ID"}},"q0"]]')
    assert captured[-1]["methodCalls"][0][1]["filter"]["inMailbox"] == "mb-inbox"  # type: ignore[index]


@pytest.mark.parametrize(
    "preset",
    ["send_mail.json", "send_mail_attachment.json", "send_mail_blob_attachment.json", "reply.json"],
)
def test_send_presets_file_in_sent_and_clear_draft(preset: str) -> None:
    from atomicmail.shared_assets import shared_dir

    envelope = json.loads((shared_dir() / "presets" / preset).read_text(encoding="utf-8"))
    calls = {name: args for name, args, _ in envelope["methodCalls"]}
    (email,) = calls["Email/set"]["create"].values()
    assert email["mailboxIds"] == {"$SENT_MAILBOX_ID": True}
    submission = calls["EmailSubmission/set"]
    (sub_id,) = submission["create"].keys()
    assert submission["onSuccessUpdateEmail"] == {
        f"#{sub_id}": {"keywords/$draft": None, "keywords/$sent": True}
    }


def test_reply_preset_resolves_original_with_one_email_get(monkeypatch) -> None:
    from atomicmail.shared_assets import shared_dir

    posted: list[dict[str, object]] = []

    def fake_post(_url: str, _token: str, envelope: dict[str, object]):
        posted.append(envelope)
        call = envelope["methodCalls"][0]  # type: ignore[index]
        if call[0] == "Email/get":
            original = {
                "from": [{"name": None, "email": "alice@example.com"}],
                "replyTo": None,
                "subject": "Invoice 42",
                "messageId": ["abc@example.com"],
            }
            body = {"methodResponses": [["Email/get", {"list": [original]}, "rg0"]]}
            return JmapRequestResult(ok=True, status=200, bodyText=json.dumps(body))
        return JmapRequestResult(ok=True, status=200, bodyText='{"ok":true}')

    monkeypatch.setattr(JMAP_MODULE, "_post_jmap", fake_post)
    raw = (shared_dir() / "presets" / "reply.json").read_text(encoding="utf-8")
    run_jmap_request(
        session=_FakeSession(),
        ops_json=raw,
        vars={"SENT_MAILBOX_ID": "mb-sent", "MAIL_ID": "M1", "BODY": "Thanks"},
    )
    lookups = [e for e in posted if e["methodCalls"][0][0] == "Email/get"]  # type: ignore[index]
    assert len(lookups) == 1
    sent = posted[-1]
    draft = sent["methodCalls"][0][1]["create"]["d1"]  # type: ignore[index]
    assert draft["to"] == [{"email": "alice@example.com"}]
    assert draft["subject"] == "Re: Invoice 42"
    assert draft["inReplyTo"] == ["abc@example.com"]
    assert not any(key.startswith("#") for key in draft)
    rcpt = sent["methodCalls"][1][1]["create"]["s1"]["envelope"]["rcptTo"]  # type: ignore[index]
    assert rcpt == [{"email": "alice@example.com"}]


def test_reply_preset_requires_mail_id() -> None:
    from atomicmail.shared_assets import shared_dir

    raw = (shared_dir() / "presets" / "reply.json").read_text(encoding="utf-8")
    with pytest.raises(ValueError, match="need MAIL_ID"):
        run_jmap_request(session=_FakeSession(), ops_json=raw, vars={"SENT_MAILBOX_ID": "x", "BODY": "b"})


def _reply_post(original: dict[str, object] | None, posted: list[dict[str, object]], *, error: dict | None = None):
    def fake_post(_url: str, _token: str, envelope: dict[str, object]):
        posted.append(envelope)
        call = envelope["methodCalls"][0]  # type: ignore[index]
        if call[0] == "Email/get":
            if error is not None:
                body = {"methodResponses": [["error", error, "rg0"]]}
            else:
                body = {"methodResponses": [["Email/get", {"list": [original] if original else []}, "rg0"]]}
            return JmapRequestResult(ok=True, status=200, bodyText=json.dumps(body))
        return JmapRequestResult(ok=True, status=200, bodyText='{"ok":true}')

    return fake_post


_ORIGINAL = {
    "from": [{"name": None, "email": "alice@example.com"}],
    "replyTo": None,
    "subject": "Invoice 42",
    "messageId": ["abc@example.com"],
}


def _run_reply(monkeypatch, original=None, *, error=None, body: str = "Thanks"):
    from atomicmail.shared_assets import shared_dir

    posted: list[dict[str, object]] = []
    monkeypatch.setattr(JMAP_MODULE, "_post_jmap", _reply_post(original, posted, error=error))
    raw = (shared_dir() / "presets" / "reply.json").read_text(encoding="utf-8")
    run_jmap_request(
        session=_FakeSession(),
        ops_json=raw,
        vars={"SENT_MAILBOX_ID": "mb-sent", "MAIL_ID": "M1", "BODY": body},
    )
    return posted


def test_hostile_reply_subject_cannot_inject_method_calls(monkeypatch) -> None:
    hostile = (
        'x"}}}, "c0"], ["Email/query", {"accountId": "$ACCOUNT_ID"}, "q9"], '
        '["Email/set", {"accountId": "a", "create": {"d1": {"subject": "y'
    )
    posted = _run_reply(monkeypatch, {**_ORIGINAL, "subject": hostile})
    sent = posted[-1]
    names = [call[0] for call in sent["methodCalls"]]  # type: ignore[index]
    assert names == ["Email/set", "EmailSubmission/set"]
    draft = sent["methodCalls"][0][1]["create"]["d1"]  # type: ignore[index]
    assert draft["subject"] == f"Re: {hostile}"


def test_substitution_round_trips_special_characters(monkeypatch) -> None:
    body = 'line1\nline2 "quoted" back\\slash\ttab café 日本 \U0001f600'
    posted = _run_reply(monkeypatch, _ORIGINAL, body=body)
    draft = posted[-1]["methodCalls"][0][1]["create"]["d1"]  # type: ignore[index]
    assert draft["bodyValues"]["b"]["value"] == body


def test_bare_token_substitutes_verbatim(monkeypatch) -> None:
    captured: list[dict[str, object]] = []
    monkeypatch.setattr(JMAP_MODULE, "_post_jmap", _mailbox_query_post({}, captured))
    run_jmap_request(
        session=_FakeSession(),
        ops_json='[["Email/query",{"accountId":"$ACCOUNT_ID","limit": $LIMIT},"q0"]]',
        vars={"LIMIT": "5"},
    )
    assert captured[-1]["methodCalls"][0][1] == {"accountId": "acc-1", "limit": 5}  # type: ignore[index]


def test_dollar_in_value_is_not_re_expanded(monkeypatch) -> None:
    captured: list[dict[str, object]] = []
    monkeypatch.setattr(JMAP_MODULE, "_post_jmap", _mailbox_query_post({}, captured))
    run_jmap_request(
        session=_FakeSession(),
        ops_json='[["Email/set",{"subject":"$SUBJECT","note":"\\"$SUBJECT\\""},"s0"]]',
        vars={"SUBJECT": "costs $ACCOUNT_ID and $TO"},
    )
    args = captured[-1]["methodCalls"][0][1]  # type: ignore[index]
    assert args["subject"] == "costs $ACCOUNT_ID and $TO"
    assert args["note"] == '"costs $ACCOUNT_ID and $TO"'


@pytest.mark.parametrize(
    ("subject", "expected"),
    [
        ("Invoice 42", "Re: Invoice 42"),
        ("RE: Invoice 42", "RE: Invoice 42"),
        ("  re : Invoice 42", "re : Invoice 42"),
        ("Invoice\r\n\r\n 42\n", "Re: Invoice  42"),
        ("Line one\nLine two", "Re: Line one Line two"),
        ("Regarding lunch", "Re: Regarding lunch"),
        ("", "Re:"),
        (None, "Re:"),
        # JavaScript whitespace set, not Python's: U+FEFF trims, U+0085/U+001F do not.
        ("\ufeffRe: hi", "Re: hi"),
        ("\u0085Re: hi", "Re: \u0085Re: hi"),
        ("hi\u001f", "Re: hi\u001f"),
    ],
)
def test_reply_subject_matches_hosted_server_rule(subject: object, expected: str) -> None:
    assert JMAP_MODULE._reply_subject(subject) == expected


def test_first_email_uses_javascript_whitespace_rule() -> None:
    addresses = [{"email": "\ufeff"}, {"email": " \u0085b@example.com "}]
    assert JMAP_MODULE._first_email(addresses) == "\u0085b@example.com"


@pytest.mark.parametrize("value", [5, True, 3.5, None])
def test_non_string_var_value_is_rejected(value: object) -> None:
    with pytest.raises(ValueError, match="must be a string"):
        JMAP_MODULE._substitute_vars('{"a": "$N", "b": $N}', {"N": value}, {})


def test_reply_skips_unusable_addresses_and_trims(monkeypatch) -> None:
    original = {**_ORIGINAL, "replyTo": [{"email": "  "}, {"email": None}, {"email": " b@example.com "}]}
    posted = _run_reply(monkeypatch, original)
    assert posted[-1]["methodCalls"][0][1]["create"]["d1"]["to"] == [{"email": "b@example.com"}]  # type: ignore[index]


def test_reply_scans_all_of_from_before_sender(monkeypatch) -> None:
    original = {
        **_ORIGINAL,
        "replyTo": [{"email": ""}],
        "from": [{"email": " "}, {"email": "second@example.com"}],
        "sender": [{"email": "sender@example.com"}],
    }
    posted = _run_reply(monkeypatch, original)
    assert posted[-1]["methodCalls"][0][1]["create"]["d1"]["to"] == [{"email": "second@example.com"}]  # type: ignore[index]


def test_reply_falls_back_to_sender_and_requests_it(monkeypatch) -> None:
    original = {**_ORIGINAL, "from": [{"email": ""}], "sender": [{"email": "list@example.com"}]}
    posted = _run_reply(monkeypatch, original)
    assert "sender" in posted[0]["methodCalls"][0][1]["properties"]  # type: ignore[index]
    assert posted[-1]["methodCalls"][0][1]["create"]["d1"]["to"] == [{"email": "list@example.com"}]  # type: ignore[index]


def test_reply_reports_jmap_error_response(monkeypatch) -> None:
    with pytest.raises(ValueError) as err:
        _run_reply(monkeypatch, error={"type": "accountNotFound"})
    assert str(err.value) == 'Email/get for reply failed: {"type":"accountNotFound"}'


def test_reply_without_message_id_points_to_send_mail(monkeypatch) -> None:
    with pytest.raises(ValueError, match="; use send_mail.json with TO/SUBJECT instead."):
        _run_reply(monkeypatch, {**_ORIGINAL, "messageId": None})
