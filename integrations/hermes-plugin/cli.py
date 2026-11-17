"""``hermes atomicmail setup`` and ``hermes atomicmail status``."""

from __future__ import annotations

import argparse
import getpass
import sys
import time
from typing import Optional

from .auth import AuthClient, AuthError, normalize_username
from .config import parse_address_list, read_settings
from .jmap import AtomicMailJmap, JmapError
from .sender_auth import dkim_available


def _save(key: str, value: str) -> None:
    from hermes_cli.config import save_env_value
    save_env_value(key, value)


def _ask(prompt: str, default: str = "", *, assume_yes: bool = False) -> str:
    if assume_yes:
        return default
    suffix = f" [{default}]" if default else ""
    try:
        answer = input(f"{prompt}{suffix}: ").strip()
    except EOFError:
        return default
    return answer or default


def _yes(prompt: str, default: bool = True, *, assume_yes: bool = False) -> bool:
    if assume_yes:
        return default
    answer = _ask(prompt + (" [Y/n]" if default else " [y/N]")).lower()
    return default if not answer else answer.startswith("y")


class _Progress:
    """Dots while the proof-of-work runs (about 20 s of CPU)."""

    def __init__(self) -> None:
        self.started = time.time()
        self.last = 0.0

    def __call__(self, nonce: int) -> None:
        now = time.time()
        if now - self.last >= 2:
            self.last = now
            sys.stdout.write(".")
            sys.stdout.flush()


def _create_inbox(settings, username: Optional[str], assume_yes: bool) -> tuple[str, str]:
    print("\nYour agent gets its own address <name>@atomicmail.ai. The name is permanent and shows on")
    print("every message it sends.")
    while True:
        name = username or _ask("Name for the agent's address (5-21 letters, digits, . _ -)")
        try:
            name = normalize_username(name)
            break
        except AuthError as exc:
            print(f"  {exc}")
            if username or assume_yes:
                raise SystemExit(2)
    print(f"Creating {name}@atomicmail.ai (proof-of-work, about 20 seconds)", end="")
    sys.stdout.flush()
    client = AuthClient(settings.auth_url)
    try:
        result = client.register(name, on_progress=_Progress())
    except AuthError as exc:
        print(f"\n  Could not create the inbox: {exc}")
        if "taken" in str(exc).lower() or "exists" in str(exc).lower() or "409" in str(exc):
            print("  That name is taken; pick another one.")
        raise SystemExit(1)
    finally:
        client.close()
    print(" done.")
    return result.api_key, result.address


def _check_key(settings, api_key: str) -> str:
    """Sign in with the key (proof-of-work, ~20 s) and return the inbox address."""
    print("Checking the key (proof-of-work, about 20 seconds)...")
    client = AtomicMailJmap(api_key, settings.auth_url, settings.api_url)
    try:
        address = client.address
        client.recent_messages(1)
        return address
    finally:
        client.close()


