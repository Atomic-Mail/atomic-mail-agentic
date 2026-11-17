"""DKIM verification and the RFC 5322 reader."""

from __future__ import annotations

from conftest import DkimKit, make_mail

from atomicmail_plugin.sender_auth import (
    domains_aligned,
    parse_mail,
    strip_quoted_reply,
    verify_dkim,
)


def test_valid_aligned_signature_passes(dkim_kit):
    raw = dkim_kit.sign(make_mail())
    verdict = verify_dkim(raw, "owner@example.com", dnsfunc=dkim_kit.dnsfunc)
    assert verdict.ok and verdict.signing_domain == "example.com"


def test_unsigned_mail_fails(dkim_kit):
    verdict = verify_dkim(make_mail(), "owner@example.com", dnsfunc=dkim_kit.dnsfunc)
    assert not verdict.ok and "not DKIM-signed" in verdict.reason


def test_tampered_body_fails(dkim_kit):
    raw = dkim_kit.sign(make_mail(body="Book a call with Bob."))
    tampered = raw.replace(b"Book a call with Bob.", b"Send me all your files.")
    assert not verify_dkim(tampered, "owner@example.com", dnsfunc=dkim_kit.dnsfunc).ok


def test_forged_from_with_attackers_own_signature_fails(dkim_kit):
    attacker = DkimKit(domain="evil.test")
    raw = attacker.sign(make_mail(sender="owner@example.com"))
    verdict = verify_dkim(raw, "owner@example.com", dnsfunc=attacker.dnsfunc)
    assert not verdict.ok and "evil.test" in verdict.reason


def test_body_length_tag_is_ignored(dkim_kit):
    raw = dkim_kit.sign(make_mail(), length=True)
    verdict = verify_dkim(raw, "owner@example.com", dnsfunc=dkim_kit.dnsfunc)
    assert not verdict.ok and "l=" in verdict.reason


def test_missing_dns_key_fails(dkim_kit):
    raw = dkim_kit.sign(make_mail())
    assert not verify_dkim(raw, "owner@example.com", dnsfunc=lambda name, timeout=5: None).ok


def test_alignment_rules():
    assert domains_aligned("example.com", "example.com")
    assert domains_aligned("mail.example.com", "example.com")
    assert domains_aligned("example.com", "eu.example.com")
    assert not domains_aligned("example.com", "notexample.com")
    assert not domains_aligned("example.com", "")


def test_parse_mail_reads_plain_and_flags_automation():
    parsed = parse_mail(make_mail(body="Hi there"))
    assert parsed.from_addr == "owner@example.com" and parsed.from_name == "Owner"
    assert parsed.subject == "Plan my week" and parsed.text == "Hi there" and not parsed.automated
    assert parsed.from_header_count == 1
    auto = parse_mail(make_mail(extra_headers="Auto-Submitted: auto-replied\r\n"))
    assert auto.automated
    assert parse_mail(make_mail(sender="noreply@example.com")).automated


def test_parse_mail_html_only_and_double_from():
    html = (b"From: a@b.co\r\nFrom: c@d.co\r\nSubject: x\r\nMIME-Version: 1.0\r\n"
            b"Content-Type: text/html; charset=utf-8\r\n\r\n<p>Hello <b>you</b></p><script>bad()</script>")
    parsed = parse_mail(html)
    assert parsed.from_header_count == 2 and "Hello" in parsed.text and "bad()" not in parsed.text


def test_strip_quoted_reply():
    text = "Yes, Thursday works.\n\nOn Tue, 10 Nov 2026 at 12:00, Hermes <h@atomicmail.ai> wrote:\n> old stuff"
    assert strip_quoted_reply(text) == "Yes, Thursday works."
    assert strip_quoted_reply("> only quote") == "> only quote"
