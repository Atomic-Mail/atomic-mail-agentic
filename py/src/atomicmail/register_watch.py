"""Register `watch` precondition — wrapper-only, mirrors the TS skill/MCP.

The parameter is validated in the MCP adapter and the CLI only; it never
reaches ``session.register``. On watch="scheduled" the *calling runtime* is
detected from environment-variable markers (each runtime stamps its own vars —
CLAUDECODE for Claude Code, OPENCLAW_HOME for OpenClaw, etc.). PATH is never
consulted: an installed binary is not evidence it invoked us.

Every supported runtime is scheduled by its *own* durable scheduler. OS-level
jobs (launchd/systemd/crontab) are deliberately not generated — they run outside
the host's permission model and AGENTS.md forbids them. A runtime whose only
scheduler is session-scoped counts as having none.

Two shapes come out: a shell command (hosts with a cron CLI) and an instruction
(hosts whose scheduler the agent drives itself). Neither is executed here — the
agent runs its own scheduler through its own tools, so the host's permission gate
still fires. The scheduled prompt carries an explicit ``--credentials-dir``:
scheduled sessions inherit no environment on any host. Templates and framing live
in ``shared/``.
"""

from __future__ import annotations

import os
from typing import Any, Literal, Mapping

from .shared_assets import try_read_shared_json, try_read_shared_text

WatchValue = Literal["scheduled", "on-demand"]

_WATCH_REQUIRED_FALLBACK = (
    "register requires 'watch'. This is your operator's decision, not yours. "
    'Ask them whether anything should check this inbox on a schedule, then retry '
    'with watch="scheduled" or watch="on-demand". Both are real choices about how '
    'the operator works — "on-demand" (they fetch mail when they need it) asserts '
    'as much as "scheduled", so do not guess either. If they say scheduled, call '
    "help topic cron for the setup command for their host. "
    "See: https://atomicmail.ai/llms.txt#onboarding"
)

_SCHEDULE_FALLBACK = (
    "watch=\"scheduled\": set up a recurring inbox agent job on your host's own "
    'scheduler — see help topic "cron".'
)

_DEFAULT_CREDENTIALS_DIR = "~/.atomicmail"


def register_watch_required_error() -> str:
    """Flattened text for the missing/invalid ``watch`` precondition.

    Assembled from three shared string keys (errors.json stays all-strings).
    """
    loaded = try_read_shared_json("messages/errors.json")
    if isinstance(loaded, dict):
        message = loaded.get("register_watch_required_message")
        hint = loaded.get("register_watch_required_hint")
        docs_url = loaded.get("register_watch_required_docs_url")
        if (
            isinstance(message, str)
            and isinstance(hint, str)
            and isinstance(docs_url, str)
        ):
            return f"{message} {hint} See: {docs_url}"
    return _WATCH_REQUIRED_FALLBACK


def resolve_register_watch(value: object) -> WatchValue:
    """Enforce the ``watch`` precondition; raise the shared error otherwise.

    ``on-demand`` is a deliberate operating choice (the operator fetches mail when
    they need it), not an abstention — a blind guess asserts as much as
    ``scheduled`` would.
    """
    if value == "scheduled" or value == "on-demand":
        return value  # type: ignore[return-value]
    raise ValueError(register_watch_required_error())


def _marker_present(runtime: Mapping[str, Any], env: Mapping[str, str]) -> bool:
    """True when at least one of the runtime's marker vars is set to a non-empty value."""
    for name in runtime.get("env", []):
        value = env.get(name)
        if value is not None and value != "":
            return True
    return False


def detect_schedule(
    data: Mapping[str, Any],
    *,
    env: Mapping[str, str],
) -> dict[str, str]:
    """Resolve the calling runtime from env markers alone.

    PATH is never consulted: an installed binary is not evidence that it invoked
    us — that mistake once made a Claude Code session emit an OpenClaw command.
    Returns an empty mapping when no marker matched.
    """
    for runtime in data.get("runtimes", []):
        if not _marker_present(runtime, env):
            continue
        found = {"runtime": runtime["id"], "scheduler": runtime["scheduler"]}
        if runtime.get("label"):
            found["label"] = runtime["label"]
        return found
    return {}


def _fill(template: str, variables: Mapping[str, str]) -> str:
    out = template
    for key, value in variables.items():
        out = out.replace("{" + key + "}", value)
    return out


def _defaults(
    env: Mapping[str, str] | None, credentials_dir: str | None
) -> tuple[Mapping[str, str], str]:
    if env is None:
        env = os.environ
    if credentials_dir is None:
        credentials_dir = (
            env.get("ATOMIC_MAIL_CREDENTIALS_DIR") or _DEFAULT_CREDENTIALS_DIR
        )
    return env, credentials_dir


