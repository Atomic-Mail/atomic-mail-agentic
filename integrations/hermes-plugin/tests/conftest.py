"""Load the plugin directory as the package ``atomicmail_plugin`` and provide fakes."""

from __future__ import annotations

import base64
import importlib.util
import json
import sys
from pathlib import Path
from urllib.parse import unquote

import httpx
import pytest

PLUGIN_DIR = Path(__file__).resolve().parent.parent
API_KEY = "11111111-2222-3333-4444-555555555555"
AGENT = "hermes-test@atomicmail.ai"


def _load_plugin():
    name = "atomicmail_plugin"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, PLUGIN_DIR / "__init__.py",
                                                  submodule_search_locations=[str(PLUGIN_DIR)])
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


plugin = _load_plugin()


def jwt(claims: dict) -> str:
    def enc(obj):
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")
    return f"{enc({'alg': 'none'})}.{enc(claims)}.sig"


class StubSessions:
    """Stands in for SessionManager: a capability for hermes-test@atomicmail.ai, no proof-of-work."""

    def __init__(self, *a, **k):
        self.forced = 0

    def capability(self, force=False):
        self.forced += int(force)
        return jwt({"inboxId": "hermes-test", "allowedFromDomain": "atomicmail.ai", "exp": 9e9})

    def close(self):
        pass


@pytest.fixture
def settings_env(monkeypatch, tmp_path):
    """Profile-scoped settings as a plain dict; HERMES_HOME points at a temp dir."""
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "home"))
    values: dict[str, str] = {}
    from atomicmail_plugin import config
    monkeypatch.setattr(config, "secret", lambda name, default="": values.get(name, default))
    try:
        from atomicmail_plugin import adapter
        monkeypatch.setattr(adapter, "secret", lambda name, default="": values.get(name, default))
    except Exception:  # noqa: BLE001 - gateway modules unavailable
        pass
    return values


class FakeJmapServer:
    """An in-memory Atomic Mail: .well-known/jmap, the JMAP methods the plugin uses, blob downloads."""

    def __init__(self) -> None:
        self.emails: dict[str, dict] = {}
        self.blobs: dict[str, bytes] = {}
        self.calls: list[tuple[str, dict]] = []
        self.sent: list[dict] = []
        self.status = 200
        self.set_errors: dict[str, dict] = {}

    # -- fixtures --------------------------------------------------------------------------
    def add(self, email_id: str, sender: str, subject: str, *, raw: bytes = b"", received: str = "2099-01-01T00:00:00Z",
            name: str = "", body: str = "hello", mailbox: str = "mb-inbox", message_id: str = "") -> None:
        blob = f"blob-{email_id}"
        self.blobs[blob] = raw
        self.emails[email_id] = {
            "id": email_id, "threadId": f"t-{email_id}", "blobId": blob, "size": len(raw),
            "mailboxIds": {mailbox: True}, "receivedAt": received, "subject": subject,
            "from": [{"name": name or None, "email": sender}], "to": [{"email": AGENT}], "preview": body[:40],
            "messageId": [message_id or f"{email_id}@example.com"], "references": None, "replyTo": None,
            "textBody": [{"partId": "1", "type": "text/plain"}], "htmlBody": [{"partId": "1", "type": "text/plain"}],
            "bodyValues": {"1": {"value": body}}, "attachments": [], "cc": None,
        }

    # -- transport -------------------------------------------------------------------------
    def handler(self, request: httpx.Request) -> httpx.Response:
        if self.status != 200:
            return httpx.Response(self.status, text="nope")
        assert request.headers["authorization"].startswith("Bearer ")
        path = request.url.path
        if path == "/.well-known/jmap":
            return httpx.Response(200, json={
                "apiUrl": "/jmap/", "downloadUrl": "/download/{accountId}/{blobId}/{name}?accept={type}",
                "uploadUrl": "/upload/{accountId}/", "primaryAccounts": {"urn:ietf:params:jmap:mail": "acc1"}})
        if path.startswith("/download/"):
            blob = unquote(path.split("/")[3])
            return httpx.Response(200, content=self.blobs[blob])
        if path == "/jmap/":
            body = json.loads(request.content)
            return httpx.Response(200, json={"methodResponses": self._run(body["methodCalls"])})
        return httpx.Response(404)

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)

    def _run(self, calls: list) -> list:
        results: dict[str, dict] = {}
        out = []
        for name, args, tag in calls:
            self.calls.append((name, args))
            res = self._method(name, args, results)
            results[tag] = res
            out.append([name, res, tag])
        return out

    def _method(self, name: str, args: dict, results: dict) -> dict:
        if name == "Mailbox/query":
            return {"ids": [f"mb-{args['filter']['role']}"]}
        if name == "Email/query":
            flt = args.get("filter") or {}
            rows = list(self.emails.values())
            if "inMailbox" in flt:
                rows = [e for e in rows if flt["inMailbox"] in e["mailboxIds"]]
            if "text" in flt:
                rows = [e for e in rows if flt["text"].lower() in (e["subject"] + e["preview"]).lower()]
            rows.sort(key=lambda e: e["receivedAt"], reverse=True)
            return {"ids": [e["id"] for e in rows[: args.get("limit", 50)]]}
        if name == "Email/get":
            ids = args.get("ids")
            if ids is None and "#ids" in args:
                ids = results[args["#ids"]["resultOf"]]["ids"]
            props = args.get("properties")
            items = []
            for i in ids or []:
                if i in self.emails:
                    e = self.emails[i]
                    items.append({k: v for k, v in e.items() if props is None or k in props or k == "id"})
            return {"list": items, "notFound": [i for i in ids or [] if i not in self.emails]}
        if name == "Email/set":
            if "d1" in self.set_errors:
                return {"notCreated": {"d1": self.set_errors["d1"]}}
            draft = args["create"]["d1"]
            self.sent.append(draft)
            return {"created": {"d1": {"id": f"sent-{len(self.sent)}"}}}
        if name == "EmailSubmission/set":
            return {"created": {"s1": {"id": "sub1", "undoStatus": "final"}}}
        if name == "Blob/get":
            import base64
            found = [i for i in args["ids"] if i in self.blobs]
            return {"list": [{"id": i, "size": len(self.blobs[i]),
                              "data:asBase64": base64.b64encode(self.blobs[i]).decode()} for i in found],
                    "notFound": [i for i in args["ids"] if i not in self.blobs]}
        return {}


