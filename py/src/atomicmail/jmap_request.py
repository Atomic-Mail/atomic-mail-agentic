"""JMAP request helpers with preset loading and variable substitution."""

from __future__ import annotations

import base64
import binascii
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from .credentials import CredentialStore
from .credentials import try_read_credentials
from .session import (
    AgentSession,
    JMAP_BLOB_URN,
    create_agent_session,
    inbox_id_to_mailbox_email,
)
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
USER_VAR_KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]*$")
_SESSION_VAR_NAMES = {"ACCOUNT_ID", "INBOX", "INBOX_MAILBOX_ID"}
_EXT_TO_MIME = {
    ".txt": "text/plain",
    ".html": "text/html",
    ".htm": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".json": "application/json",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".zip": "application/zip",
    ".gz": "application/gzip",
    ".xml": "application/xml",
}
_DEFAULT_TEXT_CHARSET = "utf-8"


@dataclass
class JmapRequestResult:
    ok: bool
    status: int
    bodyText: str


@dataclass
class JmapAttachmentInput:
    path: str
    filename: str | None = None
    contentType: str | None = None


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


def _guess_mime_type_from_filename(name: str) -> str:
    lower = name.lower()
    dot = lower.rfind(".")
    if dot == -1:
        return "application/octet-stream"
    return _EXT_TO_MIME.get(lower[dot:], "application/octet-stream")


def _expand_upload_url(template: str, account_id: str) -> str:
    return template.replace("%7BaccountId%7D", account_id).replace("{accountId}", account_id)


def _coerce_attachment_input(item: JmapAttachmentInput | Mapping[str, str], index: int) -> JmapAttachmentInput:
    if isinstance(item, JmapAttachmentInput):
        if not item.path:
            raise ValueError(f"Attachment at index {index} is missing path.")
        return item

    path = item.get("path")
    if not isinstance(path, str) or not path:
        raise ValueError(f"Attachment at index {index} must include a non-empty string path.")
    filename = item.get("filename")
    content_type = item.get("contentType")
    if filename is not None and not isinstance(filename, str):
        raise ValueError(f"Attachment at index {index} has non-string filename.")
    if content_type is not None and not isinstance(content_type, str):
        raise ValueError(f"Attachment at index {index} has non-string contentType.")
    return JmapAttachmentInput(path=path, filename=filename, contentType=content_type)


def _attachment_absolute_path(path_base: str, attachment_path: str) -> Path:
    expanded = Path(attachment_path).expanduser()
    if expanded.is_absolute():
        return expanded
    return (Path(path_base) / expanded).resolve()


def _assert_attachment_bytes_within_blob_limit(
    items: Sequence[tuple[str, int]],
    limits: Mapping[str, int | None] | None,
) -> None:
    if not limits:
        return
    max_size = limits.get("maxSizeBlobSet")
    if max_size is None:
        return
    for label, byte_length in items:
        if byte_length > max_size:
            raise ValueError(
                f"{label} is {byte_length} octets but account maxSizeBlobSet is {max_size} "
                "(RFC 9404 §3.1). Use a smaller file or refresh the session if limits changed."
            )


def _post_binary_blob_upload(
    upload_url_expanded: str,
    capability_jwt: str,
    content: bytes,
    content_type: str,
) -> tuple[str, int]:
    req = Request(
        upload_url_expanded,
        method="POST",
        data=content,
        headers={
            "Authorization": f"Bearer {capability_jwt}",
            "Content-Type": content_type,
        },
    )
    try:
        with urlopen(req) as response:
            text = response.read().decode("utf-8")
            status = int(response.getcode())
    except HTTPError as err:
        status = int(err.code)
        text = err.read().decode("utf-8", errors="replace")
        raise ValueError(
            f"RFC 8620 binary upload failed (HTTP {status}) for {upload_url_expanded}: {text}"
        ) from err

    if status < 200 or status >= 300:
        raise ValueError(
            f"RFC 8620 binary upload failed (HTTP {status}) for {upload_url_expanded}: {text}"
        )
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as err:
        raise ValueError(
            _error_template(
                "blob_upload_missing_blob_id_template",
                "Upload response missing blobId: {response}",
                {"response": text},
            )
        ) from err

    if not isinstance(parsed, dict):
        raise ValueError(
            _error_template(
                "blob_upload_missing_blob_id_template",
                "Upload response missing blobId: {response}",
                {"response": text},
            )
        )

    blob_id = parsed.get("blobId")
    if not isinstance(blob_id, str) or not blob_id:
        raise ValueError(
            _error_template(
                "blob_upload_missing_blob_id_template",
                "Upload response missing blobId: {response}",
                {"response": text},
            )
        )

    size_value = parsed.get("size")
    if isinstance(size_value, int):
        size = size_value
    elif isinstance(size_value, float) and size_value.is_integer():
        size = int(size_value)
    else:
        size = len(content)
    return blob_id, size


