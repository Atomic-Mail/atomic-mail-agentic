"""Who really sent this mail? DKIM verification plus a small RFC 5322 reader.

Atomic Mail does not yet stamp sender-authentication results on inbound mail,
so the plugin checks DKIM itself before an allowlisted From: may drive the
agent: at least one valid signature whose ``d=`` domain aligns with the From:
domain (same domain, or one a subdomain of the other). Signatures with an
``l=`` body-length tag are ignored, since text can be appended after them.
"""

from __future__ import annotations

import email
import email.policy
import html
import logging
import re
from dataclasses import dataclass, field
from email.message import Message
from email.utils import getaddresses, parseaddr
from typing import Callable, Optional

logger = logging.getLogger(__name__)

AUTOMATED_LOCAL_PARTS = re.compile(
    r"^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounces?|notifications?|daemon)([+.-].*)?$", re.I)


@dataclass
class Verdict:
    ok: bool
    reason: str
    signing_domain: str = ""


@dataclass
class ParsedMail:
    from_addr: str
    from_name: str
    subject: str
    text: str
    message_id: str
    in_reply_to: str
    automated: bool
    attachments: list[str] = field(default_factory=list)
    from_header_count: int = 1


def _domain(address: str) -> str:
    return address.rsplit("@", 1)[-1].strip().lower().rstrip(".") if "@" in address else ""


def domains_aligned(from_domain: str, signing_domain: str) -> bool:
    a, b = from_domain.lower().rstrip("."), signing_domain.lower().rstrip(".")
    return bool(a and b) and (a == b or a.endswith("." + b) or b.endswith("." + a))


def dkim_available() -> bool:
    try:
        import dkim  # noqa: F401
    except Exception:  # noqa: BLE001
        return False
    return True


def verify_dkim(raw: bytes, from_addr: str, *, dnsfunc: Optional[Callable] = None) -> Verdict:
    """True only for a valid, aligned DKIM signature without an ``l=`` tag."""
    try:
        import dkim
    except Exception:  # noqa: BLE001
        return Verdict(False, "dkimpy is not installed")
    from_domain = _domain(from_addr)
    if not from_domain:
        return Verdict(False, "no From: address")
    count = len(re.findall(rb"(?im)^dkim-signature\s*:", raw.split(b"\r\n\r\n", 1)[0].split(b"\n\n", 1)[0]))
    if count == 0:
        return Verdict(False, "message is not DKIM-signed")
    reasons = []
    for idx in range(count):
        checker = dkim.DKIM(raw, logger=logger)
        try:
            kwargs = {"idx": idx}
            if dnsfunc is not None:
                kwargs["dnsfunc"] = dnsfunc
            valid = checker.verify(**kwargs)
        except Exception as exc:  # noqa: BLE001 - malformed signatures, DNS errors
            reasons.append(f"signature {idx + 1}: {exc.__class__.__name__}")
            continue
        fields = getattr(checker, "signature_fields", {}) or {}
        signing = (fields.get(b"d") or getattr(checker, "domain", b"") or b"").decode("ascii", "replace")
        if not valid:
            reasons.append(f"signature {idx + 1} ({signing or '?'}) does not verify")
            continue
        if b"l" in fields:
            reasons.append(f"signature {idx + 1} ({signing}) uses l= (body length), ignored")
            continue
        if domains_aligned(from_domain, signing):
            return Verdict(True, "dkim=pass", signing)
        reasons.append(f"signature {idx + 1} is for {signing}, not {from_domain}")
    return Verdict(False, "; ".join(reasons) or "no valid signature")


def _decode_part(part: Message) -> str:
    try:
        content = part.get_content()
    except Exception:  # noqa: BLE001
        payload = part.get_payload(decode=True) or b""
        content = payload.decode(part.get_content_charset() or "utf-8", "replace")
    return content if isinstance(content, str) else ""


def _strip_html(markup: str) -> str:
    markup = re.sub(r"(?is)<(script|style).*?</\1>", " ", markup)
    markup = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>", "\n", markup)
    text = html.unescape(re.sub(r"<[^>]+>", " ", markup))
    return re.sub(r"[ \t]+", " ", re.sub(r"\n\s*\n+", "\n\n", text)).strip()


QUOTE_MARKERS = re.compile(
    r"^(On .{5,200} wrote:|-----Original Message-----|From: .+|Le .{5,200} a écrit\s*:|Am .{5,200} schrieb .+:)\s*$")


def strip_quoted_reply(text: str) -> str:
    """Drop the quoted history under a reply, so the agent reads only the new part."""
    lines = text.splitlines()
    out: list[str] = []
    for line in lines:
        if QUOTE_MARKERS.match(line.strip()) or line.lstrip().startswith(">"):
            break
        out.append(line)
    trimmed = "\n".join(out).strip()
    return trimmed or text.strip()


def parse_mail(raw: bytes) -> ParsedMail:
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    from_headers = msg.get_all("From") or []
    name, addr = parseaddr(str(from_headers[0])) if from_headers else ("", "")
    body_part = msg.get_body(preferencelist=("plain", "html"))
    text = ""
    if body_part is not None:
        text = _decode_part(body_part)
        if body_part.get_content_type() == "text/html":
            text = _strip_html(text)
    attachments = [part.get_filename() or part.get_content_type() for part in msg.iter_attachments()]
    auto_submitted = str(msg.get("Auto-Submitted", "no")).strip().lower()
    precedence = str(msg.get("Precedence", "")).strip().lower()
    automated = (
        not addr
        or auto_submitted not in ("", "no")
        or precedence in ("bulk", "junk", "list", "auto_reply")
        or bool(msg.get("X-Autoreply") or msg.get("X-Autorespond") or msg.get("List-Id"))
        or is_automated_address(addr)
    )
    return ParsedMail(
        from_addr=addr.strip().lower(),
        from_name=name.strip(),
        subject=str(msg.get("Subject", "") or "").strip(),
        text=text.strip(),
        message_id=str(msg.get("Message-ID", "") or "").strip(),
        in_reply_to=str(msg.get("In-Reply-To", "") or "").strip(),
        automated=automated,
        attachments=[a for a in attachments if a],
        from_header_count=len(from_headers),
    )


def first_address(field_value) -> tuple[str, str]:
    """``(email, name)`` from the MCP's ``[{name, email}]`` list or a raw header string."""
    if isinstance(field_value, list) and field_value:
        first = field_value[0] or {}
        if isinstance(first, dict):
            return str(first.get("email") or "").strip().lower(), str(first.get("name") or "").strip()
    if isinstance(field_value, str):
        pairs = getaddresses([field_value])
        if pairs:
            return pairs[0][1].strip().lower(), pairs[0][0].strip()
    return "", ""


def is_automated_address(address: str) -> bool:
    return bool(AUTOMATED_LOCAL_PARTS.match(address.split("@", 1)[0])) if address else True
