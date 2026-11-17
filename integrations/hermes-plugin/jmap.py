"""Direct JMAP client for one Atomic Mail inbox.

Works with any inbox, including ones created by ``hermes atomicmail setup``
that are not attached to a human account. Every request carries a ~2 minute
capability token minted from a proof-of-work session (see ``auth.py``).
"""

from __future__ import annotations

import threading
from typing import Any, Callable, Iterable, Optional
from urllib.parse import urljoin

import httpx

from .auth import USER_AGENT, AuthError, SessionManager, decode_jwt_claims

CORE = "urn:ietf:params:jmap:core"
MAIL = "urn:ietf:params:jmap:mail"
SUBMISSION = "urn:ietf:params:jmap:submission"
BLOB = "urn:ietf:params:jmap:blob"
MAX_RAW_BYTES = 10 * 1024 * 1024
MAX_TEXT_CHARS = 20_000

SUMMARY_PROPS = ["id", "threadId", "receivedAt", "from", "to", "subject", "preview"]
FULL_PROPS = ["id", "threadId", "messageId", "inReplyTo", "references", "receivedAt", "sentAt", "from", "to", "cc",
              "replyTo", "subject", "preview", "textBody", "htmlBody", "bodyValues", "attachments", "size"]


class JmapError(Exception):
    def __init__(self, message: str, *, retryable: bool = False, status: Optional[int] = None) -> None:
        super().__init__(message)
        self.retryable = retryable
        self.status = status


def _addresses(value: Any) -> list[dict]:
    """``"a@b.co"``, ``"A <a@b.co>"``, a comma list or a list of those -> JMAP EmailAddress objects."""
    from email.utils import getaddresses

    items: list[str] = []
    if isinstance(value, str):
        items = [value]
    elif isinstance(value, (list, tuple)):
        items = [str(v) for v in value]
    out = []
    for name, addr in getaddresses(items):
        addr = addr.strip()
        if "@" in addr:
            out.append({"email": addr, **({"name": name.strip()} if name.strip() else {})})
    return out


def _strip_controls(text: str) -> str:
    return "".join(" " if ord(ch) < 32 and ch not in "\t" else ch for ch in text or "").strip()


