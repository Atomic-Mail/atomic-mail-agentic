"""JMAP request helpers with preset loading and variable substitution."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Mapping, Sequence
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from .config import resolve_agent_config_from_env
from .session import AgentSession
from .shared_assets import shared_dir, try_read_shared_json

DEFAULT_JMAP_USING = [
    "urn:ietf:params:jmap:core",
    "urn:ietf:params:jmap:mail",
]
BUNDLED_OPS_PRESET_NAMES = [
    "list_inbox.json",
    "reply.json",
    "send_mail.json",
    "send_mail_attachment.json",
    "send_mail_blob_attachment.json",
]
_VAR_PATTERN = re.compile(r"\$([A-Z][A-Z0-9_]*)")
_SESSION_VAR_NAMES = {"ACCOUNT_ID", "INBOX", "INBOX_MAILBOX_ID"}


@dataclass
class JmapRequestResult:
    ok: bool
    status: int
    bodyText: str


def _shared_errors() -> dict[str, str]:
    loaded = try_read_shared_json("messages/errors.json")
    if isinstance(loaded, dict):
        return {k: v for k, v in loaded.items() if isinstance(k, str) and isinstance(v, str)}
    return {}


_ERRORS = _shared_errors()


def _error(key: str, fallback: str) -> str:
    return _ERRORS.get(key, fallback)


def _error_template(
    key: str,
    fallback: str,
    values: Mapping[str, str | int],
) -> str:
    out = _ERRORS.get(key, fallback)
    for name, value in values.items():
        out = out.replace(f"{{{name}}}", str(value))
    return out


def _resolve_ops_file_path(credential_dir: str, ops_file: str) -> Path:
    candidate = Path(ops_file).expanduser()
    if candidate.is_absolute():
        return candidate
    return Path(credential_dir) / ops_file


def _read_ops_file(credential_dir: str, ops_file: str) -> str:
    resolved = _resolve_ops_file_path(credential_dir, ops_file)
    try:
        return resolved.read_text(encoding="utf-8")
    except OSError:
        if Path(ops_file).expanduser().is_absolute():
            raise

    manifest = try_read_shared_json("manifest.json")
    presets_dir = "presets"
    if isinstance(manifest, dict):
        configured = manifest.get("presets_dir")
        if isinstance(configured, str) and configured:
            presets_dir = configured
    bundled_path = shared_dir() / presets_dir / ops_file
    try:
        return bundled_path.read_text(encoding="utf-8")
    except OSError as err:
        raise ValueError(
            _error_template(
                "jmap_ops_file_not_found_template",
                "ops_file '{ops_file}' not found under credential directory ({path}) "
                "and not among bundled presets: {presets}.",
                {
                    "ops_file": ops_file,
                    "path": str(resolved),
                    "presets": ", ".join(BUNDLED_OPS_PRESET_NAMES),
                },
            )
        ) from err


def _parse_jmap_envelope(
    raw: str,
    default_using: Sequence[str],
    source_label: str,
) -> dict[str, object]:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as err:
        raise ValueError(
            _error_template(
                "jmap_json_invalid_template",
                "{source} is not valid JSON: {details}",
                {"source": source_label, "details": str(err)},
            )
        ) from err

    if isinstance(value, list):
        return {"using": list(default_using), "methodCalls": value}

    if isinstance(value, dict) and isinstance(value.get("methodCalls"), list):
        using = value.get("using")
        if isinstance(using, list):
            filtered_using = [item for item in using if isinstance(item, str)]
        else:
            filtered_using = list(default_using)
        return {"using": filtered_using, "methodCalls": value["methodCalls"]}

    raise ValueError(
        _error_template(
            "jmap_envelope_invalid_template",
            '{source} must be a methodCalls array, e.g. [["Mailbox/get",{{...}},"m0"]], '
            "or an object with a methodCalls array.",
            {"source": source_label},
        )
    )


def _find_var_references(raw: str) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for match in _VAR_PATTERN.finditer(raw):
        name = match.group(1)
        if name not in seen:
            seen.add(name)
            ordered.append(name)
    return ordered


def _fetch_inbox_mailbox_id(session: AgentSession) -> str:
    envelope = {
        "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
        "methodCalls": [
            [
                "Mailbox/query",
                {
                    "accountId": session.get_primary_mail_account_id(),
                    "filter": {"role": "inbox"},
                },
                "mq0",
            ]
        ],
    }
    outcome = _post_jmap(session.get_jmap_post_url(), session.get_capability_token(), envelope)
    if not outcome.ok:
        raise ValueError(
            _error_template(
                "mailbox_query_failed_http_template",
                "Mailbox/query failed (HTTP {status}): {body}",
                {"status": outcome.status, "body": outcome.bodyText},
            )
        )
    try:
        parsed = json.loads(outcome.bodyText)
    except json.JSONDecodeError as err:
        raise ValueError(
            _error(
                "mailbox_query_response_not_json",
                "Mailbox/query response is not valid JSON.",
            )
        ) from err
    if not isinstance(parsed, dict):
        raise ValueError(
            _error(
                "mailbox_query_response_not_json",
                "Mailbox/query response is not valid JSON.",
            )
        )
    method_responses = parsed.get("methodResponses")
    if not isinstance(method_responses, list) or not method_responses:
        raise ValueError(
            _error_template(
                "mailbox_query_failed_template",
                "Mailbox/query failed: {body}",
                {"body": outcome.bodyText},
            )
        )
    first = method_responses[0]
    if (
        not isinstance(first, list)
        or len(first) < 2
        or first[0] != "Mailbox/query"
        or not isinstance(first[1], dict)
    ):
        raise ValueError(
            _error_template(
                "mailbox_query_failed_template",
                "Mailbox/query failed: {body}",
                {"body": outcome.bodyText},
            )
        )
    ids = first[1].get("ids")
    if not isinstance(ids, list) or not ids or not isinstance(ids[0], str) or not ids[0]:
        raise ValueError(
            _error(
                "mailbox_query_missing_inbox_id",
                "Mailbox/query returned no inbox mailbox id.",
            )
        )
    return ids[0]


def _substitute_vars(
    raw: str,
    vars: Mapping[str, str] | None,
    auto_resolvers: Mapping[str, Callable[[], str]],
) -> str:
    names = _find_var_references(raw)
    if not names:
        return raw

    resolved: dict[str, str] = {}
    provided = vars or {}

    for name in names:
        if name in provided:
            resolved[name] = provided[name]
            continue
        resolver = auto_resolvers.get(name)
        if resolver is not None:
            resolved[name] = resolver()

    missing = [name for name in names if name not in resolved]
    if missing:
        message = _error_template(
            "vars_missing_template",
            "Missing values for variables: {vars}. Pass custom placeholders in vars "
            "(MCP) or --vars (skill).",
            {"vars": ", ".join(f"${name}" for name in missing)},
        )
        if any(name in _SESSION_VAR_NAMES for name in missing):
            message += _error(
                "vars_missing_session_suffix",
                " For $ACCOUNT_ID, $INBOX, and $INBOX_MAILBOX_ID, ensure register "
                "completed and credentials are valid, or pass overrides in vars.",
            )
        raise ValueError(message)

    return _VAR_PATTERN.sub(lambda match: resolved[match.group(1)], raw)


def _post_jmap(jmap_post_url: str, capability_jwt: str, envelope: dict[str, object]) -> JmapRequestResult:
    body = json.dumps(envelope).encode("utf-8")
    req = Request(
        jmap_post_url,
        method="POST",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {capability_jwt}",
        },
    )
    try:
        with urlopen(req) as response:
            text = response.read().decode("utf-8")
            status = int(response.getcode())
            return JmapRequestResult(ok=200 <= status < 300, status=status, bodyText=text)
    except HTTPError as err:
        status = int(err.code)
        text = err.read().decode("utf-8", errors="replace")
        return JmapRequestResult(ok=False, status=status, bodyText=text)


def _jmap_next_hints() -> list[str]:
    hints = try_read_shared_json("messages/hints.json")
    if isinstance(hints, dict):
        raw = hints.get("jmap_next_hints")
        if isinstance(raw, list) and all(isinstance(item, str) for item in raw):
            return list(raw)
    return [
        "Use jmap_request with Mailbox/get or Email/query to work with mail data.",
        "Use presets with $VAR placeholders — $ACCOUNT_ID, $INBOX, and "
        "$INBOX_MAILBOX_ID come from the session; pass others via vars / --vars.",
        "Call help for the JMAP cheatsheet and troubleshooting.",
    ]


def _attach_next_hints(body_text: str) -> str:
    try:
        parsed = json.loads(body_text)
    except json.JSONDecodeError:
        return body_text
    if not isinstance(parsed, dict):
        return body_text
    with_next = dict(parsed)
    with_next["_next"] = _jmap_next_hints()
    return json.dumps(with_next, indent=2)


def run_jmap_request(
    *,
    session: AgentSession,
    ops_json: str,
    default_using: Sequence[str] | None = None,
    source_label: str = "ops",
    vars: Mapping[str, str] | None = None,
) -> JmapRequestResult:
    using = list(default_using) if default_using is not None else list(DEFAULT_JMAP_USING)
    auto_resolvers: dict[str, Callable[[], str]] = {
        "ACCOUNT_ID": session.get_primary_mail_account_id,
        "INBOX_MAILBOX_ID": lambda: _fetch_inbox_mailbox_id(session),
    }
    if session.current_inbox_id:
        auto_resolvers["INBOX"] = lambda: session.current_inbox_id or ""

    substituted = _substitute_vars(
        ops_json,
        vars=vars,
        auto_resolvers=auto_resolvers,
    )
    envelope = _parse_jmap_envelope(substituted, using, source_label)
    result = _post_jmap(
        session.get_jmap_post_url(),
        session.get_capability_token(),
        envelope,
    )
    if result.ok:
        return JmapRequestResult(ok=True, status=result.status, bodyText=_attach_next_hints(result.bodyText))
    return result


def jmap_request(
    *,
    ops: str | None = None,
    ops_file: str | None = None,
    vars: Mapping[str, str] | None = None,
    using: Sequence[str] | None = None,
    credentials_dir: str | None = None,
    env: Mapping[str, str] | None = None,
) -> JmapRequestResult:
    """Execute a JMAP request from inline ops JSON or an ops preset file."""
    if ops and ops_file:
        raise ValueError(
            _error(
                "mcp_ops_mutually_exclusive",
                "ops and ops_file are mutually exclusive — provide one.",
            )
        )
    if not ops and not ops_file:
        raise ValueError(_error("mcp_ops_required", "Provide either ops or ops_file."))

    resolved = resolve_agent_config_from_env(env, credential_dir=credentials_dir)
    session = AgentSession.from_resolved_config(resolved)

    if ops_file:
        raw = _read_ops_file(session.credentialDir, ops_file)
        source_label = f"ops_file '{ops_file}'"
    else:
        raw = ops or ""
        source_label = "ops"

    return run_jmap_request(
        session=session,
        ops_json=raw,
        default_using=using,
        source_label=source_label,
        vars=vars,
    )