def cmd_setup(args: argparse.Namespace) -> int:
    settings = read_settings()
    assume_yes = bool(getattr(args, "yes", False))
    api_key, address = settings.api_key, settings.address

    if api_key and not getattr(args, "new", False) and not getattr(args, "api_key_stdin", False):
        try:
            address = _check_key(settings, api_key)
            print(f"Atomic Mail is already set up: {address}")
            if not _yes("Keep this inbox?", True, assume_yes=assume_yes):
                api_key = ""
        except JmapError as exc:
            print(f"The saved key does not work ({exc}).")
            api_key = ""

    created = False
    if not api_key:
        if getattr(args, "api_key_stdin", False):
            api_key = sys.stdin.readline().strip()
        elif getattr(args, "username", None) or getattr(args, "new", False) or assume_yes:
            api_key, address = _create_inbox(settings, getattr(args, "username", None), assume_yes)
            created = True
        else:
            print("\n  1) Create a new inbox for this agent (free, no account needed)")
            print("  2) Use an existing Atomic Mail inbox API key")
            choice = _ask("Choose", "1")
            if choice.strip() == "2":
                api_key = getpass.getpass("API key (hidden): ").strip()
            else:
                api_key, address = _create_inbox(settings, None, assume_yes)
                created = True
        if not api_key:
            print("No API key; nothing changed.")
            return 1
        if not created:
            try:
                address = _check_key(settings, api_key)
            except JmapError as exc:
                print(f"That key does not work: {exc}")
                return 1
        _save("ATOMICMAIL_API_KEY", api_key)
        _save("ATOMICMAIL_ADDRESS", address)
        print(f"Saved to Hermes's .env. The agent's address is {address}")

    allowed = parse_address_list(getattr(args, "allow", None) or "") or settings.allowed_users
    if not allowed or (not assume_yes and not getattr(args, "allow", None)):
        print("\nWho may give the agent instructions by email? Usually just your own address.")
        print("Mail from anyone else is ignored, and every sender is checked with DKIM.")
        raw = _ask("Allowed sender address(es), comma-separated", ",".join(sorted(allowed)), assume_yes=assume_yes)
        allowed = parse_address_list(raw)
    if allowed:
        _save("ATOMICMAIL_ALLOWED_USERS", ",".join(sorted(allowed)))
    else:
        print("  No allowed senders: the agent will not act on any inbound mail (tools still work).")

    home = (getattr(args, "home", None) or settings.home_address or (sorted(allowed)[0] if allowed else "")).lower()
    if home:
        _save("ATOMICMAIL_HOME_ADDRESS", home)

    print("\nDone. Next:")
    print("  hermes gateway run        (or restart your running gateway)")
    if allowed:
        print(f"  then email {address} from {sorted(allowed)[0]}")
    print("  hermes atomicmail status  to check everything")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    settings = read_settings()
    ok = True

    def line(label: str, value: str, good: bool = True) -> None:
        nonlocal ok
        ok = ok and good
        print(f"  {'✓' if good else '✗'} {label:<18} {value}")

    print("Atomic Mail")
    line("API key", "set" if settings.api_key else "missing (run `hermes atomicmail setup`)", bool(settings.api_key))
    if settings.api_key:
        try:
            line("Inbox", _check_key(settings, settings.api_key))
        except JmapError as exc:
            line("Inbox", str(exc), False)
    senders = ", ".join(sorted(settings.allowed_users)) or ("anyone" if settings.allow_all_users else "nobody")
    line("Allowed senders", senders, bool(settings.allowed_users) or settings.allow_all_users)
    if settings.trust_from_header:
        line("Sender check", "OFF (ATOMICMAIL_TRUST_FROM_HEADER=true)", True)
    elif not dkim_available():
        line("Sender check", "dkimpy missing: inbound mail is ignored", False)
    else:
        from .dkim_dns import make_dnsfunc, system_txt
        probe = "20230601._domainkey.gmail.com"
        system_ok = bool(system_txt(probe)[0])
        any_ok = system_ok or bool(make_dnsfunc(settings.dns_over_https)(probe))
        how = "system DNS" if system_ok else ("DNS-over-HTTPS fallback" if any_ok else "no DNS answers")
        line("Sender check", f"DKIM ({how})", any_ok)
    line("Cron deliveries", settings.home_address or "not set")
    line("Poll interval", f"{settings.poll_interval}s")
    if settings.address:
        from . import state as state_store
        rejection = state_store.load(settings.address).get("last_rejection")
        if rejection:
            print(f"  · Last ignored mail: {rejection.get('from')} at {rejection.get('at')}: {rejection.get('reason')}")
    return 0 if ok else 1


def setup_argparse(subparser: argparse.ArgumentParser) -> None:
    subs = subparser.add_subparsers(dest="atomicmail_command")
    setup = subs.add_parser("setup", help="Create the agent's inbox (or use a key) and choose who may write to it")
    setup.add_argument("--username", help="Create a new inbox <username>@atomicmail.ai")
    setup.add_argument("--new", action="store_true", help="Create a new inbox even if one is configured")
    setup.add_argument("--api-key-stdin", action="store_true", help="Read an existing inbox API key from stdin")
    setup.add_argument("--allow", help="Comma-separated sender addresses allowed to instruct the agent")
    setup.add_argument("--home", help="Address for cron deliveries (default: the first allowed sender)")
    setup.add_argument("-y", "--yes", action="store_true", help="No prompts")
    subs.add_parser("status", help="Check the key, the inbox, allowed senders and the sender check")
    subparser.set_defaults(func=handle_cli)


def handle_cli(args: argparse.Namespace) -> int:
    command = getattr(args, "atomicmail_command", None)
    if command == "setup":
        return cmd_setup(args)
    if command == "status":
        return cmd_status(args)
    print("Usage: hermes atomicmail <setup|status>")
    return 1