def _build_vars_from_attachment_files(
    *,
    session: AgentSession,
    attachments: Sequence[JmapAttachmentInput | Mapping[str, str]],
    path_base: str,
) -> dict[str, str]:
    if not attachments:
        return {}

    normalized = [_coerce_attachment_input(item, i) for i, item in enumerate(attachments)]
    account_id = session.get_primary_mail_account_id()
    limits = session.get_blob_upload_limits_for_account(account_id)
    capability_jwt = session.get_capability_token()

    upload_template = session.current_upload_url
    if not upload_template and getattr(session, "files", None) is not None:
        creds = try_read_credentials(session.files.credentialsFile)
        if creds:
            upload_template = creds.uploadUrl
    if not upload_template:
        raise ValueError(_error("jmap_session_missing_upload_url", "JMAP session missing uploadUrl."))
    upload_url_expanded = _expand_upload_url(upload_template, account_id)

    prepared: list[tuple[bytes, str, str]] = []
    for item in normalized:
        abs_path = _attachment_absolute_path(path_base, item.path)
        try:
            content = abs_path.read_bytes()
        except OSError as err:
            raise ValueError(
                _error_template(
                    "blob_upload_path_not_readable_template",
                    "Attachment path is not readable: {path}",
                    {"path": str(abs_path)},
                )
            ) from err
        filename = item.filename or abs_path.name
        content_type = item.contentType or _guess_mime_type_from_filename(filename)
        prepared.append((content, filename, content_type))

    _assert_attachment_bytes_within_blob_limit(
        [(filename, len(content)) for content, filename, _ in prepared],
        limits,
    )

    out: dict[str, str] = {}
    for index, (content, filename, content_type) in enumerate(prepared):
        blob_id, size = _post_binary_blob_upload(
            upload_url_expanded=upload_url_expanded,
            capability_jwt=capability_jwt,
            content=content,
            content_type=content_type,
        )
        out[f"ATTACHMENT_{index}_BLOB_ID"] = blob_id
        out[f"ATTACHMENT_{index}_NAME"] = filename
        out[f"ATTACHMENT_{index}_TYPE"] = content_type
        out[f"ATTACHMENT_{index}_SIZE"] = str(size)

    out["ATTACHMENT_COUNT"] = str(len(prepared))
    return out


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


def _resolve_inbox_mailbox_email(session: AgentSession) -> str:
    raw_inbox = session.current_inbox_id
    if not raw_inbox and getattr(session, "files", None) is not None:
        creds = try_read_credentials(session.files.credentialsFile)
        raw_inbox = creds.inboxId if creds else None
    if not raw_inbox:
        raise ValueError("No inbox in session; run register first.")
    return inbox_id_to_mailbox_email(raw_inbox)


def _fallback_jmap_url_from_files(session: AgentSession, attr_name: str) -> str:
    files = getattr(session, "files", None)
    if files is None:
        raise ValueError(f"JMAP session missing {attr_name}.")
    creds = try_read_credentials(files.credentialsFile)
    if not creds:
        raise ValueError(f"JMAP session missing {attr_name}.")
    return getattr(creds, attr_name)


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


def _utf8_byte_length(text: str) -> int:
    return len(text.encode("utf-8"))


def _decoded_base64_byte_length(value: str) -> int:
    compact = "".join(value.split())
    if not compact:
        return 0
    if len(compact) % 4 == 1:
        raise ValueError("Invalid base64 in Blob/upload data:asBase64 (RFC 9404 §4.1): bad length.")
    normalized = compact.replace("-", "+").replace("_", "/")
    try:
        decoded = base64.b64decode(normalized, validate=True)
    except (binascii.Error, ValueError) as err:
        raise ValueError("Invalid base64 in Blob/upload data:asBase64 (RFC 9404 §4.1).") from err
    return len(decoded)


def _slice_octet_count(source_len: int, offset: object, length: object) -> int:
    off = 0
    if isinstance(offset, int) and offset >= 0:
        off = offset
    rest = max(0, source_len - off)
    if length is None:
        return rest
    if isinstance(length, int) and length >= 0:
        return min(rest, length)
    return rest


