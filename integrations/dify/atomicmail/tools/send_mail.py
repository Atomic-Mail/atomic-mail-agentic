from __future__ import annotations

from collections.abc import Generator
from dataclasses import asdict
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from atomicmail.jmap_request import jmap_request

from tools.common import account_id_from_parameters
from utils.attachment_bridge import attachments_from_dify_files
from utils.session_factory import runtime_env_from_dify, store_from_dify


def _required_string(tool_parameters: dict[str, Any], key: str) -> str:
    value = tool_parameters.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{key} is required.")
    return value.strip()


class SendMailTool(Tool):
    def _invoke(
        self, tool_parameters: dict[str, Any]
    ) -> Generator[ToolInvokeMessage]:
        temp_attachments = None
        try:
            to = _required_string(tool_parameters, "to")
            subject = _required_string(tool_parameters, "subject")
            body = _required_string(tool_parameters, "body")
            account_id = account_id_from_parameters(tool_parameters)

            temp_attachments = attachments_from_dify_files(
                tool_parameters.get("attachments")
            )

            request_kwargs: dict[str, Any] = {
                "vars": {"TO": to, "SUBJECT": subject, "BODY": body},
                "env": runtime_env_from_dify(self),
                "store": store_from_dify(self, account_id=account_id),
            }
            if temp_attachments.attachments:
                request_kwargs["ops_file"] = "send_mail_blob_attachment.json"
                request_kwargs["attachments"] = temp_attachments.attachments
            else:
                request_kwargs["ops_file"] = "send_mail.json"

            result = jmap_request(**request_kwargs)
            yield self.create_json_message(asdict(result))
        except Exception as err:
            yield self.create_text_message(f"send_mail failed: {err}")
        finally:
            if temp_attachments is not None:
                temp_attachments.cleanup()
