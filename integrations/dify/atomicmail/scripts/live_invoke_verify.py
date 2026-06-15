from __future__ import annotations

import argparse
import json
import os
import random
import string
import sys
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any


def _bootstrap_vendor_runtime() -> Path:
    plugin_root = Path(__file__).resolve().parents[1]
    vendor_dir = plugin_root / "vendor"
    shared_dir = vendor_dir / "shared"
    site_packages = (
        plugin_root / ".venv312" / "lib" / "python3.12" / "site-packages"
    )

    for path in (plugin_root, vendor_dir, site_packages):
        if path.exists():
            path_str = str(path)
            if path_str not in sys.path:
                sys.path.insert(0, path_str)

    os.environ.setdefault("ATOMIC_MAIL_SHARED_DIR", str(shared_dir))
    return plugin_root


PLUGIN_ROOT = _bootstrap_vendor_runtime()

from dify_plugin import DifyPluginEnv
from dify_plugin.core.entities.plugin.request import ToolInvokeRequest
from dify_plugin.core.plugin_executor import PluginExecutor
from dify_plugin.core.plugin_registration import PluginRegistration


class InMemoryStorage:
    def __init__(self) -> None:
        self._data: dict[str, bytes] = {}

    def set(self, key: str, val: bytes) -> None:
        self._data[key] = val

    def get(self, key: str) -> bytes:
        return self._data[key]

    def delete(self, key: str) -> None:
        self._data.pop(key, None)

    def exist(self, key: str) -> bool:
        return key in self._data


@dataclass
class StepResult:
    name: str
    ok: bool
    detail: str


def _as_text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _tool_message_to_dict(msg: Any) -> dict[str, Any]:
    msg_type = _as_text(getattr(msg.type, "value", msg.type))
    payload = msg.message

    text_value = _as_text(getattr(payload, "text", None))
    json_value = getattr(payload, "json_object", None)

    return {
        "type": msg_type,
        "text": text_value,
        "json": json_value if isinstance(json_value, dict) else None,
    }


def _extract_body_text(payload: dict[str, Any] | None) -> str:
    if not isinstance(payload, dict):
        return ""
    body_text = payload.get("bodyText")
    if isinstance(body_text, str):
        return body_text
    return ""


def _first_json_message(messages: list[dict[str, Any]]) -> dict[str, Any] | None:
    for message in messages:
        payload = message.get("json")
        if isinstance(payload, dict):
            return payload
    return None


def _find_mail_id(value: object) -> str | None:
    if isinstance(value, dict):
        ids = value.get("ids")
        if isinstance(ids, list):
            for item in ids:
                if isinstance(item, str) and item.strip():
                    return item

        for key in ("emailId", "messageId", "id"):
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate.strip():
                return candidate

        for nested in value.values():
            found = _find_mail_id(nested)
            if found:
                return found
        return None

    if isinstance(value, list):
        for nested in value:
            found = _find_mail_id(nested)
            if found:
                return found
    return None


def _extract_mail_id_from_list_messages(messages: list[dict[str, Any]]) -> str | None:
    payload = _first_json_message(messages)
    body_text = _extract_body_text(payload)
    if not body_text:
        return None
    try:
        parsed = json.loads(body_text)
    except json.JSONDecodeError:
        return None
    return _find_mail_id(parsed)


def _invoke_tool(
    executor: PluginExecutor,
    session: Any,
    *,
    provider: str,
    tool: str,
    credentials: dict[str, Any],
    user_id: str,
    parameters: dict[str, Any],
) -> list[dict[str, Any]]:
    request = ToolInvokeRequest(
        provider=provider,
        tool=tool,
        credentials=credentials,
        user_id=user_id,
        tool_parameters=parameters,
    )
    messages = list(executor.invoke_tool(session, request))
    return [_tool_message_to_dict(msg) for msg in messages]


def _random_username() -> str:
    suffix = "".join(
        random.choices(string.ascii_lowercase + string.digits, k=6)
    )
    return f"difytest{suffix}"


