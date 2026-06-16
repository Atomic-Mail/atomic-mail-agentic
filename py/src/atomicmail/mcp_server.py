"""Minimal MCP stdio adapter exposing Atomic Mail tools."""

from __future__ import annotations

import json
import sys
from dataclasses import asdict
from typing import Any, Mapping

from .help import HELP_TOPIC_LIST, help as get_help
from .jmap_request import (
    DEFAULT_JMAP_USING,
    USER_VAR_KEY_RE,
    JmapAttachmentInput,
    jmap_request,
)
from .session import register

_SERVER_NAME = "atomicmail"
_SERVER_VERSION = "0.1.0"
_INSTRUCTIONS = (
    "Atomic Mail MCP — programmable inbox for AI agents.\n\n"
    "Use register first, then jmap_request for mailbox operations. "
    "Use help early and often (presets, cron, jmap_cheatsheet, troubleshooting). "
    "After register, arrange hourly inbox polling per help topic cron: native "
    "scheduler if available; otherwise ask operator or remind manual fetch. "
    "Do not cron jmap_request alone."
)


def _jsonrpc_ok(id_value: Any, result: Mapping[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": id_value, "result": result}


def _jsonrpc_error(id_value: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": id_value, "error": {"code": code, "message": message}}


def _tool_success(text: str) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": text}]}


def _tool_error(text: str) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": text}], "isError": True}


def _optional_bool_argument(
    args: Mapping[str, Any], key: str
) -> tuple[bool | None, str | None]:
    value = args.get(key)
    if value is None:
        return None, None
    if isinstance(value, bool):
        return value, None
    return None, f"{key} must be a boolean."


def _tool_specs() -> list[dict[str, Any]]:
    return [
        {
            "name": "register",
            "title": "Register an Atomic Mail inbox",
            "description": (
                "PoW signup; writes credentials. Usernames are 5–21 characters. "
                "Idempotent for the same username and stored inbox; a different username "
                "is rejected unless forced=true is provided. After success, arrange "
                "hourly inbox polling per help topic cron."
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "username": {"type": "string", "minLength": 5, "maxLength": 21},
                    "credentials_dir": {"type": "string"},
                    "forced": {"type": "boolean"},
                },
                "additionalProperties": False,
            },
        },
        {
            "name": "jmap_request",
            "title": "Send a JMAP request",
            "description": (
                "JMAP method-call batch with automatic auth. Exactly one of ops/ops_file. "
                "Supports vars placeholders and optional local file attachments."
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "credentials_dir": {"type": "string"},
                    "using": {"type": "array", "items": {"type": "string"}},
                    "ops": {"type": "string"},
                    "ops_file": {"type": "string"},
                    "vars": {
                        "type": "object",
                        "propertyNames": {"pattern": r"^[A-Z][A-Z0-9_]*$"},
                        "additionalProperties": {"type": "string"},
                    },
                    "dry_run": {"type": "boolean"},
                    "attachments": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "path": {"type": "string"},
                                "filename": {"type": "string"},
                                "content_type": {"type": "string"},
                            },
                            "required": ["path"],
                            "additionalProperties": False,
                        },
                    },
                },
                "additionalProperties": False,
            },
        },
        {
            "name": "help",
            "title": "Atomic Mail documentation",
            "description": (
                "Built-in docs. Topics: " + ", ".join(HELP_TOPIC_LIST) + ", readme."
            ),
            "inputSchema": {
                "type": "object",
                "properties": {"topic": {"type": "string"}},
                "additionalProperties": False,
            },
        },
    ]


def _coerce_attachments(raw: object) -> list[JmapAttachmentInput] | None:
    if raw is None:
        return None
    if not isinstance(raw, list):
        raise ValueError("attachments must be an array")
    out: list[JmapAttachmentInput] = []
    for idx, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ValueError(f"attachments[{idx}] must be an object")
        path = item.get("path")
        if not isinstance(path, str) or not path:
            raise ValueError(f"attachments[{idx}].path must be a non-empty string")
        filename = item.get("filename")
        content_type = item.get("content_type")
        if filename is not None and not isinstance(filename, str):
            raise ValueError(f"attachments[{idx}].filename must be a string")
        if content_type is not None and not isinstance(content_type, str):
            raise ValueError(f"attachments[{idx}].content_type must be a string")
        out.append(JmapAttachmentInput(path=path, filename=filename, contentType=content_type))
    return out