def _try_compute_upload_data_octets(
    data_unknown: object,
    known_sizes: Mapping[str, int],
) -> int | None:
    if not isinstance(data_unknown, list):
        return 0

    total = 0
    for part in data_unknown:
        if not isinstance(part, dict):
            continue
        as_text = part.get("data:asText")
        as_base64 = part.get("data:asBase64")
        blob_id = part.get("blobId")
        has_text = as_text is not None
        has_base64 = as_base64 is not None
        has_blob = blob_id is not None
        selected = [has_text, has_base64, has_blob]
        if sum(1 for flag in selected if flag) == 0:
            continue
        if sum(1 for flag in selected if flag) != 1:
            raise ValueError(
                "Each Blob/upload DataSourceObject must use exactly one of data:asText, "
                "data:asBase64, or blobId (RFC 9404 §4.1)."
            )

        if has_text:
            if not isinstance(as_text, str):
                raise ValueError("Blob/upload data:asText must be a string.")
            total += _utf8_byte_length(as_text)
            continue

        if has_base64:
            if not isinstance(as_base64, str):
                raise ValueError("Blob/upload data:asBase64 must be a string.")
            total += _decoded_base64_byte_length(as_base64)
            continue

        if not isinstance(blob_id, str) or not blob_id:
            raise ValueError("Blob/upload blobId must be a non-empty string.")
        if not blob_id.startswith("#"):
            return None
        ref_id = blob_id[1:]
        source_len = known_sizes.get(ref_id)
        if source_len is None:
            return None
        total += _slice_octet_count(source_len, part.get("offset"), part.get("length"))
    return total


def _resolve_create_sizes_for_one_blob_upload(
    create: Mapping[str, Any],
    limits: Mapping[str, int | None],
    prior_sizes: Mapping[str, int],
) -> dict[str, int]:
    merged = dict(prior_sizes)
    pending = set(create.keys())

    max_data_sources = limits.get("maxDataSources")
    max_size_blob_set = limits.get("maxSizeBlobSet")

    while pending:
        progressed = False
        for key in list(pending):
            upload_obj = create.get(key)
            if not isinstance(upload_obj, dict):
                pending.remove(key)
                progressed = True
                continue

            data = upload_obj.get("data")
            ds_count = len(data) if isinstance(data, list) else 0
            if max_data_sources is not None and ds_count > max_data_sources:
                raise ValueError(
                    f'Blob/upload create "{key}" uses {ds_count} DataSourceObject entries; '
                    f"account maxDataSources is {max_data_sources} (RFC 9404 §3.1)."
                )

            computed = _try_compute_upload_data_octets(data, merged)
            if computed is None:
                continue

            if max_size_blob_set is not None and computed > max_size_blob_set:
                raise ValueError(
                    f'Blob/upload create "{key}" would be {computed} octets; account '
                    f"maxSizeBlobSet is {max_size_blob_set} (RFC 9404 §3.1). "
                    "Use a smaller payload, split data, or POST the file to the session "
                    "uploadUrl (RFC 8620) / MCP attachments for large binaries."
                )

            merged[key] = computed
            pending.remove(key)
            progressed = True
        if not progressed:
            break
    return merged


def _assert_blob_upload_envelope_within_limits(
    envelope: Mapping[str, object],
    limits_by_account: Mapping[str, Mapping[str, int | None] | None],
) -> None:
    method_calls = envelope.get("methodCalls")
    if not isinstance(method_calls, list):
        return

    global_sizes: dict[str, int] = {}
    for call in method_calls:
        if not isinstance(call, list) or not call:
            continue
        if call[0] != "Blob/upload":
            continue
        if len(call) < 2 or not isinstance(call[1], dict):
            continue
        arg = call[1]
        account_id = arg.get("accountId")
        if not isinstance(account_id, str) or not account_id:
            continue
        limits = limits_by_account.get(account_id)
        if not limits:
            continue
        create = arg.get("create")
        if not isinstance(create, dict):
            continue
        global_sizes = _resolve_create_sizes_for_one_blob_upload(create, limits, global_sizes)


def _collect_blob_upload_account_ids(envelope: Mapping[str, object]) -> list[str]:
    method_calls = envelope.get("methodCalls")
    if not isinstance(method_calls, list):
        return []
    ids: set[str] = set()
    for call in method_calls:
        if not isinstance(call, list) or len(call) < 2 or call[0] != "Blob/upload":
            continue
        if not isinstance(call[1], dict):
            continue
        aid = call[1].get("accountId")
        if isinstance(aid, str) and aid:
            ids.add(aid)
    return list(ids)