def _register_with_retry(
    executor: PluginExecutor,
    session: Any,
    account_namespace: str,
    credentials: dict[str, Any],
    user_id: str,
) -> tuple[bool, str, dict[str, Any] | None]:
    for attempt in (1, 2):
        username = _random_username()
        messages = _invoke_tool(
            executor,
            session,
            provider="atomicmail",
            tool="register",
            credentials=credentials,
            user_id=user_id,
            parameters={
                "username": username,
                "account_id": account_namespace,
            },
        )

        first = messages[0] if messages else {}
        if first.get("type") == "json":
            payload = first.get("json") or {}
            inbox = payload.get("inbox")
            if isinstance(inbox, str) and inbox.strip():
                return (
                    True,
                    f"registered username={username} inbox={inbox}",
                    payload,
                )

        text = _as_text(first.get("text"))
        retryable = (
            "username" in text.lower()
            or "rate" in text.lower()
            or "limit" in text.lower()
        )
        if attempt == 1 and retryable:
            continue
        return False, text or "register failed without text response", None

    return False, "register failed after retry", None


def _network_enabled(skip_network: bool) -> bool:
    if skip_network:
        return False
    if os.environ.get("ATOMIC_MAIL_LIVE_E2E", "1").strip() == "0":
        return False
    return True


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Live PluginExecutor verification for Atomic Mail Dify integration."
        )
    )
    parser.add_argument(
        "--skip-network",
        action="store_true",
        help="Run vendored/offline checks only and skip register/JMAP network calls.",
    )
    return parser


