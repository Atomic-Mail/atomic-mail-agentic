from __future__ import annotations

from collections.abc import Generator
from dataclasses import asdict
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from atomicmail.jmap_request import jmap_request

from tools.common import account_id_from_parameters
from utils.session_factory import runtime_env_from_dify, store_from_dify


class ListInboxTool(Tool):
    def _invoke(
        self, tool_parameters: dict[str, Any]
    ) -> Generator[ToolInvokeMessage]:
        try:
            account_id = account_id_from_parameters(tool_parameters)
            result = jmap_request(
                ops_file="list_inbox.json",
                env=runtime_env_from_dify(self),
                store=store_from_dify(self, account_id=account_id),
            )
            yield self.create_json_message(asdict(result))
        except Exception as err:
            yield self.create_text_message(f"list_inbox failed: {err}")
