from __future__ import annotations

from typing import Any


def account_id_from_parameters(tool_parameters: dict[str, Any]) -> str:
    account_id = tool_parameters.get("account_id")
    if isinstance(account_id, str) and account_id.strip():
        return account_id.strip()
    return "default"
