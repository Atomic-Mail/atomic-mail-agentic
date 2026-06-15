from __future__ import annotations

from collections.abc import Generator
from dataclasses import asdict
import json
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from atomicmail.jmap_request import jmap_request

from tools.common import account_id_from_parameters
from utils.session_factory import runtime_env_from_dify, store_from_dify


def _validate_vars(raw: object) -> dict[str, str] | None:
    if raw is None:
        return None
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError as err:
            raise ValueError(f"vars must be valid JSON object text: {err}") from err
    if not isinstance(raw, dict):
        raise ValueError("vars must be an object of string values.")
    out: dict[str, str] = {}
    for key, value in raw.items():
        if not isinstance(key, str) or not isinstance(value, str):
            raise ValueError("vars must be an object of string values.")
        out[key] = value
    return out


class JmapRequestTool(Tool):
    def _invoke(
        self, tool_parameters: dict[str, Any]
    ) -> Generator[ToolInvokeMessage]:
        try:
            ops = tool_parameters.get("ops")
            ops_file = tool_parameters.get("ops_file")
            if bool(ops) == bool(ops_file):
                yield self.create_text_message(
                    "jmap_request failed: provide exactly one of ops or ops_file."
                )
                return

            if ops is not None and not isinstance(ops, str):
                yield self.create_text_message("jmap_request failed: ops must be a string.")
                return
            if ops_file is not None and not isinstance(ops_file, str):
                yield self.create_text_message(
                    "jmap_request failed: ops_file must be a string."
                )
                return

            dry_run = tool_parameters.get("dry_run", False)
            if not isinstance(dry_run, bool):
                yield self.create_text_message(
                    "jmap_request failed: dry_run must be a boolean."
                )
                return

            account_id = account_id_from_parameters(tool_parameters)
            result = jmap_request(
                ops=ops if isinstance(ops, str) else None,
                ops_file=ops_file if isinstance(ops_file, str) else None,
                vars=_validate_vars(tool_parameters.get("vars")),
                dry_run=dry_run,
                env=runtime_env_from_dify(self),
                store=store_from_dify(self, account_id=account_id),
            )
            yield self.create_json_message(asdict(result))
        except Exception as err:
            yield self.create_text_message(f"jmap_request failed: {err}")
