"""Hermes gateway channel for an Atomic Mail inbox.

Inbound: polls the inbox over JMAP. A new message from an allowlisted address
is downloaded raw and must carry a valid, aligned DKIM signature before it
reaches the agent. Outbound: the agent's answer goes back as a reply in the
same thread.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any, Optional

from gateway.config import Platform, PlatformConfig
from gateway.platforms.base import BasePlatformAdapter, SendResult
from gateway.platforms.event import MessageEvent, MessageType

from . import state as state_store
from .config import Settings, parse_address_list, read_settings, secret
from .dkim_dns import make_dnsfunc
from .jmap import AtomicMailJmap, JmapError, shared_client
from .sender_auth import (
    dkim_available,
    first_address,
    is_automated_address,
    parse_mail,
    strip_quoted_reply,
    verify_dkim,
)

logger = logging.getLogger(__name__)

PLATFORM_NAME = "atomicmail"
REPLAY_WINDOW_S = 24 * 3600
MAX_FETCH_ATTEMPTS = 3
FATAL_AFTER = 3
DEFAULT_SUBJECT = "Message from your Hermes agent"


def make_client(settings: Settings) -> AtomicMailJmap:
    return shared_client(settings.api_key, settings.auth_url, settings.api_url)


def _received_ts(row: dict) -> float:
    raw = row.get("receivedAt")
    if not raw:
        return time.time()
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return time.time()


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class AtomicMailAdapter(BasePlatformAdapter):
    """One Atomic Mail inbox as a Hermes chat platform (each sender address is a DM)."""

    serial_receive_loop = True
    splits_long_messages = True

    def __init__(self, config: PlatformConfig):
        super().__init__(config, Platform(PLATFORM_NAME))
        self._settings: Settings = read_settings(getattr(config, "extra", None) or {})
        self._address = self._settings.address
        self._jmap: Optional[AtomicMailJmap] = None
        self._poll_task: Optional[asyncio.Task] = None
        self._seen: "OrderedDict[str, None]" = OrderedDict()
        self._attempts: dict[str, int] = {}
        self._thread_ctx: dict[str, dict[str, str]] = {}
        self._ready = False
        self._dnsfunc = make_dnsfunc(self._settings.dns_over_https)

    # ------------------------------------------------------------------ lifecycle

    async def connect(self, *, is_reconnect: bool = False) -> bool:
        s = self._settings
        if not s.api_key:
            self._set_fatal_error("atomicmail_not_configured",
                                  "ATOMICMAIL_API_KEY is not set. Run `hermes atomicmail setup`.", retryable=False)
            return False
        self._jmap = make_client(s)
        self._ready = False

        if not s.allowed_users and not s.allow_all_users and not self._global_allowlist():
            logger.warning("[Atomic Mail] No allowed senders (ATOMICMAIL_ALLOWED_USERS); inbound mail will be "
                           "ignored. Run `hermes atomicmail setup` to add your address.")
        if not s.trust_from_header and not dkim_available():
            logger.warning("[Atomic Mail] dkimpy is missing, so no sender can be verified and inbound mail "
                           "will be ignored. Reinstall the plugin to get its dependencies.")

        # Signing in costs a proof-of-work (~20-45 s of CPU), longer than the gateway's connect timeout,
        # so it happens in the poll loop: connect() only starts the loop.
        self._running = True
        self._poll_task = asyncio.create_task(self._poll_loop())
        self._mark_connected()
        print(f"[Atomic Mail] Signing in as {self._address or 'the configured inbox'} (proof-of-work, ~30 s)")
        return True

    async def _sign_in(self) -> None:
        self._address = await asyncio.to_thread(lambda: self._jmap.address)  # type: ignore[union-attr]
        await self._baseline()
        self._ready = True
        logger.info("[Atomic Mail] Listening as %s", self._address)
        print(f"[Atomic Mail] Listening as {self._address}")

    async def disconnect(self) -> None:
        self._running = False
        task, self._poll_task = self._poll_task, None
        if task and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        self._jmap = None  # the shared client stays open for the tools in this process
        self._mark_disconnected()
        logger.info("[Atomic Mail] Disconnected")

    # ------------------------------------------------------------------ inbound

    async def _baseline(self) -> None:
        stored = state_store.load(self._address)
        if stored.get("initialized"):
            self._seen = OrderedDict.fromkeys(stored.get("seen") or [])
            return
        rows = await asyncio.to_thread(self._jmap.recent_messages, 30)  # type: ignore[union-attr]
        # Mail that was already there before the first start is history, not a request.
        self._seen = OrderedDict.fromkeys(row["id"] for row in rows)
        self._save_state()

    def _save_state(self, last_rejection: Optional[dict] = None) -> None:
        while len(self._seen) > state_store.MAX_SEEN:
            self._seen.popitem(last=False)
        state_store.save(self._address, seen=self._seen.keys(), last_rejection=last_rejection)

    async def _poll_loop(self) -> None:
        failures = hard_failures = 0
        while self._running:
            delay = float(self._settings.poll_interval)
            try:
                if not self._ready:
                    await self._sign_in()
                await self._check_inbox()
                failures = hard_failures = 0
            except asyncio.CancelledError:
                break
            except JmapError as exc:
                failures += 1
                # Only a hard error several times in a row (a dead key, a suspended inbox) parks the
                # channel; timeouts and expired challenges back off and try again.
                hard_failures = 0 if exc.retryable else hard_failures + 1
                if hard_failures >= FATAL_AFTER:
                    self._set_fatal_error("atomicmail_auth", str(exc), retryable=False)
                    await self._notify_fatal_error()
                    break
                delay = min(300.0, delay * (2 ** min(failures, 4)))
                if failures == 1 or failures % 10 == 0:
                    logger.warning("[Atomic Mail] Inbox check failed (%s); retrying in %.0fs", exc, delay)
            except Exception as exc:  # noqa: BLE001
                failures += 1
                delay = min(300.0, delay * 2)
                logger.exception("[Atomic Mail] Inbox check crashed: %s", exc)
            try:
                await asyncio.sleep(delay)
            except asyncio.CancelledError:
                break

    async def _check_inbox(self) -> None:
        rows = await asyncio.to_thread(self._jmap.recent_messages, 30)  # type: ignore[union-attr]
        fresh = sorted((row for row in rows if row["id"] not in self._seen), key=_received_ts)
        for row in fresh:
            if not self._running:
                return
            message_id = row["id"]
            # Mark first: a crash mid-dispatch must not replay a command twice.
            self._seen[message_id] = None
            self._save_state()
            if time.time() - _received_ts(row) > REPLAY_WINDOW_S:
                continue
            try:
                await self._process(row)
            except JmapError as exc:
                attempts = self._attempts.get(message_id, 0) + 1
                self._attempts[message_id] = attempts
                if exc.retryable and attempts < MAX_FETCH_ATTEMPTS:
                    self._seen.pop(message_id, None)  # try again on the next poll
                    self._save_state()
                    logger.info("[Atomic Mail] Will retry message %s: %s", message_id, exc)
                else:
                    logger.warning("[Atomic Mail] Skipped message %s: %s", message_id, exc)

    def _global_allowlist(self) -> frozenset[str]:
        return parse_address_list(secret("GATEWAY_ALLOWED_USERS", ""))

    def _sender_listed(self, sender: str) -> bool:
        s = self._settings
        if sender in s.allowed_users or sender in self._global_allowlist():
            return True
        return s.allow_all_users and not s.allowed_users

    def _reject(self, sender: str, reason: str) -> None:
        logger.warning("[Atomic Mail] Ignored mail from %s: %s", sender, reason)
        self._save_state(last_rejection={"from": sender, "reason": reason, "at": _now_iso()})

    async def _process(self, row: dict) -> None:
        sender, display_name = first_address(row.get("from"))
        if not sender or sender == self._address or is_automated_address(sender):
            return
        if not self._sender_listed(sender):
            logger.info("[Atomic Mail] Ignored mail from %s: not in ATOMICMAIL_ALLOWED_USERS", sender)
            self._save_state(last_rejection={"from": sender, "reason": "not an allowed sender", "at": _now_iso()})
            return
        jmap = self._jmap
        if jmap is None:
            return

        if self._settings.trust_from_header:
            message = await asyncio.to_thread(jmap.get_message, row["id"])
            subject = str(message.get("subject") or "")
            body = jmap.body_text(message)
            attachments = [str(a.get("name") or a.get("type") or "file") for a in message.get("attachments") or []]
        else:
            raw = await asyncio.to_thread(jmap.raw_message, row["id"])
            parsed = parse_mail(raw)
            if parsed.from_header_count != 1:
                return self._reject(sender, "message has %d From: headers" % parsed.from_header_count)
            if parsed.from_addr != sender:
                return self._reject(sender, f"From: header says {parsed.from_addr or 'nothing'}")
            if parsed.automated:
                logger.info("[Atomic Mail] Ignored automated mail (auto-reply or list) from %s", sender)
                return
            verdict = await asyncio.to_thread(verify_dkim, raw, parsed.from_addr, dnsfunc=self._dnsfunc)
            if not verdict.ok:
                return self._reject(sender, f"sender not verified ({verdict.reason})")
            subject, body, attachments = parsed.subject, parsed.text, parsed.attachments
            display_name = parsed.from_name or display_name

        is_reply = subject.lower().startswith(("re:", "aw:", "fw:", "fwd:"))
        text = strip_quoted_reply(body) if is_reply else body.strip()
        if subject and not is_reply:
            text = f"[Subject: {subject}]\n\n{text}"
        if attachments:
            text += "\n\n[Attachments not opened: " + ", ".join(attachments[:10]) + "]"

        self._thread_ctx[sender] = {"message_id": row["id"], "subject": subject}
        name = display_name or sender
        event = MessageEvent(
            text=text.strip() or "(empty email)",
            message_type=MessageType.TEXT,
            source=self.build_source(chat_id=sender, chat_name=name, chat_type="dm", user_id=sender,
                                     user_name=name, message_id=row["id"]),
            message_id=row["id"],
        )
        logger.info("[Atomic Mail] Mail from %s: %s", sender, subject or "(no subject)")
        await self.handle_message(event)

    # ------------------------------------------------------------------ outbound

    async def send(self, chat_id: str, content: str, reply_to: Optional[str] = None,
                   metadata: Optional[dict[str, Any]] = None) -> SendResult:
        jmap = self._jmap or (make_client(self._settings) if self._settings.api_key else None)
        if jmap is None:
            return SendResult(success=False, error="Atomic Mail is not configured")
        chat = (chat_id or "").strip().lower()
        target = reply_to if reply_to and reply_to in self._seen else None
        target = target or self._thread_ctx.get(chat, {}).get("message_id")
        try:
            if target:
                result = await asyncio.to_thread(jmap.reply, target, content)
            else:
                result = await asyncio.to_thread(jmap.send, chat, DEFAULT_SUBJECT, content)
        except JmapError as exc:
            logger.error("[Atomic Mail] Send to %s failed: %s", chat, exc)
            return SendResult(success=False, error=str(exc), retryable=exc.retryable)
        return SendResult(success=True, message_id=str(result.get("email_id") or target or ""))

    async def get_chat_info(self, chat_id: str) -> dict[str, Any]:
        ctx = self._thread_ctx.get((chat_id or "").lower(), {})
        return {"name": chat_id, "type": "dm", "chat_id": chat_id, "subject": ctx.get("subject", "")}
