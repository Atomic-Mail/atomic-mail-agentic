from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

from dify_plugin.entities.tool import ToolRuntime

from atomicmail.jmap_request import JmapRequestResult
from atomicmail.session import RegisterResult
from conftest import FakeStorage
from tools.help import HelpTool
from tools.jmap_request import JmapRequestTool
from tools.list_inbox import ListInboxTool
from tools.register import RegisterTool
from tools.reply import ReplyTool
from tools.send_mail import SendMailTool
from utils.dify_kv_store import DifyKvCredentialStore


def _tool(tool_cls: Any) -> Any:
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
    return tool_cls(runtime=runtime, session=session)


def _first_message(tool: Any, params: dict[str, Any]) -> Any:
    return next(tool._invoke(params))


def test_register_validates_and_calls_sdk_with_store() -> None:
    tool = _tool(RegisterTool)
    with patch("tools.register.register") as mock_register:
        mock_register.return_value = RegisterResult(
            inbox="alex@atomicmail.ai",
            accountId="acc1",
            apiKey="k",
            idempotent=True,
        )
        msg = _first_message(tool, {"username": "alex", "account_id": "acct-main"})

    assert msg.type.value == "json"
    payload = msg.message.json_object
    assert payload["inbox"] == "alex@atomicmail.ai"
    call = mock_register.call_args
    assert call.kwargs["username"] == "alex"
    assert isinstance(call.kwargs["store"], DifyKvCredentialStore)
    assert call.kwargs["store"].account_id == "acct-main"


def test_list_inbox_calls_preset_ops_file() -> None:
    tool = _tool(ListInboxTool)
    with patch("tools.list_inbox.jmap_request") as mock_jmap:
        mock_jmap.return_value = JmapRequestResult(ok=True, status=200, bodyText="{}")
        msg = _first_message(tool, {"account_id": "a1"})

    assert msg.type.value == "json"
    call = mock_jmap.call_args
    assert call.kwargs["ops_file"] == "list_inbox.json"
    assert isinstance(call.kwargs["store"], DifyKvCredentialStore)
    assert call.kwargs["store"].account_id == "a1"


def test_send_mail_maps_vars_without_attachments() -> None:
    tool = _tool(SendMailTool)
    with patch("tools.send_mail.jmap_request") as mock_jmap:
        mock_jmap.return_value = JmapRequestResult(ok=True, status=200, bodyText="ok")
        msg = _first_message(
            tool,
            {
                "to": "a@example.com",
                "subject": "Subj",
                "body": "Body",
                "account_id": "main",
            },
        )

    assert msg.type.value == "json"
    call = mock_jmap.call_args
    assert call.kwargs["ops_file"] == "send_mail.json"
    assert call.kwargs["vars"] == {"TO": "a@example.com", "SUBJECT": "Subj", "BODY": "Body"}
    assert "attachments" not in call.kwargs
    assert isinstance(call.kwargs["store"], DifyKvCredentialStore)


def test_send_mail_maps_vars_with_attachments() -> None:
    tool = _tool(SendMailTool)
    seen_path: Path | None = None

    def _fake_jmap_request(**kwargs: Any) -> JmapRequestResult:
        nonlocal seen_path
        attachments = kwargs.get("attachments")
        assert kwargs["ops_file"] == "send_mail_blob_attachment.json"
        assert isinstance(attachments, list)
        assert len(attachments) == 1
        path = Path(attachments[0]["path"])
        seen_path = path
        assert path.exists()
        assert path.read_bytes() == b"pdf-bytes"
        return JmapRequestResult(ok=True, status=200, bodyText="ok")

    with patch("tools.send_mail.jmap_request", side_effect=_fake_jmap_request):
        file_like = SimpleNamespace(
            blob=b"pdf-bytes",
            filename="doc.pdf",
            mime_type="application/pdf",
            extension="pdf",
        )
        msg = _first_message(
            tool,
            {
                "to": "a@example.com",
                "subject": "Subj",
                "body": "Body",
                "attachments": [file_like],
            },
        )

    assert msg.type.value == "json"
    assert seen_path is not None
    assert not seen_path.exists()


def test_reply_maps_mail_id_and_body() -> None:
    tool = _tool(ReplyTool)
    with patch("tools.reply.jmap_request") as mock_jmap:
        mock_jmap.return_value = JmapRequestResult(ok=True, status=200, bodyText="ok")
        msg = _first_message(
            tool,
            {"mail_id": "email-id-123", "body": "reply text", "account_id": "acc-x"},
        )

    assert msg.type.value == "json"
    call = mock_jmap.call_args
    assert call.kwargs["ops_file"] == "reply.json"
    assert call.kwargs["vars"] == {"MAIL_ID": "email-id-123", "BODY": "reply text"}
    assert isinstance(call.kwargs["store"], DifyKvCredentialStore)
    assert call.kwargs["store"].account_id == "acc-x"


def test_jmap_request_rejects_ops_and_ops_file_together() -> None:
    tool = _tool(JmapRequestTool)
    msg = _first_message(tool, {"ops": "[]", "ops_file": "list_inbox.json"})
    assert msg.type.value == "text"
    assert "provide exactly one of ops or ops_file" in msg.message.text


def test_jmap_request_rejects_non_string_ops() -> None:
    tool = _tool(JmapRequestTool)
    msg = _first_message(tool, {"ops": ["bad"]})
    assert msg.type.value == "text"
    assert "ops must be a string" in msg.message.text


def test_jmap_request_rejects_non_string_ops_file() -> None:
    tool = _tool(JmapRequestTool)
    msg = _first_message(tool, {"ops_file": 123})
    assert msg.type.value == "text"
    assert "ops_file must be a string" in msg.message.text


def test_jmap_request_rejects_non_boolean_dry_run() -> None:
    tool = _tool(JmapRequestTool)
    msg = _first_message(tool, {"ops": "[]", "dry_run": "true"})
    assert msg.type.value == "text"
    assert "dry_run must be a boolean" in msg.message.text


def test_jmap_request_rejects_invalid_vars_json_text() -> None:
    tool = _tool(JmapRequestTool)
    msg = _first_message(tool, {"ops": "[]", "vars": "{not-json"})
    assert msg.type.value == "text"
    assert "vars must be valid JSON object text" in msg.message.text


def test_error_paths_yield_text_messages() -> None:
    register_tool = _tool(RegisterTool)
    with patch("tools.register.register", side_effect=RuntimeError("boom")):
        msg = _first_message(register_tool, {"username": "alex"})
    assert msg.type.value == "text"
    assert "register failed: boom" in msg.message.text

    help_tool = _tool(HelpTool)
    msg2 = _first_message(help_tool, {"topic": 123})
    assert msg2.type.value == "text"
    assert "help failed: topic must be a string." == msg2.message.text