def _job_name(prefix: str, inbox_id: str | None) -> str:
    """``atomicmail-inbox-alice`` from ``alice@atomicmail.ai``.

    Job names land in shell commands and host job registries, so anything
    outside a safe slug is dropped rather than quoted. Multi-account is a
    supported flow: one fixed name across N inboxes loses N-1 of them.
    """
    head = (inbox_id or "").split("@")[0].lower()
    slug = "".join(c for c in head if c.isalnum() or c == "-")
    return f"{prefix}-{slug}" if slug else prefix


def resolve_schedule(
    *,
    env: Mapping[str, str] | None = None,
    credentials_dir: str | None = None,
    inbox_id: str | None = None,
) -> dict[str, Any]:
    """Resolve everything needed to schedule, or explain plainly why we cannot.

    Returns ``{"status": "plan", "plan": {...}}`` with the command or instruction,
    verify and remove one-liners, and the pre-rendered block; or ``{"status":
    "unavailable", "message": ...}``, which still carries the prompt so the
    operator has something actionable — but never an unfilled placeholder.
    """
    env, credentials_dir = _defaults(env, credentials_dir)

    data = try_read_shared_json("help/watch_schedule.json")
    prompt_raw = try_read_shared_text("help/fragments/inbox_cron_agent_prompt.md")
    if not isinstance(data, dict) or not isinstance(prompt_raw, str):
        return {"status": "unavailable", "message": _SCHEDULE_FALLBACK}
    prompt_raw = prompt_raw.strip()
    if not prompt_raw:
        return {"status": "unavailable", "message": _SCHEDULE_FALLBACK}

    interval = data["interval"]
    block = data["block"]
    prompt = _fill(prompt_raw, {"CREDENTIALS_DIR": credentials_dir})
    base = {
        "CRON": interval["cron"],
        "HUMAN": interval["human"],
        "PRESET": interval["preset"],
        "TIME": interval["time"],
        "PROMPT": prompt,
        "JOB_NAME": _job_name(data["job_name_prefix"], inbox_id),
        # The prompt's read-only wording is prose; the host's tool allowlist is
        # what actually binds an unattended run that reads untrusted mail.
        "LEAST_PRIVILEGE": block["least_privilege"],
    }

    detection = detect_schedule(data, env=env)
    scheduler = detection.get("scheduler")

    if not scheduler:
        return {"status": "unavailable", "message": _fill(block["unknown"], base)}
    if scheduler == "none":
        label = detection.get("label") or detection.get("runtime") or "this runtime"
        return {
            "status": "unavailable",
            "message": _fill(block["no_scheduler"], {**base, "LABEL": label}),
        }

    spec = data["schedulers"].get(scheduler)
    if not spec:
        return {"status": "unavailable", "message": _fill(block["unknown"], base)}

    # A host with its own flag for restricting a job (OpenClaw's --tools,
    # Hermes' enabled_toolsets) gets that named instead of the generic advice.
    host_base = dict(base)
    if spec.get("least_privilege"):
        host_base["LEAST_PRIVILEGE"] = _fill(spec["least_privilege"], base)

    verify = _fill(spec["verify"], host_base)
    remove = _fill(spec["remove"], host_base)
    plan: dict[str, Any] = {
        "kind": spec["kind"],
        "runtime": detection["runtime"],
        "scheduler": scheduler,
        "label": spec["label"],
        "verify": verify,
        "remove": remove,
    }

    if spec["kind"] == "command":
        run_command = "\n".join(_fill(line, base) for line in spec.get("command", []))
        plan["run_command"] = run_command
        plan["setup_block"] = _fill(
            block["command"],
            {
                **host_base,
                "LABEL": spec["label"],
                "COMMAND": run_command,
                "VERIFY": verify,
                "REMOVE": remove,
            },
        )
    else:
        instruction = "\n".join(_fill(line, base) for line in spec.get("instruction", []))
        plan["instruction"] = instruction
        plan["setup_block"] = _fill(
            block["instruction"],
            {
                **host_base,
                "LABEL": spec["label"],
                "INSTRUCTION": instruction,
                "VERIFY": verify,
                "REMOVE": remove,
            },
        )

    return {"status": "plan", "plan": plan}


def watch_scheduled_setup(
    *,
    env: Mapping[str, str] | None = None,
    credentials_dir: str | None = None,
    inbox_id: str | None = None,
) -> str:
    """The watch="scheduled" text: the ready setup step for the detected runtime
    with verify + removal, or a plain explanation of why none could be produced.

    Nothing is executed here or by any caller — the agent drives its own scheduler,
    so the host's permission gate stays in the loop.
    """
    res = resolve_schedule(
        env=env, credentials_dir=credentials_dir, inbox_id=inbox_id
    )
    if res["status"] == "unavailable":
        return res["message"]
    return res["plan"]["setup_block"]


#: The skill CLI and the MCP adapter share one surface: both print, neither runs.
schedule_setup = watch_scheduled_setup
