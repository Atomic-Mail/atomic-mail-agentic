---
title: Webhooks
description: Get a signed POST for every new message in an agent inbox — set up in the dashboard, Standard Webhooks signatures, verification, retries, limits, and how to connect it to your agent.
---

# Webhooks

Get a signed `POST` to your server each time a new message lands in one of your
agent inboxes, instead of polling the inbox. The wire format is
[Standard Webhooks v1](https://www.standardwebhooks.com/) (HMAC-SHA256), so any
Standard Webhooks library can verify it, and the snippets below need no
dependencies.

Webhooks are set up in the [dashboard](https://dashboard.atomicmail.ai) by the
inbox owner. Nothing changes in the MCP server or the AgentSkill CLI: your agent
keeps reading and sending mail the way it does today, and the webhook tells it
when to look.

## At a glance

| What               | Value                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Event              | `message.received` (one per new message in the inbox)                                                                                       |
| Who can use it     | Active inboxes attached to an owner who signs in with **Google or GitHub** (not anonymous inboxes, not password-only owners)                 |
| Transport          | `POST` with a JSON body, `https` on port 443, over IPv4, redirects never followed                                                           |
| Signature          | `webhook-id`, `webhook-timestamp`, `webhook-signature` (`v1,<base64 HMAC-SHA256>`)                                                          |
| Secret             | `whsec_<base64 of 32 bytes>`, shown once on create and on rotate                                                                            |
| Before first event | The endpoint must pass a signed challenge-echo verification (any 2xx on Zapier, Make, n8n Cloud, webhook.site and Pipedream)                |
| Which mail fires   | Only mail received at or after the endpoint became active; nothing is replayed                                                              |
| Delivery guarantee | At least once, unordered: deduplicate on `webhook-id` (keep processed ids for 7 days)                                                       |
| Retries            | Timeouts, 5xx, 429 and network errors: 8 attempts over about 25 hours. 3xx and other 4xx: no retry. 410: the endpoint is turned off         |
| Payload            | Ids and envelope metadata only (sender, size, time). No subject and no body: fetch the message by `message_id`. At most 8 KiB              |
| Timeouts           | 5 s to connect (DNS, TCP, TLS), 15 s in total. Answer with any 2xx quickly and work afterwards                                              |

## Set up an endpoint

1. Sign in to the [dashboard](https://dashboard.atomicmail.ai) with Google or
   GitHub. If you signed up with email and password, link Google or GitHub under
   **Sign-in methods** first.
2. Attach the inbox to your account (**Agent inboxes**) if it is not attached
   yet.
3. Open **Webhooks**, click **Add endpoint**, pick the inbox and paste your
   `https` URL.
4. Copy the **secret**. It is shown once; store it where your receiver reads it.
5. Click **Verify** (automation platforms pass at once), then **Send test** to
   see a `webhook.test` arrive.

From then on every new message in that inbox produces a `message.received`
event. The **Deliveries** list shows each attempt, its status code and why a
delivery failed; **Redeliver** sends a finished delivery again.

## Connect webhooks to your agent

The event only says that mail arrived and from whom. Your code then fetches the
message by `data.message_id` and hands it to the agent.

- **Agent on a server** (your backend, a serverless function, an agent built
  with LangGraph, CrewAI or similar): expose an `https` endpoint, verify the
  signature ([below](#verifying-signatures)), answer `2xx`, then fetch the
  message with JMAP `Email/get` on `https://api.atomicmail.ai/jmap` or the MCP
  `read_message` tool, and run the agent on it. The agent reacts within seconds
  instead of on its next poll.
- **No-code platforms** (Zapier, Make, n8n): create a trigger of the
  **Webhook / Catch hook** kind, paste the URL it gives you into **Add
  endpoint**, and build the rest of the flow there. Verification passes on these
  platforms automatically.
- **Agent on a laptop** (Claude Desktop, Cursor, OpenClaw and similar): a
  webhook cannot reach it, because a laptop has no public address. Keep the
  scheduled check you chose with `watch` when you registered the inbox (see
  [Getting started](./getting-started.md)).

## What fires

`message.received` fires once per message that **arrives in the inbox** of an
inbox with at least one active endpoint, and only for endpoints that were active
when the message arrived. It does not fire for drafts, for your own sent copies,
for messages that were already there, or for messages moved into the inbox
later. Most events leave within a few seconds of delivery.

## Requests we send

Every request (events, test events, verification) is a `POST` with these
headers:

| Header              | Value                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `content-type`      | `application/json`                                                                                     |
| `user-agent`        | `AtomicMail-Webhooks/1`                                                                                |
| `webhook-id`        | Event id. `msg_` + 26 hex for `message.received`; `msg_test_<hex>`, `msg_verification_<hex>` otherwise |
| `webhook-timestamp` | Unix seconds at the moment of **this attempt** (it changes on every retry)                             |
| `webhook-signature` | Space-separated `v1,<base64>` entries. Two entries during a secret rotation (new secret first)         |

The signature is HMAC-SHA256, keyed with the base64-decoded part of your
`whsec_` secret, over the bytes `<webhook-id>.<webhook-timestamp>.<raw body>`.

### `message.received`

An example body (pretty-printed here; the
wire form has no whitespace):

```json
{
  "type": "message.received",
  "timestamp": "2026-10-05T12:34:58.123Z",
  "data": {
    "inbox": "alice@atomicmail.ai",
    "account_id": "3f6c2a1e-8b4d-4c2f-9a71-5d0e2b7c9f10",
    "message_id": "M8f2d1c0a9b7e6d5c4b3a2918",
    "thread_id": "T4a5b6c7d8e9f0a1b",
    "rfc822_message_id": "CAF1x2y3z@mail.example.com",
    "from": [{ "name": "Bob Example", "email": "bob@example.com" }],
    "received_at": "2026-10-05T12:34:56.000Z",
    "size": 18342,
    "has_attachment": false
  }
}
```

With the secret `whsec_AwoRGB8mLTQ7QklQV15lbHN6gYiPlp2kq7K5wMfO1dw=` (a test
value), the compact form of that body was sent with:

```text
webhook-id: msg_e470833ee701d9b2e8589c3721
webhook-timestamp: 1791203698
webhook-signature: v1,r5Y/KWGOAhgeaogNPIyMCp6Dhx1aJnmIRh9kLKzI5Ns=
```

| Field                    | Meaning                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `type`                   | `message.received`                                                                                    |
| `timestamp`              | When the event was created (ISO 8601). Not the attempt time: that is `webhook-timestamp`              |
| `data.inbox`             | The inbox address                                                                                     |
| `data.account_id`        | The Atomic Mail inbox id (as shown in the dashboard), **not** the JMAP `accountId` |
| `data.message_id`        | JMAP `Email` id. Use it to fetch the message                                                          |
| `data.thread_id`         | JMAP thread id, or `null`                                                                             |
| `data.rfc822_message_id` | The `Message-ID` header without angle brackets, or `null`                                             |
| `data.from`              | Up to 5 senders, `{name, email}`; `name` is `null` when absent and cut to 100 characters              |
| `data.received_at`       | When the mail store received it (ISO 8601, whole seconds), or `null`                                  |
| `data.size`              | Message size in bytes                                                                                 |
| `data.has_attachment`    | `true` when the store flags an attachment                                                             |

The body is capped at 8 KiB. An oversized body is shrunk in this order until it
fits: one sender only, senders emptied, `rfc822_message_id` set to `null`. The
same message always produces the same bytes.

### `webhook.test`

Sent only when you press **Send test** in the dashboard. It has a random
`webhook-id`, is never retried and never appears in the delivery log:

```json
{
  "type": "webhook.test",
  "timestamp": "2026-10-05T12:40:00.000Z",
  "data": {
    "inbox": "alice@atomicmail.ai",
    "account_id": "3f6c2a1e-8b4d-4c2f-9a71-5d0e2b7c9f10",
    "endpoint_id": "wh_0b9f3c1e-6a2d-4e8b-9c7f-2d1a5e4b3c6f"
  }
}
```

Test events go only to an endpoint that is verified and turned on (otherwise
409), and they never change the endpoint's delivery health.

### Verification challenge

Before an endpoint gets real events it must prove that it wants them. We POST a
request (`webhook-id: msg_verification_<hex>`) with this body, **signed with the
endpoint's secret** like every other request:

```json
{ "type": "verification", "challenge": "pT2v...43 base64url characters" }
```

Your endpoint passes when it answers with any **2xx** and a JSON object body
that echoes the value: `{"challenge": "pT2v..."}`. The challenge is single-use.
This is the same handshake as OpenAI MCP Events. A passing check is recorded as
`verification.method: "challenge"`.

**Automation platforms.** For URLs on `hooks.zapier.com`, `hook.eu1.make.com`,
`hook.eu2.make.com`, `hook.us1.make.com`, `hook.us2.make.com`, `*.n8n.cloud`,
`webhook.site` and `*.pipedream.net`, any 2xx passes
(`verification.method: "platform_2xx"`): these platforms answer every POST with
a fixed body and cannot echo. A correct echo from them is still recorded as
`challenge`.

When verification runs:

- **On create**, inside the create call. That request is signed with the secret
  the same call returns, so a receiver that checks signatures cannot pass it yet
  (see the recommended flow below).
- **When you press Verify.** Re-checking an endpoint that is already verified is
  sticky: a failure is recorded in `verification.failure_reason` and
  `last_attempt_at`, but the endpoint stays verified and deliveries continue.
- **Whenever a turned-off endpoint is turned back on** (the dashboard toggle), whatever turned it off (you,
  `auto_failing` or `gone_410`). Verification is not sticky across a disable:
  the endpoint becomes active only if this check passes. If it fails, the
  endpoint stays on but `pending_verification`, with
  `verification.state:
  "failed"` and the reason, and nothing is sent until a
  later **Verify** passes.

**Recommended receiver flow:**

1. Create the endpoint and store the returned `secret` in your receiver.
2. Click **Verify** in the dashboard. When it passes, the endpoint is
   `active` and events for new mail start.

A strict receiver fails the check inside the create call (usually reason
`http_status` from a 401, or `challenge_failed`): that is expected, the endpoint
stays `pending_verification` and nothing is sent until step 2. The platforms
listed above pass on create, so for them events start right away: configure the
secret before mail arrives.

The snippets below also support a receiver that has no secret configured yet: it
answers the challenge without a signature check, so the in-create check passes,
and it answers **503** to everything else so those events are retried (+5 s, +1
min, +10 min, ...) and land once the secret is in place. Answering 401 instead
would fail them for good.

Failure reasons (shown next to the endpoint in the dashboard):

| Reason             | Meaning                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `challenge_failed` | 2xx with a JSON object that does not carry the right `challenge`                         |
| `invalid_response` | 2xx whose body is not a JSON object, or an HTTP answer we could not parse                |
| `http_status`      | Non-2xx, including redirects (the dashboard shows the status code)                       |
| `timeout`          | No connection within 5 s, or no answer within 15 s                                       |
| `tls_error`        | TLS failed (the certificate must be valid for the hostname)                              |
| `network_error`    | DNS failure, connection refused or reset                                                 |
| `no_ipv4_address`  | The hostname has only AAAA records; we deliver over IPv4                                 |
| `blocked`          | The URL is not allowed, or one of the hostname's addresses is not public (see URL rules) |

## Verifying signatures

Rules that matter more than the language:

- Verify against the **raw request bytes**. Parsing the JSON and serialising it
  again changes the bytes and breaks the signature.
- Accept a request when **any** `v1,` entry matches **any** secret you hold
  (current, plus the previous one while you roll a rotation). Compare in
  constant time.
- Reject timestamps more than 5 minutes away from your clock.
- Return 2xx within 15 seconds. Queue the work and do it after you answer.
- If the secret leaks, click **Rotate secret**. For 24 hours both secrets sign,
  so you can switch your receiver over without dropping events.

Both verification functions below were tested against real signed requests,
including a dual-signed rotation request and the Standard Webhooks spec test
vector.

### Node.js (`node:crypto`, no dependencies)

```js
import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_SEC = 5 * 60;

// rawBody: the exact bytes received (a Buffer), never re-serialized JSON.
// headers: lower-case header names (Node's req.headers already are).
// secrets: your current whsec_ secret, plus the previous one during a rotation.
// Returns the webhook-id; throws if the request is not authentic.
export function verifyAtomicMailWebhook(rawBody, headers, secrets, nowSec) {
  const id = headers["webhook-id"];
  const ts = headers["webhook-timestamp"];
  const sigHeader = headers["webhook-signature"];
  if (!id || !ts || !sigHeader) throw new Error("missing webhook headers");
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  if (!/^\d+$/.test(ts) || Math.abs(now - Number(ts)) > TOLERANCE_SEC) {
    throw new Error("webhook timestamp outside tolerance");
  }
  const signed = Buffer.concat([Buffer.from(`${id}.${ts}.`), rawBody]);
  const received = sigHeader.split(" ")
    .filter((entry) => entry.startsWith("v1,"))
    .map((entry) => Buffer.from(entry.slice(3), "base64"));
  for (const secret of secrets) {
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const expected = createHmac("sha256", key).update(signed).digest();
    if (
      received.some((sig) =>
        sig.length === expected.length && timingSafeEqual(sig, expected)
      )
    ) return id;
  }
  throw new Error("no matching webhook signature");
}
```

A complete receiver on `node:http`, including the challenge echo (with Express,
mount the route with `express.raw({ type: "application/json" })` so you get the
raw bytes):

```js
import { createServer } from "node:http";
import { verifyAtomicMailWebhook } from "./verify.mjs";

// Current secret, plus the previous one while you roll a rotation.
const SECRETS = [
  process.env.ATOMICMAIL_WEBHOOK_SECRET,
  process.env.ATOMICMAIL_WEBHOOK_SECRET_PREVIOUS,
].filter(Boolean);

// Our payloads are at most 8 KiB: refuse anything far larger before buffering
// it, so an unsigned flood cannot exhaust memory.
const MAX_BODY = 64 * 1024;

createServer((req, res) => {
  const chunks = [];
  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      res.writeHead(413).end();
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (size > MAX_BODY) return;
    const raw = Buffer.concat(chunks);
    let id = null;
    try {
      id = verifyAtomicMailWebhook(raw, req.headers, SECRETS);
    } catch {
      // fall through: only an unconfigured receiver may answer a challenge
    }
    let event;
    try {
      event = JSON.parse(raw.toString("utf8"));
    } catch {
      return res.writeHead(400).end();
    }
    // `null`, a number or an array is valid JSON but not an event.
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      return res.writeHead(400).end();
    }

    if (event.type === "verification" && (id || SECRETS.length === 0)) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ challenge: event.challenge }));
    }
    // No secret configured yet: 503 makes us retry the event later.
    if (SECRETS.length === 0) return res.writeHead(503).end();
    if (!id) return res.writeHead(401).end();

    res.writeHead(204).end(); // acknowledge first, then do the work
    handleEvent(id, event);
  });
}).listen(Number(process.env.PORT ?? 8080));

function handleEvent(id, event) {
  // Deduplicate on `id` (the webhook-id). For message.received, fetch the
  // message by event.data.message_id through the API.
  console.log(id, event.type, event.data?.message_id ?? "");
}
```

### Python (`hmac`, standard library)

```python
import base64
import hashlib
import hmac
import time

TOLERANCE_SEC = 5 * 60


def verify_atomicmail_webhook(raw_body, headers, secrets, now=None):
    """Return the webhook-id, or raise ValueError if the request is not authentic.

    raw_body: the exact bytes received, never re-serialized JSON.
    headers: any case-insensitive mapping (Flask, Django, http.server).
    secrets: your current whsec_ secret, plus the previous one during a rotation.
    """
    msg_id = headers.get("webhook-id")
    ts = headers.get("webhook-timestamp")
    sig_header = headers.get("webhook-signature")
    if not msg_id or not ts or not sig_header:
        raise ValueError("missing webhook headers")
    now = int(time.time()) if now is None else now
    if not (ts.isascii() and ts.isdigit()) or abs(now - int(ts)) > TOLERANCE_SEC:
        raise ValueError("webhook timestamp outside tolerance")
    signed = f"{msg_id}.{ts}.".encode() + raw_body
    received = [e[3:] for e in sig_header.split(" ") if e.startswith("v1,")]
    for secret in secrets:
        key = base64.b64decode(secret.removeprefix("whsec_"))
        digest = hmac.new(key, signed, hashlib.sha256).digest()
        expected = base64.b64encode(digest).decode()
        if any(hmac.compare_digest(expected.encode(), s.encode()) for s in received):
            return msg_id
    raise ValueError("no matching webhook signature")
```

A Flask receiver (Python 3.9+), including the challenge echo:

```python
import json
import os

from flask import Flask, jsonify, request

from verify import verify_atomicmail_webhook

app = Flask(__name__)
# Our payloads are at most 8 KiB; Flask answers 413 above this before the body
# is read, so an unsigned flood cannot exhaust memory.
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024
SECRETS = [
    s for s in (
        os.environ.get("ATOMICMAIL_WEBHOOK_SECRET"),
        os.environ.get("ATOMICMAIL_WEBHOOK_SECRET_PREVIOUS"),
    ) if s
]


@app.post("/webhooks/atomicmail")
def atomicmail_webhook():
    raw = request.get_data()  # the exact bytes, before any JSON parsing
    try:
        webhook_id = verify_atomicmail_webhook(raw, request.headers, SECRETS)
    except ValueError:
        webhook_id = None
    try:
        event = json.loads(raw)
    except ValueError:
        return "", 400

    if event.get("type") == "verification" and (webhook_id or not SECRETS):
        return jsonify(challenge=event["challenge"])
    if not SECRETS:
        return "", 503  # no secret configured yet: we retry the event later
    if webhook_id is None:
        return "", 401

    handle_event(webhook_id, event)  # enqueue; keep this fast
    return "", 204


def handle_event(webhook_id, event):
    # Deduplicate on webhook_id. For message.received, fetch the message by
    # event["data"]["message_id"] through the API.
    print(webhook_id, event["type"], event.get("data", {}).get("message_id", ""))
```

## Test locally

A receiver on your own machine needs a public `https` URL. Use a tunnel such as
[ngrok](https://ngrok.com/) or
[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
(`cloudflared tunnel --url http://localhost:8080`), add the tunnel URL as an
endpoint, then click **Verify** and **Send test**. To just look at what we send,
point an endpoint at a request bin such as [webhook.site](https://webhook.site).

## Delivery, retries and auto-disable

How we read your answer:

| Your answer                                              | Result                                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| any 2xx                                                  | `succeeded`; the endpoint's failure streak resets and `health.last_error` is cleared         |
| 410 Gone                                                 | `failed`, and the **endpoint is turned off** (`gone_410`); its queued deliveries are dropped |
| 429, 502, 503, 504                                       | retried; a `Retry-After` header (seconds or HTTP date) is honoured as a minimum, up to 1 h   |
| other 5xx, timeouts, connection, TLS or DNS errors       | retried on the schedule below                                                                |
| an IPv6-only hostname, or an HTTP answer we cannot parse | retried on the schedule below (`no_ipv4_address`, `invalid_response`)                        |
| 3xx (redirects are never followed), other 4xx            | `failed`, no retry. This includes 401 for a bad signature and 413                            |
| URL no longer allowed, or a non-public address           | `failed`, no retry                                                                           |

Retry schedule: attempt 1 at once, then about +5 s, +1 min, +10 min, +1 h, +6 h,
+8 h and +10 h after the previous attempt (each delay varies by up to 20%),
about 25 hours in all. After the 8th attempt the delivery is `failed`. Every
attempt is signed again with a fresh `webhook-timestamp` and the same
`webhook-id`.

Every non-2xx attempt counts against the endpoint. When an endpoint reaches **10
consecutive failed attempts and the first of them is at least 24 hours old**, it
is turned off (`auto_failing`) and its queued deliveries are dropped. Turn it
back on with the dashboard toggle: this resets
the failure streak and **always runs verification again**; the endpoint is
active only if that passes. Deliveries that were dropped are not resent
automatically; use **Redeliver** in the delivery log.

Deliveries stop (logged as `dropped`) while the inbox is suspended or the owner
has no Google or GitHub sign-in.

## Limits

| Limit                                         | Value                                                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Endpoints per inbox                           | 3                                                                                                           |
| Endpoints per owner, across all their inboxes | 10                                                                                                          |
| Events per endpoint per hour                  | 300; the rest are logged as `dropped` with `hourly_cap`, without their content (they cannot be redelivered) |
| Payload size                                  | 8 KiB                                                                                                       |

**URL rules.** A public `https` URL on port 443 whose hostname has an IPv4 (A)
record and a valid TLS certificate. IP addresses, internal names and private
addresses are refused, and redirects are not followed.

### Fetching messages after an event

Webhook deliveries do not count against any of your inbox's API limits: we read
the mailbox on our side, not through the public API. Fetching the message after
an event does count, exactly like polling:

| Limit                                    | Value                                                                                                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JMAP reads                               | 120 requests per 2 minutes per inbox (every webhook inbox has an owner, so the verified tier applies). One `Email/get` with many ids is one request                                                           |
| Capability tokens (each lives 2 minutes) | Session (CLI and REST): 2 per 2 minutes per session. Inbox API key on the hosted MCP server: 10 per 2 minutes per key. OAuth (MCP, integrations): 5 per 2 minutes per grant and inbox, 5000 per day per owner |

A handler that mints a fresh token for every event hits the token limit long
before the read limit. So:

- **Reuse the token** for its lifetime (cache it for about 90 seconds) instead
  of minting one per event.
- **Batch bursts.** Collect `data.message_id` values for a few seconds and fetch
  them with one `Email/get`.
- **Filter before you fetch.** The sender, size and attachment flag are in the
  payload; fetch only the messages you act on.
- **Answer the webhook first, fetch after.** Return 2xx quickly and fetch
  asynchronously. If your handler answers 5xx because its own fetch was rate
  limited, we retry the delivery and the retry spends your limits again.
- **Webhooks replace polling.** An agent with an endpoint does not need to poll
  every few seconds. If you cannot tolerate a gap (a receiver that was down past
  the ~25-hour retry window misses those events), keep a slow safety poll, every
  15 to 30 minutes.

## Known limitations (v1)

- One event type, `message.received`. No bounce, sent or read events yet.
- Messages moved into the inbox later do not fire. Messages moved out of the
  inbox or deleted within a few seconds of arrival may not fire either (see
  [What fires](#what-fires)).
- Delivery is IPv4 only: a hostname with only AAAA records cannot be verified,
  and its deliveries fail with `no_ipv4_address`.
- Endpoints are managed only in the dashboard, not through the API.
