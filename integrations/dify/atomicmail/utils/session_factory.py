from __future__ import annotations

from typing import Any

from dify_plugin import Tool

from atomicmail.session import AgentSession, create_agent_session

from .dify_kv_store import DifyKvCredentialStore


def _as_string(mapping: dict[str, Any], key: str) -> str | None:
    value = mapping.get(key)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def runtime_credentials_from_dify(tool: Tool) -> dict[str, Any]:
    runtime = getattr(tool, "runtime", None)
    runtime_credentials = getattr(runtime, "credentials", None)
    return (
        runtime_credentials
        if isinstance(runtime_credentials, dict)
        else {}
    )


def runtime_env_from_dify(tool: Tool) -> dict[str, str]:
    credentials = runtime_credentials_from_dify(tool)
    env: dict[str, str] = {}
    auth_url = _as_string(credentials, "auth_url")
    api_url = _as_string(credentials, "api_url")
    if auth_url:
        env["ATOMIC_MAIL_AUTH_URL"] = auth_url
    if api_url:
        env["ATOMIC_MAIL_API_URL"] = api_url
    return env


def runtime_api_key_from_dify(tool: Tool) -> str | None:
    return _as_string(runtime_credentials_from_dify(tool), "api_key")


def store_from_dify(tool: Tool, account_id: str = "default") -> DifyKvCredentialStore:
    return DifyKvCredentialStore(
        storage=tool.session.storage,
        account_id=account_id,
    )


def create_session_from_dify(tool: Tool, account_id: str = "default") -> AgentSession:
    env = runtime_env_from_dify(tool)
    api_key = runtime_api_key_from_dify(tool)
    store = store_from_dify(tool, account_id=account_id)
    return create_agent_session(
        store=store,
        env=env or None,
        provider_api_key=api_key,
    )
