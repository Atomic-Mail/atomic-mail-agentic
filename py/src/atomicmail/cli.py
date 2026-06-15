"""Atomic Mail CLI adapter for Python library."""

from __future__ import annotations

import argparse
import json
import sys
from typing import Mapping, Sequence

from .help import HELP_TOPIC_LIST, help as get_help, normalize_help_topic
from .jmap_request import DEFAULT_JMAP_USING, JmapAttachmentInput, jmap_request
from .shared_assets import try_read_shared_json
from .session import register


def _shared_errors() -> dict[str, str]:
    loaded = try_read_shared_json("messages/errors.json")
    if isinstance(loaded, dict):
        return {k: v for k, v in loaded.items() if isinstance(k, str) and isinstance(v, str)}
    return {}


_ERRORS = _shared_errors()


def _error(key: str, fallback: str) -> str:
    return _ERRORS.get(key, fallback)


def _error_template(key: str, fallback: str, values: Mapping[str, str | int]) -> str:
    out = _ERRORS.get(key, fallback)
    for name, value in values.items():
        out = out.replace(f"{{{name}}}", str(value))
    return out


def _parse_user_vars_json(raw: str) -> dict[str, str]:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as err:
        raise ValueError(
            _error_template(
                "vars_invalid_json_template",
                "--vars is not valid JSON: {details}",
                {"details": str(err)},
            )
        ) from err
    if not isinstance(value, dict):
        raise ValueError(_error("vars_not_object", "--vars must be a JSON object of { VAR_NAME: string }."))
    out: dict[str, str] = {}
    for key, item in value.items():
        if not isinstance(key, str) or not key:
            raise ValueError(
                _error_template(
                    "vars_key_invalid_template",
                    "--vars key '{key}' must match /^[A-Z][A-Z0-9_]*$/.",
                    {"key": str(key)},
                )
            )
        if not key[0].isalpha() or not key[0].isupper():
            raise ValueError(
                _error_template(
                    "vars_key_invalid_template",
                    "--vars key '{key}' must match /^[A-Z][A-Z0-9_]*$/.",
                    {"key": key},
                )
            )
        if any((not ch.isdigit()) and (not ch.isupper()) and ch != "_" for ch in key[1:]):
            raise ValueError(
                _error_template(
                    "vars_key_invalid_template",
                    "--vars key '{key}' must match /^[A-Z][A-Z0-9_]*$/.",
                    {"key": key},
                )
            )
        if not isinstance(item, str):
            raise ValueError(
                _error_template(
                    "vars_value_not_string_template",
                    "--vars value for '{key}' must be a string.",
                    {"key": key},
                )
            )
        out[key] = item
    return out


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="atomicmail", description="Atomic Mail Python CLI")
    subparsers = parser.add_subparsers(dest="command")

    register_cmd = subparsers.add_parser(
        "register", help="PoW signup or API-key login and persist credentials"
    )
    register_mode = register_cmd.add_mutually_exclusive_group(required=True)
    register_mode.add_argument("--username", help="Desired username (5-21 characters).")
    register_mode.add_argument("--api-key", help="Existing API key for login.")
    register_cmd.add_argument("--credentials-dir", help="Credential directory for this command.")
    register_cmd.add_argument(
        "--forced",
        action="store_true",
        help="Allow replacing existing credentials for a different username (username mode only).",
    )

    jmap_cmd = subparsers.add_parser("jmap_request", help="Send a JMAP request")
    jmap_cmd.add_argument("--credentials-dir", help="Credential directory for this command.")
    jmap_ops = jmap_cmd.add_mutually_exclusive_group(required=True)
    jmap_ops.add_argument("--ops", help="Inline JMAP JSON.")
    jmap_ops.add_argument("--ops-file", help="JMAP ops file path or bundled preset name.")
    jmap_cmd.add_argument(
        "--using",
        help="Comma-separated capability URNs used when ops does not provide using.",
    )
    jmap_cmd.add_argument("--vars", help="JSON object with VAR_NAME -> string placeholder values.")
    jmap_cmd.add_argument(
        "--attachment",
        action="append",
        dest="attachments",
        help="Attachment path; repeat for multiple files.",
    )
    jmap_cmd.add_argument(
        "--attachment-path-base",
        help="Base directory for resolving relative attachment paths.",
    )
    jmap_cmd.add_argument(
        "--dry-run",
        action="store_true",
        help="Resolve envelope and print request without sending it.",
    )

    help_cmd = subparsers.add_parser("help", help="Print Atomic Mail help topic")
    help_cmd.add_argument("--topic", help="Help topic; omit for overview.")

    return parser


def _cmd_register(args: argparse.Namespace) -> int:
    if args.api_key and args.forced:
        raise ValueError("--forced can only be used with --username.")

    result = register(
        username=args.username,
        api_key=args.api_key,
        credentials_dir=args.credentials_dir,
        forced=bool(args.forced),
    )
    sys.stdout.write(json.dumps(result.__dict__, indent=2) + "\n")
    return 0


def _cmd_jmap_request(args: argparse.Namespace) -> int:
    attachments: list[JmapAttachmentInput] | None = None
    if args.attachments:
        attachments = [JmapAttachmentInput(path=item) for item in args.attachments]
    if args.dry_run and attachments:
        raise ValueError(
            _error(
                "cli_dry_run_with_attachment",
                "--dry-run cannot be combined with --attachment.",
            )
        )

    using = list(DEFAULT_JMAP_USING)
    if args.using:
        using = [item.strip() for item in args.using.split(",") if item.strip()]

    vars_map: dict[str, str] | None = None
    if args.vars is not None:
        vars_map = _parse_user_vars_json(args.vars)

    result = jmap_request(
        ops=args.ops,
        ops_file=args.ops_file,
        vars=vars_map,
        dry_run=bool(args.dry_run),
        attachments=attachments,
        attachment_path_base=args.attachment_path_base,
        using=using,
        credentials_dir=args.credentials_dir,
    )
    sys.stdout.write(result.bodyText if result.bodyText.endswith("\n") else f"{result.bodyText}\n")
    if result.ok:
        return 0
    sys.stderr.write(f"Error: JMAP request failed (HTTP {result.status}): {result.bodyText}\n")
    return 1


def _cmd_help(args: argparse.Namespace) -> int:
    topic = args.topic
    if topic is not None and normalize_help_topic(topic) == "readme":
        # Python package does not bundle npm README lookup;
        # we intentionally return the same shared stub text as get_help("readme").
        sys.stdout.write(get_help("readme") + "\n")
        return 0

    sys.stdout.write(get_help(topic) + "\n")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)

    if not args.command:
        parser.print_help(sys.stderr)
        return 2

    try:
        if args.command == "register":
            return _cmd_register(args)
        if args.command == "jmap_request":
            return _cmd_jmap_request(args)
        if args.command == "help":
            return _cmd_help(args)
        message = _error_template(
            "cli_unknown_command_template",
            "Unknown command: {cmd}",
            {"cmd": str(args.command)},
        )
        sys.stderr.write(f"Error: {message}\n")
        return 2
    except ValueError as err:
        sys.stderr.write(f"Error: {err}\n")
        return 2
    except Exception as err:  # pragma: no cover - defensive CLI adapter guard
        sys.stderr.write(f"Error: {err}\n")
        return 1


def console_main() -> None:
    raise SystemExit(main())


def help_topics_for_cli() -> str:
    """Expose topics for tests/help text parity checks."""
    return ", ".join(HELP_TOPIC_LIST)