def _enforce_jmap_blob_upload_limits_if_applicable(
    *,
    session: AgentSession,
    envelope: Mapping[str, object],
) -> None:
    using = envelope.get("using")
    if not isinstance(using, list) or JMAP_BLOB_URN not in using:
        return
    method_calls = envelope.get("methodCalls")
    if not isinstance(method_calls, list):
        return
    if not any(isinstance(call, list) and call and call[0] == "Blob/upload" for call in method_calls):
        return

    limits_by_account: dict[str, Mapping[str, int | None] | None] = {}
    for account_id in _collect_blob_upload_account_ids(envelope):
        limits_by_account[account_id] = session.get_blob_upload_limits_for_account(account_id)
    _assert_blob_upload_envelope_within_limits(envelope, limits_by_account)


def _base_media_type(value: str) -> str:
    return value.split(";", 1)[0].strip().lower()


def _is_text_star_type(value: str) -> bool:
    return _base_media_type(value).startswith("text/")


def _ensure_charset_on_body_part(part: object) -> None:
    if not isinstance(part, dict):
        return
    part_id = part.get("partId")
    if isinstance(part_id, str) and part_id:
        return
    blob_id = part.get("blobId")
    if not isinstance(blob_id, str) or not blob_id:
        return
    media_type = part.get("type")
    if not isinstance(media_type, str) or not _is_text_star_type(media_type):
        return
    charset = part.get("charset")
    if charset is not None and charset != "":
        return
    part["charset"] = _DEFAULT_TEXT_CHARSET


def _normalize_body_part_array(items: object) -> None:
    if not isinstance(items, list):
        return
    for item in items:
        _ensure_charset_on_body_part(item)


def _ensure_text_charset_on_email_set_blob_parts(envelope: Mapping[str, object]) -> None:
    method_calls = envelope.get("methodCalls")
    if not isinstance(method_calls, list):
        return
    for call in method_calls:
        if not isinstance(call, list) or len(call) < 2 or call[0] != "Email/set":
            continue
        arg = call[1]
        if not isinstance(arg, dict):
            continue
        create = arg.get("create")
        if not isinstance(create, dict):
            continue
        for email in create.values():
            if not isinstance(email, dict):
                continue
            _normalize_body_part_array(email.get("attachments"))
            _normalize_body_part_array(email.get("textBody"))
            _normalize_body_part_array(email.get("htmlBody"))


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
    dry_run: bool = False,
    attachments: Sequence[JmapAttachmentInput | Mapping[str, str]] | None = None,
    attachment_path_base: str | None = None,
) -> JmapRequestResult:
    if dry_run and attachments:
        raise ValueError(
            _error(
                "jmap_dry_run_with_attachments",
                "dryRun cannot be used with attachments: RFC 8620 upload runs first and would create blobs.",
            )
        )

    using = list(default_using) if default_using is not None else list(DEFAULT_JMAP_USING)
    merged_vars = dict(vars or {})
    if attachments:
        injected_vars = _build_vars_from_attachment_files(
            session=session,
            attachments=attachments,
            path_base=attachment_path_base or os.getcwd(),
        )
        merged_vars = {**injected_vars, **merged_vars}

    auto_resolvers: dict[str, Callable[[], str]] = {
        "ACCOUNT_ID": session.get_primary_mail_account_id,
        "INBOX_MAILBOX_ID": lambda: _fetch_inbox_mailbox_id(session),
        "INBOX": lambda: _resolve_inbox_mailbox_email(session),
        "UPLOAD_URL": lambda: (
            session.current_upload_url
            or _fallback_jmap_url_from_files(session, "uploadUrl")
        ),
        "DOWNLOAD_URL": lambda: (
            session.current_download_url
            or _fallback_jmap_url_from_files(session, "downloadUrl")
        ),
    }

    substituted = _substitute_vars(
        ops_json,
        vars=merged_vars,
        auto_resolvers=auto_resolvers,
    )
    envelope = _parse_jmap_envelope(substituted, using, source_label)
    _ensure_text_charset_on_email_set_blob_parts(envelope)
    _enforce_jmap_blob_upload_limits_if_applicable(session=session, envelope=envelope)

    jmap_post_url = session.get_jmap_post_url()
    if dry_run:
        return JmapRequestResult(
            ok=True,
            status=200,
            bodyText=json.dumps(
                {"dryRun": True, "url": jmap_post_url, "envelope": envelope},
                indent=2,
            ),
        )

    result = _post_jmap(
        jmap_post_url,
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
    dry_run: bool = False,
    attachments: Sequence[JmapAttachmentInput | Mapping[str, str]] | None = None,
    attachment_path_base: str | None = None,
    using: Sequence[str] | None = None,
    credentials_dir: str | None = None,
    env: Mapping[str, str] | None = None,
    store: CredentialStore | None = None,
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

    session = create_agent_session(
        credentials_dir=credentials_dir,
        env=env,
        store=store,
    )

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
        dry_run=dry_run,
        attachments=attachments,
        attachment_path_base=attachment_path_base,
    )
