"""DKIM key lookups with the DNS-over-HTTPS fallback."""

from __future__ import annotations

import httpx

from atomicmail_plugin import dkim_dns


def test_parse_txt_rdata_joins_chunks_and_unescapes():
    assert dkim_dns.parse_txt_rdata('"v=DKIM1; k=rsa; " "p=MIIB\\"x\\""') == b'v=DKIM1; k=rsa; p=MIIB"x"'
    assert dkim_dns.parse_txt_rdata("v=DMARC1; p=none") == b"v=DMARC1; p=none"


def _doh(answer=None, status=0, seen=None):
    def handler(request):
        if seen is not None:
            seen.append(str(request.url))
        body = {"Status": status, "Answer": [{"type": 16, "data": answer}] if answer else []}
        return httpx.Response(200, json=body)
    return httpx.MockTransport(handler)


def test_auto_falls_back_to_doh_when_the_system_resolver_is_empty(monkeypatch):
    monkeypatch.setattr(dkim_dns, "system_txt", lambda name, timeout=5.0: (None, False))
    seen = []
    fn = dkim_dns.make_dnsfunc("auto", transport=_doh('"v=DKIM1; p=KEY"', seen=seen))
    assert fn(b"s1._domainkey.example.com.") == b"v=DKIM1; p=KEY"
    assert "name=s1._domainkey.example.com" in seen[0]


def test_system_answer_wins_and_nxdomain_is_trusted(monkeypatch):
    monkeypatch.setattr(dkim_dns, "system_txt", lambda name, timeout=5.0: (b"v=DKIM1; p=SYS", False))
    assert dkim_dns.make_dnsfunc("auto", transport=_doh('"v=DKIM1; p=DOH"'))("x") == b"v=DKIM1; p=SYS"
    monkeypatch.setattr(dkim_dns, "system_txt", lambda name, timeout=5.0: (None, True))
    assert dkim_dns.make_dnsfunc("auto", transport=_doh('"v=DKIM1; p=DOH"'))("x") is None


def test_off_never_uses_doh_and_always_skips_the_system(monkeypatch):
    monkeypatch.setattr(dkim_dns, "system_txt", lambda name, timeout=5.0: (None, False))
    assert dkim_dns.make_dnsfunc("off", transport=_doh('"v=DKIM1; p=DOH"'))("x") is None

    def boom(name, timeout=5.0):
        raise AssertionError("system resolver must not be used")
    monkeypatch.setattr(dkim_dns, "system_txt", boom)
    assert dkim_dns.make_dnsfunc("always", transport=_doh('"v=DKIM1; p=DOH"'))("x") == b"v=DKIM1; p=DOH"


def test_doh_nxdomain_returns_none():
    assert dkim_dns.doh_txt("missing.example.com", transport=_doh(status=3)) is None