def handle_tool_call(name: str, arguments: Mapping[str, Any] | None) -> dict[str, Any]:
    args = dict(arguments or {})
    if name == "register":
        try:
            username = args.get("username")
            forced, forced_error = _optional_bool_argument(args, "forced")

            if username is not None and not isinstance(username, str):
                return _tool_error("Registration failed: username must be a string.")
            if not isinstance(username, str) or not username.strip():
                return _tool_error("Registration failed: username must be a non-empty string.")
            if forced_error is not None:
                return _tool_error(f"Registration failed: {forced_error}")
            credentials_dir = args.get("credentials_dir")
            result = register(
                username=username,
                credentials_dir=credentials_dir if isinstance(credentials_dir, str) else None,
                forced=forced if forced is not None else False,
            )
            return _tool_success(json.dumps(asdict(result), indent=2))
        except Exception as err:
            return _tool_error(f"Registration failed: {err}")

    if name == "jmap_request":
        try:
            ops = args.get("ops")
            ops_file = args.get("ops_file")
            if isinstance(ops, str) and isinstance(ops_file, str):
                return _tool_error("ops and ops_file are mutually exclusive — provide one.")
            if not isinstance(ops, str) and not isinstance(ops_file, str):
                return _tool_error("Provide either ops or ops_file.")

            credentials_dir = args.get("credentials_dir")
            using = args.get("using")
            vars_in = args.get("vars")
            dry_run, dry_run_error = _optional_bool_argument(args, "dry_run")
            attachments = _coerce_attachments(args.get("attachments"))
            if dry_run_error is not None:
                return _tool_error(dry_run_error)
            if vars_in is not None:
                if not isinstance(vars_in, dict) or not all(
                    isinstance(k, str) and isinstance(v, str) for k, v in vars_in.items()
                ):
                    return _tool_error("vars must be an object of string values.")
                invalid_key = next(
                    (key for key in vars_in if USER_VAR_KEY_RE.fullmatch(key) is None),
                    None,
                )
                if invalid_key is not None:
                    return _tool_error(
                        f"vars key '{invalid_key}' must match /^[A-Z][A-Z0-9_]*$/."
                    )
            if using is not None:
                if not isinstance(using, list) or not all(isinstance(item, str) for item in using):
                    return _tool_error("using must be an array of strings.")
                normalized_using = list(using)
            else:
                normalized_using = list(DEFAULT_JMAP_USING)

            result = jmap_request(
                ops=ops if isinstance(ops, str) else None,
                ops_file=ops_file if isinstance(ops_file, str) else None,
                vars=vars_in if isinstance(vars_in, dict) else None,
                dry_run=dry_run if dry_run is not None else False,
                attachments=attachments,
                using=normalized_using,
                credentials_dir=credentials_dir if isinstance(credentials_dir, str) else None,
            )
            if not result.ok:
                return _tool_error(f"JMAP request failed (HTTP {result.status}): {result.bodyText}")
            return _tool_success(result.bodyText)
        except Exception as err:
            return _tool_error(f"JMAP request error: {err}")

    if name == "help":
        try:
            topic = args.get("topic")
            if topic is not None and not isinstance(topic, str):
                return _tool_error("help topic must be a string.")
            return _tool_success(get_help(topic if isinstance(topic, str) else None))
        except Exception as err:
            return _tool_error(str(err))

    return _tool_error(f"Unknown tool: {name}")


class _ContentLengthStdio:
    def __init__(self, stdin: Any, stdout: Any) -> None:
        self._stdin = stdin
        self._stdout = stdout

    def read_message(self) -> dict[str, Any] | None:
        headers: dict[str, str] = {}
        while True:
            line = self._stdin.readline()
            if line == b"":
                return None
            if line in (b"\r\n", b"\n"):
                break
            decoded = line.decode("utf-8", errors="replace").strip()
            if ":" not in decoded:
                continue
            key, value = decoded.split(":", 1)
            headers[key.lower().strip()] = value.strip()
        length_raw = headers.get("content-length")
        if length_raw is None:
            return None
        length = int(length_raw)
        body = self._stdin.read(length)
        if not body:
            return None
        payload = json.loads(body.decode("utf-8"))
        if isinstance(payload, dict):
            return payload
        return None

    def write_message(self, message: Mapping[str, Any]) -> None:
        data = json.dumps(message).encode("utf-8")
        header = f"Content-Length: {len(data)}\r\n\r\n".encode("ascii")
        self._stdout.write(header)
        self._stdout.write(data)
        self._stdout.flush()


def _handle_request(method: str, params: Mapping[str, Any] | None) -> Mapping[str, Any]:
    if method == "initialize":
        protocol_version = "2024-11-05"
        if isinstance(params, dict):
            requested = params.get("protocolVersion")
            if isinstance(requested, str) and requested:
                protocol_version = requested
        return {
            "protocolVersion": protocol_version,
            "serverInfo": {"name": _SERVER_NAME, "version": _SERVER_VERSION},
            "instructions": _INSTRUCTIONS,
            "capabilities": {"tools": {"listChanged": False}},
        }
    if method == "tools/list":
        return {"tools": _tool_specs()}
    if method == "tools/call":
        if not isinstance(params, dict):
            return _tool_error("Invalid tools/call params.")
        name = params.get("name")
        if not isinstance(name, str) or not name:
            return _tool_error("tools/call requires tool name.")
        arguments = params.get("arguments")
        if arguments is not None and not isinstance(arguments, dict):
            return _tool_error("tools/call arguments must be an object.")
        return handle_tool_call(name, arguments if isinstance(arguments, dict) else None)
    raise ValueError(f"Method not found: {method}")


def run_stdio_server(stdin: Any = None, stdout: Any = None) -> int:
    transport = _ContentLengthStdio(
        stdin=stdin or sys.stdin.buffer,
        stdout=stdout or sys.stdout.buffer,
    )
    while True:
        message = transport.read_message()
        if message is None:
            return 0
        method = message.get("method")
        id_value = message.get("id")

        # JSON-RPC notification.
        if id_value is None:
            continue
        if not isinstance(method, str):
            transport.write_message(_jsonrpc_error(id_value, -32600, "Invalid Request"))
            continue

        try:
            params = message.get("params")
            if params is not None and not isinstance(params, dict):
                raise ValueError("params must be an object")
            result = _handle_request(method, params if isinstance(params, dict) else None)
            transport.write_message(_jsonrpc_ok(id_value, result))
        except ValueError as err:
            text = str(err)
            if text.startswith("Method not found:"):
                transport.write_message(_jsonrpc_error(id_value, -32601, text))
            else:
                transport.write_message(_jsonrpc_error(id_value, -32602, text))
        except Exception as err:
            transport.write_message(_jsonrpc_error(id_value, -32000, str(err)))


def console_main() -> None:
    raise SystemExit(run_stdio_server())