def main() -> int:
    args = _parser().parse_args()
    network_enabled = _network_enabled(args.skip_network)
    previous_cwd = Path.cwd()
    os.chdir(PLUGIN_ROOT)
    try:
        config = DifyPluginEnv(MAX_REQUEST_TIMEOUT=120)
        registration = PluginRegistration(config)
        executor = PluginExecutor(config, registration)

        storage = InMemoryStorage()
        session = SimpleNamespace(
            session_id="live-verify-session",
            storage=storage,
        )
        credentials: dict[str, Any] = {}
        user_id = "live-verify-user"
        account_namespace = "phase6-e2e"

        results: list[StepResult] = []
        register_payload: dict[str, Any] | None = None

        help_messages = _invoke_tool(
            executor,
            session,
            provider="atomicmail",
            tool="help",
            credentials=credentials,
            user_id=user_id,
            parameters={"topic": "presets"},
        )
        help_text = _as_text(help_messages[0].get("text") if help_messages else "")
        help_ok = bool(help_text)
        results.append(
            StepResult(
                name="help(presets)",
                ok=help_ok,
                detail=(
                    f"received {len(help_text)} chars"
                    if help_ok
                    else "empty help output"
                ),
            )
        )

        if network_enabled:
            reg_ok, reg_detail, register_payload = _register_with_retry(
                executor=executor,
                session=session,
                account_namespace=account_namespace,
                credentials=credentials,
                user_id=user_id,
            )
            results.append(
                StepResult(
                    name="register(unique username)",
                    ok=reg_ok,
                    detail=reg_detail,
                )
            )

            list_before_messages = _invoke_tool(
                executor,
                session,
                provider="atomicmail",
                tool="list_inbox",
                credentials=credentials,
                user_id=user_id,
                parameters={"account_id": account_namespace},
            )
            list_before_first = list_before_messages[0] if list_before_messages else {}
            list_before_ok = list_before_first.get("type") == "json"
            results.append(
                StepResult(
                    name="list_inbox(before send)",
                    ok=list_before_ok,
                    detail=(
                        "received JSON response"
                        if list_before_ok
                        else _as_text(list_before_first.get("text")) or "non-JSON response"
                    ),
                )
            )

            registered_inbox = _as_text((register_payload or {}).get("inbox"))
            send_ok = False
            send_detail = "missing registered inbox from register result"
            if registered_inbox:
                send_messages = _invoke_tool(
                    executor,
                    session,
                    provider="atomicmail",
                    tool="send_mail",
                    credentials=credentials,
                    user_id=user_id,
                    parameters={
                        "to": registered_inbox,
                        "subject": "Atomic Mail Dify live E2E",
                        "body": "This is a live integration verification message.",
                        "account_id": account_namespace,
                    },
                )
                send_first = send_messages[0] if send_messages else {}
                send_ok = send_first.get("type") == "json"
                send_detail = (
                    "mail request accepted"
                    if send_ok
                    else _as_text(send_first.get("text")) or "non-JSON response"
                )
            results.append(
                StepResult(
                    name="send_mail(to registered inbox)",
                    ok=send_ok,
                    detail=send_detail,
                )
            )

            list_after_messages = _invoke_tool(
                executor,
                session,
                provider="atomicmail",
                tool="list_inbox",
                credentials=credentials,
                user_id=user_id,
                parameters={"account_id": account_namespace},
            )
            list_after_first = list_after_messages[0] if list_after_messages else {}
            list_after_ok = list_after_first.get("type") == "json"
            results.append(
                StepResult(
                    name="list_inbox(after send)",
                    ok=list_after_ok,
                    detail=(
                        "received JSON response"
                        if list_after_ok
                        else _as_text(list_after_first.get("text")) or "non-JSON response"
                    ),
                )
            )

            reply_ok = True
            reply_detail = "skipped: no mail id found in list_inbox payload"
            mail_id = _extract_mail_id_from_list_messages(list_after_messages)
            if mail_id:
                reply_messages = _invoke_tool(
                    executor,
                    session,
                    provider="atomicmail",
                    tool="reply",
                    credentials=credentials,
                    user_id=user_id,
                    parameters={
                        "mail_id": mail_id,
                        "body": "Reply from Atomic Mail Dify live verifier.",
                        "account_id": account_namespace,
                    },
                )
                reply_first = reply_messages[0] if reply_messages else {}
                reply_ok = reply_first.get("type") == "json"
                reply_detail = (
                    f"replied using mail_id={mail_id}"
                    if reply_ok
                    else _as_text(reply_first.get("text")) or "non-JSON response"
                )
            results.append(
                StepResult(name="reply(if message id present)", ok=reply_ok, detail=reply_detail)
            )
        else:
            results.append(
                StepResult(
                    name="network steps",
                    ok=True,
                    detail=(
                        "skipped by --skip-network or ATOMIC_MAIL_LIVE_E2E=0"
                    ),
                )
            )

        cron_messages = _invoke_tool(
            executor,
            session,
            provider="atomicmail",
            tool="help",
            credentials=credentials,
            user_id=user_id,
            parameters={"topic": "cron"},
        )
        cron_text = _as_text(cron_messages[0].get("text") if cron_messages else "")
        results.append(
            StepResult(
                name="help(cron)",
                ok=bool(cron_text),
                detail=(
                    f"received {len(cron_text)} chars"
                    if cron_text
                    else "empty cron help output"
                ),
            )
        )

        print("Atomic Mail Dify live invoke verification")
        print("=" * 44)
        print(
            f"Network mode: {'enabled' if network_enabled else 'offline-only (skipped)'}"
        )
        if register_payload:
            print(
                f"Registered inbox: {register_payload.get('inbox', '<unknown>')}"
            )
            print(
                "Registered accountId: "
                f"{register_payload.get('accountId', '<unknown>')}"
            )
        print(f"Storage namespace used: {account_namespace}")
        print()
        for result in results:
            mark = "PASS" if result.ok else "FAIL"
            print(f"[{mark}] {result.name}: {result.detail}")

        all_ok = all(result.ok for result in results)
        print()
        print(
            "OVERALL: PASS"
            if all_ok
            else "OVERALL: FAIL (see failed steps above)"
        )
        return 0 if all_ok else 1
    finally:
        os.chdir(previous_cwd)


if __name__ == "__main__":
    raise SystemExit(main())