class AtomicMailJmap:
    """Thread-safe client for the inbox an API key belongs to."""

    def __init__(self, api_key: str, auth_url: str, api_url: str, *,
                 sessions: Optional[SessionManager] = None,
                 transport: Optional[httpx.BaseTransport] = None, timeout: float = 30.0,
                 should_stop: Optional[Callable[[], bool]] = None) -> None:
        if not api_key:
            raise JmapError("ATOMICMAIL_API_KEY is not set. Run `hermes atomicmail setup`.")
        self._sessions = sessions or SessionManager(api_key, auth_url, should_stop=should_stop)
        self._api_url = api_url.rstrip("/")
        self._client = httpx.Client(timeout=timeout, transport=transport, headers={"User-Agent": USER_AGENT})
        self._info: Optional[dict] = None
        self._mailboxes: dict[str, str] = {}
        self._address: Optional[str] = None
        self._lock = threading.Lock()

    def close(self) -> None:
        self._client.close()
        self._sessions.close()

    # ------------------------------------------------------------------ plumbing

    def _token(self, *, force: bool = False) -> str:
        try:
            return self._sessions.capability(force=force)
        except AuthError as exc:
            raise JmapError(str(exc), retryable=exc.retryable) from exc

    def _request(self, method: str, url: str, **kwargs) -> httpx.Response:
        extra_headers = kwargs.pop("headers", {}) or {}
        for attempt in (0, 1):
            headers = {**extra_headers, "Authorization": f"Bearer {self._token(force=attempt == 1)}"}
            try:
                response = self._client.request(method, url, headers=headers, **kwargs)
            except httpx.HTTPError as exc:
                raise JmapError(f"Atomic Mail unreachable ({exc.__class__.__name__})", retryable=True) from exc
            if response.status_code == 401 and attempt == 0:
                continue
            if response.status_code == 429:
                raise JmapError("Atomic Mail rate limit reached; try again in a minute.", retryable=True, status=429)
            if response.status_code >= 500:
                raise JmapError(f"Atomic Mail server error ({response.status_code})", retryable=True,
                                status=response.status_code)
            if response.status_code >= 400:
                detail = response.text[:300].strip()
                raise JmapError(f"Atomic Mail refused the request ({response.status_code}): {detail}",
                                status=response.status_code)
            return response
        raise JmapError("Atomic Mail rejected a fresh token", status=401)

    def session_info(self) -> dict:
        with self._lock:
            if self._info is None:
                session = self._request("GET", f"{self._api_url}/.well-known/jmap").json()
                account = (session.get("primaryAccounts") or {}).get(MAIL)
                api = session.get("apiUrl")
                if not isinstance(account, str) or not isinstance(api, str):
                    raise JmapError("JMAP session has no mail account")
                base = self._api_url + "/"
                self._info = {
                    "account_id": account,
                    "api_url": urljoin(base, api),
                    "download_url": urljoin(base, str(session.get("downloadUrl") or "")),
                    "upload_url": urljoin(base, str(session.get("uploadUrl") or "")),
                }
            return self._info

    @property
    def account_id(self) -> str:
        return self.session_info()["account_id"]

    def call(self, method_calls: list, *, using: Iterable[str] = (CORE, MAIL)) -> list:
        """POST one JMAP request; returns ``methodResponses``. Method-level errors raise JmapError."""
        info = self.session_info()
        response = self._request("POST", info["api_url"], json={"using": list(using), "methodCalls": method_calls})
        try:
            responses = response.json()["methodResponses"]
        except (ValueError, KeyError, TypeError) as exc:
            raise JmapError("Unexpected JMAP reply") from exc
        for name, args, _tag in responses:
            if name == "error":
                kind = args.get("type", "error")
                raise JmapError(f"JMAP {kind}: {args.get('description') or ''}".strip(),
                                retryable=kind in ("serverUnavailable", "serverFail"))
        return responses

    @staticmethod
    def pick(responses: list, tag: str) -> dict:
        for name, args, resp_tag in responses:
            if resp_tag == tag:
                return args
        raise JmapError(f"JMAP reply is missing {tag}")

    # ------------------------------------------------------------------ identity & mailboxes

    @property
    def address(self) -> str:
        """The inbox address, from the capability token (custom domains included)."""
        if self._address is None:
            claims = decode_jwt_claims(self._token())
            inbox = str(claims.get("inboxId") or "")
            domain = str(claims.get("allowedFromDomain") or claims.get("domain") or "atomicmail.ai")
            if not inbox:
                raise JmapError("The capability token has no inboxId")
            self._address = (inbox if "@" in inbox else f"{inbox}@{domain}").lower()
        return self._address

    def mailbox_id(self, role: str) -> str:
        with self._lock:
            cached = self._mailboxes.get(role)
        if cached:
            return cached
        account = self.account_id
        found = self.pick(self.call([["Mailbox/query", {"accountId": account, "filter": {"role": role}}, "q"]]), "q")
        ids = found.get("ids") or []
        if not ids:
            raise JmapError(f"No {role} mailbox")
        with self._lock:
            self._mailboxes[role] = ids[0]
        return ids[0]

    # ------------------------------------------------------------------ reading

    def _query_get(self, flt: dict, limit: int, props: list) -> list[dict]:
        account = self.account_id
        responses = self.call([
            ["Email/query", {"accountId": account, "filter": flt,
                             "sort": [{"property": "receivedAt", "isAscending": False}], "limit": limit}, "q"],
            ["Email/get", {"accountId": account, "#ids": {"resultOf": "q", "name": "Email/query", "path": "/ids"},
                           "properties": props}, "g"],
        ])
        return [m for m in self.pick(responses, "g").get("list") or [] if isinstance(m, dict) and m.get("id")]

    def recent_messages(self, limit: int = 30) -> list[dict]:
        return self._query_get({"inMailbox": self.mailbox_id("inbox")}, max(1, min(100, int(limit))), SUMMARY_PROPS)

    def search(self, query: str, limit: int = 25) -> list[dict]:
        return self._query_get({"text": query}, max(1, min(50, int(limit))), SUMMARY_PROPS)

    def get_message(self, email_id: str) -> dict:
        account = self.account_id
        args = self.pick(self.call([["Email/get", {
            "accountId": account, "ids": [email_id], "properties": FULL_PROPS,
            "fetchTextBodyValues": True, "fetchHTMLBodyValues": True, "maxBodyValueBytes": 200_000}, "g"]]), "g")
        items = args.get("list") or []
        if not items:
            raise JmapError(f"Message {email_id} not found")
        return items[0]

    @staticmethod
    def body_text(message: dict) -> str:
        values = message.get("bodyValues") or {}
        parts = [values.get(p.get("partId"), {}).get("value", "") for p in message.get("textBody") or []]
        text = "\n".join(t for t in parts if t).strip()
        if not text:
            from .sender_auth import _strip_html
            html = "\n".join(values.get(p.get("partId"), {}).get("value", "") for p in message.get("htmlBody") or [])
            text = _strip_html(html)
        return text[:MAX_TEXT_CHARS]

    def blob_bytes(self, blob_id: str, *, max_bytes: int = MAX_RAW_BYTES) -> bytes:
        """A blob's bytes through JMAP ``Blob/get`` (RFC 9404). Atomic Mail's session advertises a
        percent-encoded downloadUrl template, so the download endpoint is not used."""
        import base64

        args = self.pick(self.call([["Blob/get", {"accountId": self.account_id, "ids": [blob_id],
                                                  "properties": ["data:asBase64", "size"]}, "b"]],
                                   using=(CORE, MAIL, BLOB)), "b")
        items = args.get("list") or []
        if not items:
            raise JmapError(f"Blob {blob_id} not found")
        if int(items[0].get("size") or 0) > max_bytes:
            raise JmapError(f"Blob is larger than {max_bytes // (1024 * 1024)} MB")
        try:
            return base64.b64decode(items[0].get("data:asBase64") or "", validate=False)
        except ValueError as exc:
            raise JmapError("Blob/get returned undecodable data") from exc

    def raw_message(self, email_id: str, *, max_bytes: int = MAX_RAW_BYTES) -> bytes:
        args = self.pick(self.call([["Email/get", {"accountId": self.account_id, "ids": [email_id],
                                                   "properties": ["blobId", "size"]}, "g"]]), "g")
        items = args.get("list") or []
        if not items:
            raise JmapError(f"Message {email_id} not found")
        if int(items[0].get("size") or 0) > max_bytes:
            raise JmapError("Message is larger than 10 MB; not verified")
        return self.blob_bytes(str(items[0]["blobId"]), max_bytes=max_bytes)

    # ------------------------------------------------------------------ sending

    def send(self, to: Any, subject: str, body: str, *, cc: Any = None, bcc: Any = None,
             in_reply_to: Optional[list[str]] = None, references: Optional[list[str]] = None) -> dict:
        to_list, cc_list, bcc_list = _addresses(to), _addresses(cc), _addresses(bcc)
        if not to_list:
            raise JmapError("No valid recipient address")
        account, sender = self.account_id, self.address
        draft: dict = {
            "mailboxIds": {self.mailbox_id("sent"): True},
            "from": [{"email": sender}],
            "to": to_list,
            "subject": _strip_controls(subject)[:250],
            "textBody": [{"partId": "b", "type": "text/plain"}],
            "bodyValues": {"b": {"value": body}},
            "keywords": {"$draft": True, "$seen": True},
        }
        if cc_list:
            draft["cc"] = cc_list
        if bcc_list:
            draft["bcc"] = bcc_list
        if in_reply_to:
            draft["inReplyTo"] = in_reply_to
            draft["references"] = references or in_reply_to
        rcpt = [{"email": a["email"]} for a in to_list + cc_list + bcc_list]
        responses = self.call([
            ["Email/set", {"accountId": account, "create": {"d1": draft}}, "c0"],
            ["EmailSubmission/set", {
                "accountId": account,
                "onSuccessUpdateEmail": {"#s1": {"keywords/$draft": None, "keywords/$sent": True}},
                "create": {"s1": {"emailId": "#d1", "envelope": {"mailFrom": {"email": sender}, "rcptTo": rcpt}}},
            }, "c1"],
        ], using=(CORE, MAIL, SUBMISSION))
        created = self.pick(responses, "c0")
        if created.get("notCreated"):
            raise JmapError(f"Not sent: {_set_error(created['notCreated'])}")
        submitted = self.pick(responses, "c1")
        if submitted.get("notCreated"):
            raise JmapError(f"Not sent: {_set_error(submitted['notCreated'])}")
        email_id = ((created.get("created") or {}).get("d1") or {}).get("id")
        return {"status": "sent", "email_id": email_id, "to": [a["email"] for a in to_list]}

    def reply(self, email_id: str, body: str) -> dict:
        original = self.get_message(email_id)
        target = _addresses([f"{a.get('name') or ''} <{a.get('email')}>" for a in
                             (original.get("replyTo") or original.get("from") or []) if a.get("email")])
        if not target:
            raise JmapError("The message has no sender to reply to")
        subject = str(original.get("subject") or "")
        if not subject.lower().startswith("re:"):
            subject = f"Re: {subject}".strip()
        message_ids = [m for m in original.get("messageId") or [] if m]
        references = [m for m in (original.get("references") or []) if m] + message_ids
        result = self.send([f"{t.get('name', '')} <{t['email']}>" for t in target], subject, body,
                           in_reply_to=message_ids or None, references=references or None)
        result["in_reply_to"] = email_id
        return result


def _set_error(not_created: dict) -> str:
    first = next(iter(not_created.values()), {}) if isinstance(not_created, dict) else {}
    return f"{first.get('type', 'error')}: {first.get('description', '')}".strip(": ")


def summarize(message: dict) -> dict:
    """The fields a model needs from an Email/get summary."""
    sender = (message.get("from") or [{}])[0] or {}
    return {
        "id": message.get("id"),
        "from": sender.get("email"),
        "from_name": sender.get("name"),
        "subject": message.get("subject") or "(no subject)",
        "preview": message.get("preview"),
        "received_at": message.get("receivedAt"),
    }


_shared_lock = threading.Lock()
_shared: dict[tuple, AtomicMailJmap] = {}


def shared_client(api_key: str, auth_url: str, api_url: str) -> AtomicMailJmap:
    """One client per key in a process, so the gateway channel and the tools share a session."""
    key = (api_key, auth_url, api_url)
    with _shared_lock:
        client = _shared.get(key)
        if client is None:
            client = AtomicMailJmap(api_key, auth_url, api_url)
            _shared[key] = client
        return client
