from __future__ import annotations

import re

from atomicmail.register_watch import (
    detect_schedule,
    schedule_setup,
    watch_scheduled_setup,
)
from atomicmail.shared_assets import read_shared_json, read_shared_text

DATA = read_shared_json("help/watch_schedule.json")
PROMPT = read_shared_text("help/fragments/inbox_cron_agent_prompt.md").strip()

COMMAND_HOSTS = [
    "openclaw cron add",
    "hermes cron create",
    "atomic-agent task create",
]

# Every block must constrain what the scheduled job may do. Hosts with their own
# flag name it; the rest get the generic wording.
PRIVILEGE_MARKERS = [
    "--tools exec",       # OpenClaw
    "enabled_toolsets",   # Hermes
    "connector",          # Claude Code routines
    "tool allowlist",     # generic
]

# OS-level scheduling is deliberately not generated: it runs outside the host's
# permission model, and AGENTS.md forbids it. These are the *recipes* — the
# blocks may still name launchd or crontab in order to forbid them.
OS_RECIPES = [
    "launchctl load",
    "launchctl unload",
    "systemctl --user",
    "| crontab -",
    "crontab -l",
    "LaunchAgents",
    "<plist",
]

# A fill-me placeholder like <your-agent-command>, or an unfilled {TOKEN}.
ANGLE_PLACEHOLDER = re.compile(
    r"<[^>\n]*(your|agent|command|placeholder|todo)[^>\n]*>", re.IGNORECASE
)
CURLY_TOKEN = re.compile(r"\{[A-Z_]+\}")

DIR = "/tmp/creds"

ALL_ENVS = [
    {"CLAUDECODE": "1"},
    {"OPENCLAW_HOME": "/x"},
    {"HERMES_SESSION": "1"},
    {"ATOMIC_AGENT": "1"},
    {"CURSOR_AGENT": "1"},
    {},
]


def _detect(markers):
    return detect_schedule(DATA, env=markers)


def _block(markers, credentials_dir=DIR):
    return watch_scheduled_setup(env=markers, credentials_dir=credentials_dir)


def test_detect_runtime_marker_picks_the_caller() -> None:
    assert _detect({"OPENCLAW_HOME": "/x"}) == {
        "runtime": "openclaw",
        "scheduler": "openclaw",
    }
    assert _detect({"HERMES_SESSION": "1"}) == {
        "runtime": "hermes",
        "scheduler": "hermes",
    }
    assert _detect({"CLAUDECODE": "1"}) == {
        "runtime": "claude-code",
        "scheduler": "claude-code",
    }


def test_detect_ignores_what_is_merely_installed() -> None:
    """PATH is not consulted at all: only the caller's own marker counts."""
    assert _detect({"CLAUDECODE": "1", "OPENCLAW_HOME": ""})["scheduler"] == "claude-code"
    assert _detect({}) == {}


def test_command_host_gets_exactly_one_command() -> None:
    block = _block({"OPENCLAW_HOME": "/x"})
    assert 'watch="scheduled"' in block
    assert "openclaw cron add" in block
    assert "0 9 * * *" in block
    assert "--tools exec" in block
    assert "openclaw cron list" in block
    assert "hermes cron create" not in block
    assert "atomic-agent task create" not in block


def test_claude_gets_a_routine_instruction_not_a_shell_command() -> None:
    block = _block({"CLAUDECODE": "1"})
    assert "atomicmail-inbox" in block
    assert "Routines" in block
    # /loop expires after seven days — the block must warn against it.
    assert "/loop" in block
    for cmd in COMMAND_HOSTS:
        assert cmd not in block


def test_no_os_level_scheduling_recipe_is_ever_emitted() -> None:
    for markers in ALL_ENVS:
        block = _block(markers)
        for token in OS_RECIPES:
            assert token not in block, f"{token} leaked for {markers}"


def test_runtime_without_durable_scheduler_asks_the_operator() -> None:
    block = _block({"CURSOR_AGENT": "1"})
    assert "Cursor" in block
    assert "operator" in block
    # Still actionable: the prompt is handed over even with nothing to install.
    assert "list_inbox.json" in block
    for cmd in COMMAND_HOSTS:
        assert cmd not in block


