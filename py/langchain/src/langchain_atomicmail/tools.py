"""LangChain tool wrappers for Atomic Mail operations."""

from __future__ import annotations

import json
from dataclasses import asdict
from typing import Mapping, Sequence

from langchain_core.tools import BaseTool, StructuredTool
from pydantic import BaseModel, Field

from atomicmail.help import help as atomicmail_help
from atomicmail.jmap_request import (
    DEFAULT_JMAP_USING,
    USER_VAR_KEY_RE,
    JmapAttachmentInput,
    jmap_request as atomicmail_jmap_request,
)
from atomicmail.session import (
    register as atomicmail_register,
)


class RegisterArgs(BaseModel):
    """Arguments for the register tool."""

    username: str = Field(min_length=5, max_length=21)
    credentials_dir: str | None = None
    forced: bool = False


class AttachmentArgs(BaseModel):
    """Attachment input for JMAP requests."""

    path: str
    filename: str | None = None
    content_type: str | None = None


class JmapRequestArgs(BaseModel):
    """Arguments for the jmap_request tool."""

    ops: str | None = None
    ops_file: str | None = None
    vars: dict[str, str] | None = None
    dry_run: bool = False
    attachments: list[AttachmentArgs] | None = None
    using: list[str] | None = None
    credentials_dir: str | None = None


class HelpArgs(BaseModel):
    """Arguments for the help tool."""

    topic: str | None = None


def _validate_vars(vars_map: Mapping[str, str] | None) -> None:
    if vars_map is None:
        return
    invalid_key = next(
        (key for key in vars_map if USER_VAR_KEY_RE.fullmatch(key) is None),
        None,
    )
    if invalid_key is not None:
        raise ValueError(
            f"vars key '{invalid_key}' must match /^[A-Z][A-Z0-9_]*$/."
        )


def _coerce_attachments(
    attachments: Sequence[AttachmentArgs | Mapping[str, str]] | None,
) -> list[JmapAttachmentInput] | None:
    if attachments is None:
        return None
    out: list[JmapAttachmentInput] = []
    for index, item in enumerate(attachments):
        if isinstance(item, Mapping):
            path = item.get("path")
            filename = item.get("filename")
            content_type = item.get("content_type")
            if not isinstance(path, str) or not path:
                raise ValueError(
                    f"attachments[{index}].path must be a non-empty string"
                )
            if filename is not None and not isinstance(filename, str):
                raise ValueError(f"attachments[{index}].filename must be a string")
            if content_type is not None and not isinstance(content_type, str):
                raise ValueError(
                    f"attachments[{index}].content_type must be a string"
                )
            out.append(
                JmapAttachmentInput(
                    path=path,
                    filename=filename,
                    contentType=content_type,
                )
            )
            continue
        out.append(
            JmapAttachmentInput(
                path=item.path,
                filename=item.filename,
                contentType=item.content_type,
            )
        )
    return out


def register_tool(
    *,
    username: str,
    credentials_dir: str | None = None,
    forced: bool = False,
) -> str:
    """Register an Atomic Mail inbox and return JSON details."""
    result = atomicmail_register(
        username=username,
        credentials_dir=credentials_dir,
        forced=forced,
    )
    return json.dumps(asdict(result), indent=2)


def jmap_request_tool(
    *,
    ops: str | None = None,
    ops_file: str | None = None,
    vars: Mapping[str, str] | None = None,
    dry_run: bool = False,
    attachments: Sequence[AttachmentArgs | Mapping[str, str]] | None = None,
    using: Sequence[str] | None = None,
    credentials_dir: str | None = None,
) -> str:
    """Execute a JMAP request and return response text."""
    if isinstance(ops, str) and isinstance(ops_file, str):
        raise ValueError("ops and ops_file are mutually exclusive — provide one.")
    if not isinstance(ops, str) and not isinstance(ops_file, str):
        raise ValueError("Provide either ops or ops_file.")
    _validate_vars(vars)
    normalized_attachments = _coerce_attachments(attachments)
    normalized_using = list(using) if using is not None else list(DEFAULT_JMAP_USING)

    result = atomicmail_jmap_request(
        ops=ops if isinstance(ops, str) else None,
        ops_file=ops_file if isinstance(ops_file, str) else None,
        vars=vars,
        dry_run=dry_run,
        attachments=normalized_attachments,
        using=normalized_using,
        credentials_dir=credentials_dir,
    )
    if not result.ok:
        raise ValueError(
            f"JMAP request failed (HTTP {result.status}): {result.bodyText}"
        )
    return result.bodyText


def help_tool(*, topic: str | None = None) -> str:
    """Return Atomic Mail built-in help text."""
    return atomicmail_help(topic=topic)


def get_register_tool() -> BaseTool:
    """Build a LangChain StructuredTool for register."""
    return StructuredTool.from_function(
        func=register_tool,
        name="register",
        description=(
            "PoW signup; writes credentials. Usernames are 5-21 characters. "
            "Idempotent for the same username and stored inbox; a different username "
            "is rejected unless forced=true."
        ),
        args_schema=RegisterArgs,
    )


def get_jmap_request_tool() -> BaseTool:
    """Build a LangChain StructuredTool for jmap_request."""
    return StructuredTool.from_function(
        func=jmap_request_tool,
        name="jmap_request",
        description=(
            "JMAP method-call batch with automatic auth. Exactly one of ops/ops_file. "
            "Supports vars placeholders and optional local file attachments."
        ),
        args_schema=JmapRequestArgs,
    )


def get_help_tool() -> BaseTool:
    """Build a LangChain StructuredTool for help."""
    return StructuredTool.from_function(
        func=help_tool,
        name="help",
        description="Built-in docs for Atomic Mail topics including presets and cron.",
        args_schema=HelpArgs,
    )


def get_atomicmail_tools() -> list[BaseTool]:
    """Return all Atomic Mail LangChain tools."""
    return [get_register_tool(), get_jmap_request_tool(), get_help_tool()]
