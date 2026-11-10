"""Atomic Mail Agentic for Hermes Agent: the agent's own email address, as a gateway channel plus tools."""

from __future__ import annotations

import dataclasses
import logging
from pathlib import Path
from typing import Any, Optional

__version__ = "0.1.0"

logger = logging.getLogger(__name__)

PLATFORM_HINT = (
    "You are talking by email through your own Atomic Mail inbox. Each inbound message comes from an "
    "allowlisted sender whose DKIM signature was verified. Your reply is sent as a plain-text email in the "
    "same thread: no markdown, no greeting or sign-off unless it fits. Use the atomicmail_* tools to read your "
    "inbox, send new mail or schedule meetings with real calendar invitations; before writing to anyone the "
    "user did not name, or sending an invitation, confirm recipients, date, time and time zone."
)


def check_requirements() -> bool:
    """Passive probe: is a key configured? Never installs anything."""
    from .config import read_settings
    return read_settings().configured


def _validate_config(config: Any) -> bool:
    from .config import read_settings
    return read_settings(getattr(config, "extra", None) or {}).configured


def _env_enablement() -> Optional[dict]:
    from .config import read_settings
    settings = read_settings()
    if not settings.configured:
        return None
    seed: dict = {"configured": True}
    if settings.address:
        seed["address"] = settings.address
    # No home_channel on purpose: the gateway mails its home channel on every start, restart and
    # shutdown, which is noise in an inbox. Cron jobs still reach ATOMICMAIL_HOME_ADDRESS through
    # cron_deliver_env_var.
    return seed


def _build_adapter(config: Any):
    from .adapter import AtomicMailAdapter
    return AtomicMailAdapter(config)


async def _standalone_send(pconfig: Any, chat_id: str, message: str, *, thread_id: Optional[str] = None,
                           media_files: Optional[list] = None, force_document: bool = False, **_kwargs: Any) -> dict:
    """Cron delivery without a running gateway: one new email to ``chat_id``."""
    import asyncio

    from .config import read_settings
    from .jmap import JmapError, shared_client

    settings = read_settings(getattr(pconfig, "extra", None) or {})
    if not settings.configured:
        return {"error": "Atomic Mail is not set up (run `hermes atomicmail setup`)."}
    client = shared_client(settings.api_key, settings.auth_url, settings.api_url)
    try:
        await asyncio.to_thread(client.send, chat_id, "Update from your Hermes agent", message)
        return {"success": True, "platform": "atomicmail", "chat_id": chat_id}
    except JmapError as exc:
        return {"error": f"Atomic Mail send failed: {exc}"}


def _register_skills(ctx: Any) -> None:
    skills_dir = Path(__file__).parent / "skills"
    if not skills_dir.is_dir() or not hasattr(ctx, "register_skill"):
        return
    for child in sorted(skills_dir.iterdir()):
        skill_md = child / "SKILL.md"
        if child.is_dir() and skill_md.is_file():
            ctx.register_skill(child.name, skill_md,
                               description="Using the agent's own Atomic Mail inbox: email, replies, meetings")


def _platform_kwargs() -> dict:
    kwargs: dict = dict(
        name="atomicmail",
        label="Atomic Mail",
        adapter_factory=_build_adapter,
        check_fn=check_requirements,
        validate_config=_validate_config,
        is_connected=_validate_config,
        required_env=["ATOMICMAIL_API_KEY"],
        install_hint="Run `hermes atomicmail setup`: it creates the agent's inbox (no account needed).",
        env_enablement_fn=_env_enablement,
        cron_deliver_env_var="ATOMICMAIL_HOME_ADDRESS",
        standalone_sender_fn=_standalone_send,
        allowed_users_env="ATOMICMAIL_ALLOWED_USERS",
        allow_all_env="ATOMICMAIL_ALLOW_ALL_USERS",
        max_message_length=50_000,
        pii_safe=True,
        emoji="📧",
        allow_update_command=False,
        platform_hint=PLATFORM_HINT,
    )
    optional = {
        "display_tier": "minimal",
        "allowlist_suppresses_pairing": True,
        "dashboard_description": "The agent's own @atomicmail.ai address: email it like a chat, DKIM-checked.",
        "docs_url": "https://github.com/Atomic-Mail/atomic-mail-agentic/tree/main/integrations/hermes-plugin",
        "dashboard_env_vars": ("ATOMICMAIL_API_KEY", "ATOMICMAIL_ALLOWED_USERS"),
        "dashboard_required_env": ("ATOMICMAIL_API_KEY",),
    }
    try:
        from gateway.platform_registry import PlatformEntry
        known = {f.name for f in dataclasses.fields(PlatformEntry)}
    except Exception:  # noqa: BLE001 - older cores: register only the base fields
        known = set()
    kwargs.update({key: value for key, value in optional.items() if key in known})
    return kwargs


def register(ctx: Any) -> None:
    """Plugin entry point, called by the Hermes plugin system."""
    from .tools import register_tools

    ctx.register_platform(**_platform_kwargs())
    register_tools(ctx)
    _register_skills(ctx)
    if hasattr(ctx, "register_cli_command"):
        from .cli import handle_cli, setup_argparse
        ctx.register_cli_command(
            name="atomicmail",
            help="Atomic Mail: `setup` creates the agent's inbox, `status` checks it",
            setup_fn=setup_argparse,
            handler_fn=handle_cli,
        )
