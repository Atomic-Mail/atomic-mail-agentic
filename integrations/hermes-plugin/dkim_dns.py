"""DKIM key lookups: the system resolver first, DNS-over-HTTPS when it returns nothing.

Some networks (VPNs, captive resolvers) answer every TXT query with an empty
result, which would make every DKIM check fail. In ``auto`` mode a lookup that
gets no answer is retried over HTTPS at Cloudflare (1.1.1.1), then Google.
"""

from __future__ import annotations

import logging
import re
from typing import Callable, Optional

import httpx

logger = logging.getLogger(__name__)

DOH_ENDPOINTS = ("https://cloudflare-dns.com/dns-query", "https://dns.google/resolve")
_QUOTED = re.compile(r'"((?:[^"\\]|\\.)*)"')
_ESCAPE = re.compile(r"\\(\d{3}|.)")


def _unescape(chunk: str) -> bytes:
    def repl(match: re.Match) -> str:
        token = match.group(1)
        return chr(int(token)) if token.isdigit() else token
    return _ESCAPE.sub(repl, chunk).encode("latin-1", "replace")


def parse_txt_rdata(data: str) -> bytes:
    """``"v=DKIM1; k=rsa; " "p=MIIB..."`` -> ``b"v=DKIM1; k=rsa; p=MIIB..."``."""
    chunks = _QUOTED.findall(data or "")
    if not chunks:
        return (data or "").strip().encode("latin-1", "replace")
    return b"".join(_unescape(chunk) for chunk in chunks)


def _pick(records: list[bytes]) -> Optional[bytes]:
    records = [r for r in records if r]
    for record in records:
        if record.lstrip().lower().startswith(b"v=dkim1") or b"p=" in record:
            return record
    return records[0] if records else None


def doh_txt(name: str, *, transport: Optional[httpx.BaseTransport] = None, timeout: float = 5.0) -> Optional[bytes]:
    with httpx.Client(timeout=timeout, transport=transport, headers={"accept": "application/dns-json"}) as client:
        for endpoint in DOH_ENDPOINTS:
            try:
                reply = client.get(endpoint, params={"name": name, "type": "TXT"}).json()
            except (httpx.HTTPError, ValueError):
                continue
            if reply.get("Status") == 3:  # NXDOMAIN: the key really does not exist
                return None
            answers = [parse_txt_rdata(a.get("data", "")) for a in reply.get("Answer") or [] if a.get("type") == 16]
            picked = _pick(answers)
            if picked:
                return picked
    return None


def system_txt(name: str, timeout: float = 5.0) -> tuple[Optional[bytes], bool]:
    """``(record, authoritative_miss)``; the flag is True for NXDOMAIN, which DoH should not second-guess."""
    try:
        import dns.resolver
    except Exception:  # noqa: BLE001
        return None, False
    try:
        answers = dns.resolver.resolve(name, "TXT", lifetime=timeout)
    except dns.resolver.NXDOMAIN:
        return None, True
    except Exception:  # noqa: BLE001 - NoAnswer, timeouts, broken resolvers
        return None, False
    return _pick([b"".join(rdata.strings) for rdata in answers]), False


def make_dnsfunc(mode: str = "auto", *, transport: Optional[httpx.BaseTransport] = None) -> Callable:
    """A ``dnsfunc(name, timeout=5)`` for dkimpy. ``mode``: auto | always | off."""
    mode = (mode or "auto").strip().lower()

    def dnsfunc(name, timeout=5):
        qname = (name.decode() if isinstance(name, bytes) else str(name)).rstrip(".")
        if mode != "always":
            record, nxdomain = system_txt(qname, timeout)
            if record or nxdomain or mode == "off":
                return record
        record = doh_txt(qname, transport=transport, timeout=float(timeout))
        if record and mode == "auto":
            logger.debug("[Atomic Mail] DKIM key for %s came from DNS-over-HTTPS", qname)
        return record

    return dnsfunc
