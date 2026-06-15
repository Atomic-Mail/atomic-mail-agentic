from __future__ import annotations

from collections.abc import Generator
from dataclasses import asdict
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from atomicmail.session import register

from tools.common import account_id_from_parameters
from utils.session_factory import runtime_env_from_dify, store_from_dify


class RegisterTool(Tool):
    def _invoke(
        self, tool_parameters: dict[str, Any]
    ) -> Generator[ToolInvokeMessage]:
        try:
            username = tool_parameters.get("username")
            if not isinstance(username, str) or not username.strip():
                yield self.create_text_message("register failed: username is required.")
                return

            forced = tool_parameters.get("forced", False)
            if not isinstance(forced, bool):
                yield self.create_text_message("register failed: forced must be a boolean.")
                return

            account_id = account_id_from_parameters(tool_parameters)
            result = register(
                username=username.strip(),
                forced=forced,
                env=runtime_env_from_dify(self),
                store=store_from_dify(self, account_id=account_id),
            )
            yield self.create_json_message(asdict(result))
        except Exception as err:
            yield self.create_text_message(f"register failed: {err}")