@pytest.fixture
def fake_jmap():
    return FakeJmapServer()


@pytest.fixture
def jmap_client(fake_jmap):
    from atomicmail_plugin.jmap import AtomicMailJmap
    return AtomicMailJmap(API_KEY, "https://auth.test", "https://api.test", sessions=StubSessions(),
                          transport=fake_jmap.transport())


class DkimKit:
    """Signs test mail with a fresh RSA key and answers the DNS lookup for it."""

    def __init__(self, domain: str = "example.com", selector: str = "s1") -> None:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa

        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.private_pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL,
                                             serialization.NoEncryption())
        public_der = key.public_key().public_bytes(serialization.Encoding.DER,
                                                   serialization.PublicFormat.SubjectPublicKeyInfo)
        self.txt = b"v=DKIM1; k=rsa; p=" + base64.b64encode(public_der)
        self.domain, self.selector = domain, selector

    def dnsfunc(self, name, timeout=5):
        name = name.decode() if isinstance(name, bytes) else name
        return self.txt if name.rstrip(".") == f"{self.selector}._domainkey.{self.domain}" else None

    def sign(self, raw: bytes, *, domain: str | None = None, length: bool = False) -> bytes:
        import dkim
        sig = dkim.sign(raw, self.selector.encode(), (domain or self.domain).encode(), self.private_pem,
                        include_headers=[b"from", b"to", b"subject", b"date", b"message-id"], length=length)
        return sig + raw


def make_mail(sender: str = "owner@example.com", subject: str = "Plan my week", body: str = "Book a call with Bob.",
              extra_headers: str = "") -> bytes:
    text = (f"From: Owner <{sender}>\r\nTo: {AGENT}\r\nSubject: {subject}\r\n"
            f"Date: Tue, 10 Nov 2026 12:00:00 +0000\r\nMessage-ID: <abc123@example.com>\r\n{extra_headers}"
            f"MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n{body}\r\n")
    return text.encode()


@pytest.fixture
def dkim_kit():
    pytest.importorskip("dkim")
    return DkimKit()
