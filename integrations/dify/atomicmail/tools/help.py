from __future__ import annotations

from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from atomicmail.help import help as get_help


class HelpTool(Tool):
    def _invoke(
        self, tool_parameters: dict[str, Any]
    ) -> Generator[ToolInvokeMessage]:
        try:
            topic = tool_parameters.get("topic")
            if topic is not None and not isinstance(topic, str):
                yield self.create_text_message("help failed: topic must be a string.")
                return
            yield self.create_text_message(get_help(topic if isinstance(topic, str) else None))
        except Exception as err:
            yield self.create_text_message(f"help failed: {err}")