def test_unknown_runtime_emits_no_command_and_no_placeholder() -> None:
    block = _block({})
    assert 'watch="scheduled"' in block
    assert "operator" in block
    for cmd in COMMAND_HOSTS:
        assert cmd not in block


def test_never_emits_an_unfilled_placeholder() -> None:
    for markers in ALL_ENVS:
        block = _block(markers)
        assert not ANGLE_PLACEHOLDER.search(block), markers
        assert not CURLY_TOKEN.search(block), markers


def test_credentials_dir_is_baked_into_the_prompt() -> None:
    """Scheduled sessions inherit no environment, so the path must be literal."""
    for markers in ALL_ENVS:
        block = _block(markers, credentials_dir=DIR)
        assert "--credentials-dir /tmp/creds" in block, markers
        assert "ATOMIC_MAIL_CREDENTIALS_DIR" not in block, markers


def test_credentials_dir_falls_back_to_the_env_then_the_default() -> None:
    from_env = _block(
        {"OPENCLAW_HOME": "/x", "ATOMIC_MAIL_CREDENTIALS_DIR": "/from/env"},
        credentials_dir=None,
    )
    assert "--credentials-dir /from/env" in from_env
    default = _block({"OPENCLAW_HOME": "/x"}, credentials_dir=None)
    assert "--credentials-dir ~/.atomicmail" in default


def test_every_block_demands_a_least_privilege_tool_allowlist() -> None:
    """Prose cannot bind an unattended run; the host's allowlist can.

    A real OpenClaw run reached exec/write/cron/spawn through the *unknown*
    branch, where the agent improvises the job and needs this advice most.
    """
    for markers in ALL_ENVS:
        block = _block(markers)
        assert any(m in block for m in PRIVILEGE_MARKERS), markers


def test_scheduled_prompt_is_read_only() -> None:
    """The job runs unattended, so it must carry no outbound authority."""
    lowered = PROMPT.lower()
    for verb in ["reply", "forward", "send", "delete"]:
        assert f"do not {verb}" in lowered or verb in lowered.split("do not", 1)[-1]
    assert "stay available" not in lowered
    assert "read-only" in lowered


def test_prompt_has_no_double_quotes_so_shell_embedding_is_safe() -> None:
    """The prompt is embedded inside a double-quoted shell argument."""
    assert '"' not in PROMPT


def test_schedule_setup_is_the_same_surface_as_the_mcp_one() -> None:
    """Both wrappers print; neither installs."""
    assert schedule_setup is watch_scheduled_setup


def test_job_name_carries_the_inbox_so_two_inboxes_cannot_collide() -> None:
    """Multi-account is supported; one fixed name across N inboxes loses N-1."""
    a = watch_scheduled_setup(
        env={"OPENCLAW_HOME": "/x"}, credentials_dir=DIR, inbox_id="alice@atomicmail.ai"
    )
    b = watch_scheduled_setup(
        env={"OPENCLAW_HOME": "/x"}, credentials_dir=DIR, inbox_id="bob@atomicmail.ai"
    )
    assert "atomicmail-inbox-alice" in a
    assert "atomicmail-inbox-bob" in b
    # And the block warns rather than silently overwriting someone else's job.
    assert "do not overwrite it" in a


def test_job_name_is_slugged_not_quoted() -> None:
    """The name lands in a shell command, so unsafe characters are dropped."""
    out = watch_scheduled_setup(
        env={"OPENCLAW_HOME": "/x"},
        credentials_dir=DIR,
        inbox_id='ali"ce; rm -rf /@atomicmail.ai',
    )
    assert "atomicmail-inbox-alicerm-rf" in out
    assert "rm -rf /" not in out


def test_job_name_falls_back_when_the_inbox_is_unknown() -> None:
    out = watch_scheduled_setup(env={"OPENCLAW_HOME": "/x"}, credentials_dir=DIR)
    assert "atomicmail-inbox" in out
