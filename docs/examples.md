---
description: End-to-end HTTP examples (Python, curl, etc.) for PoW auth, tokens, and JMAP without MCP or AgentSkill wrappers.
---

# Code examples

Plain HTTP, no wrapper: the same calls AgentSkill and MCP make, written out in
Python, Node.js and curl.

- Auth base URL: `https://auth.atomicmail.ai`
- API base URL: `https://api.atomicmail.ai`
- Session discovery: `GET /.well-known/jmap`
- JMAP requests: `POST` to **`apiUrl`** from that JSON (RFC 8620; often under the same API host as discovery)

For full protocol details, see [REST authentication flow](/rest-auth) and
[Raw JMAP requests](/jmap).

## End-to-end flow

<div class="steps">

### Request a challenge

`POST /api/v1/challenge` on the auth service returns a challenge JWT.

### Solve the proof of work

`scrypt`, dynamic difficulty, solved locally.

### Create a session JWT

`POST /api/v1/session`: sign up with `username` or log in with `apiKey`.

### Mint a capability JWT

Exchange the session JWT for a short-lived capability JWT.

### Discover accountId

Call the JMAP session endpoint and read `accountId`.

### Call JMAP

`Email/*` methods with the capability JWT as bearer.

</div>


## Examples by language

<TabGroup group="lang" :tabs="[{ id: 'py', label: 'Python' }, { id: 'js', label: 'Node.js' }, { id: 'curl', label: 'cURL' }]">
<template #py>

**Proof of work, auth and an inbox read.**

This script demonstrates challenge solving and token acquisition, then reads the
latest messages from the inbox.

```python
import base64
import hashlib
import json
import requests

AUTH_BASE = "https://auth.atomicmail.ai"
API_BASE = "https://api.atomicmail.ai"
USERNAME = "myagent"


SALT_HEX = "<pow_scrypt_salt_hex>"


def decode_challenge_jwt(challenge_jwt: str) -> tuple[str, int]:
    parts = challenge_jwt.split(".")
    if len(parts) < 2:
        raise RuntimeError("Malformed challenge JWT")
    payload_b64 = parts[1]
    pad_len = (4 - len(payload_b64) % 4) % 4
    payload_json = base64.urlsafe_b64decode(payload_b64 + ("=" * pad_len)).decode()
    payload = json.loads(payload_json)
    return payload["jti"], int(payload["difficulty"])


def solve_pow(challenge: str, salt_hex: str, difficulty: int) -> tuple[int, str]:
    """
    Find nonce such that scrypt(challenge:nonce) has required leading zero bits.
    """
    # IMPORTANT: use UTF-8 bytes of the hex text, not bytes.fromhex(...).
    # This mirrors the auth service and TS reference client.
    salt = salt_hex.encode("utf-8")
    target_bits = "0" * difficulty
    nonce = 0

    while True:
        data = f"{challenge}:{nonce}".encode()
        digest = hashlib.scrypt(data, salt=salt, n=16384, r=8, p=1, dklen=64)
        bits = bin(int.from_bytes(digest, "big"))[2:].zfill(512)
        if bits.startswith(target_bits):
            return nonce, digest.hex()
        nonce += 1


def parse_bearer_token(header_value: str) -> str:
    if not header_value:
        raise RuntimeError("Missing Authorization header")
    parts = header_value.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise RuntimeError(f"Malformed Authorization header: {header_value}")
    return parts[1].strip()


def get_challenge():
    r = requests.post(f"{AUTH_BASE}/api/v1/challenge")
    r.raise_for_status()
    return parse_bearer_token(r.headers.get("Authorization"))


def register_if_needed(challenge_jwt: str, nonce: int, pow_hex: str, username: str):
    """
    First-time flow. Save returned apiKey securely for future sessions.
    """
    payload = {
        "powHex": pow_hex,
        "nonce": str(nonce),
        "username": username,
    }
    r = requests.post(
        f"{AUTH_BASE}/api/v1/session",
        headers={"Authorization": f"Bearer {challenge_jwt}"},
        json=payload,
    )
    r.raise_for_status()
    return r.json()


def create_session(challenge_jwt: str, nonce: int, pow_hex: str, api_key: str):
    payload = {
        "powHex": pow_hex,
        "nonce": str(nonce),
        "apiKey": api_key,
    }
    r = requests.post(
        f"{AUTH_BASE}/api/v1/session",
        headers={"Authorization": f"Bearer {challenge_jwt}"},
        json=payload,
    )
    r.raise_for_status()
    return parse_bearer_token(r.headers.get("Authorization"))


def create_capability(session_jwt: str):
    r = requests.post(
        f"{AUTH_BASE}/api/v1/capability",
        headers={"Authorization": f"Bearer {session_jwt}"},
    )
    r.raise_for_status()
    return parse_bearer_token(r.headers.get("Authorization"))


def discover_jmap_context(capability_jwt: str):
    r = requests.get(
        f"{API_BASE}/.well-known/jmap",
        headers={"Authorization": f"Bearer {capability_jwt}"},
    )
    r.raise_for_status()
    session = r.json()
    account_id = session["primaryAccounts"]["urn:ietf:params:jmap:mail"]
    jmap_api_url = session["apiUrl"]
    return account_id, jmap_api_url


def get_inbox_mailbox_id(capability_jwt: str, account_id: str, jmap_api_url: str) -> str:
    payload = {
        "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
        "methodCalls": [
            ["Mailbox/query", {"accountId": account_id, "filter": {"role": "inbox"}}, "mq0"],
        ],
    }
    r = requests.post(
        jmap_api_url,
        headers={"Authorization": f"Bearer {capability_jwt}"},
        json=payload,
    )
    r.raise_for_status()
    ids = r.json()["methodResponses"][0][1].get("ids", [])
    if not ids:
        raise RuntimeError("Mailbox/query returned no inbox id")
    return ids[0]


def read_latest_emails(capability_jwt: str, account_id: str, jmap_api_url: str):
    # inMailbox needs a literal mailbox id. A JMAP back-reference resolves only
    # as a top-level "#argument" (RFC 8620 sec. 3.7), never nested inside a
    # filter value, so fetch the inbox id first with its own Mailbox/query.
    inbox_mailbox_id = get_inbox_mailbox_id(capability_jwt, account_id, jmap_api_url)
    payload = {
        "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
        "methodCalls": [
            [
                "Email/query",
                {
                    "accountId": account_id,
                    "filter": {"inMailbox": inbox_mailbox_id},
                    "sort": [{"property": "receivedAt", "isAscending": False}],
                    "limit": 20,
                },
                "q0",
            ],
            [
                "Email/get",
                {
                    "accountId": account_id,
                    "#ids": {"resultOf": "q0", "name": "Email/query", "path": "/ids"},
                    "properties": ["id", "subject", "from", "receivedAt", "preview"],
                },
                "g0",
            ],
        ],
    }

    r = requests.post(
        jmap_api_url,
        headers={"Authorization": f"Bearer {capability_jwt}"},
        json=payload,
    )
    r.raise_for_status()
    return r.json()


if __name__ == "__main__":
    # 1) challenge + PoW
    challenge_jwt = get_challenge()
    challenge, difficulty = decode_challenge_jwt(challenge_jwt)
    nonce, pow_hex = solve_pow(challenge, SALT_HEX, difficulty)

    # 2) register once, then keep apiKey secure
    reg = register_if_needed(challenge_jwt, nonce, pow_hex, USERNAME)
    api_key = reg["apiKey"]
    print("Inbox:", reg["inbox"])

    # 3) session -> capability
    challenge_jwt2 = get_challenge()
    challenge2, difficulty2 = decode_challenge_jwt(challenge_jwt2)
    nonce2, pow_hex2 = solve_pow(challenge2, SALT_HEX, difficulty2)
    session_jwt = create_session(challenge_jwt2, nonce2, pow_hex2, api_key)
    capability_jwt = create_capability(session_jwt)

    # 4) discover accountId + JMAP POST URL, then read inbox
    account_id, jmap_api_url = discover_jmap_context(capability_jwt)
    data = read_latest_emails(capability_jwt, account_id, jmap_api_url)
    emails = data["methodResponses"][1][1].get("list", [])
    for e in emails:
        print("-", e.get("subject"), e.get("from"))
```

</template>
<template #js>

**Send an email with a JMAP batch.**

This example assumes you already have `capabilityJwt` (from the auth flow). It
discovers **`apiUrl`** and **`accountId`** from `GET /.well-known/jmap` (RFC
8620), then resolves the inbox **mailbox id** with `Mailbox/query` (same pattern
as [Raw JMAP requests](/jmap)).

```js
const API_BASE = "https://api.atomicmail.ai";

async function discoverJmapContext(capabilityJwt) {
  const r = await fetch(`${API_BASE}/.well-known/jmap`, {
    headers: { Authorization: `Bearer ${capabilityJwt}` },
  });
  if (!r.ok) throw new Error(await r.text());
  const session = await r.json();
  const accountId = session.primaryAccounts["urn:ietf:params:jmap:mail"];
  const jmapPostUrl = session.apiUrl;
  return { accountId, jmapPostUrl };
}

/** JMAP mailbox id for the account inbox (`role: "inbox"`). */
async function getInboxMailboxId(capabilityJwt, accountId, jmapPostUrl) {
  const payload = {
    using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
    methodCalls: [
      [
        "Mailbox/query",
        { accountId, filter: { role: "inbox" } },
        "mq0",
      ],
    ],
  };
  const r = await fetch(jmapPostUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${capabilityJwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(await r.text());
  const data = await r.json();
  const ids = data.methodResponses?.[0]?.[1]?.ids;
  if (!ids?.length) throw new Error("Mailbox/query returned no inbox id");
  return ids[0];
}

const SENDER = "myagent@atomicmail.ai";

async function sendEmail(capabilityJwt, to, subject, bodyText) {
  const { accountId, jmapPostUrl } = await discoverJmapContext(capabilityJwt);
  const inboxMailboxId = await getInboxMailboxId(
    capabilityJwt,
    accountId,
    jmapPostUrl,
  );

  const payload = {
    using: [
      "urn:ietf:params:jmap:core",
      "urn:ietf:params:jmap:mail",
      "urn:ietf:params:jmap:submission",
    ],
    methodCalls: [
      [
        "Email/set",
        {
          accountId,
          create: {
            draft1: {
              mailboxIds: { [inboxMailboxId]: true },
              from: [{ email: SENDER }],
              to: [{ email: to }],
              subject,
              textBody: [{ partId: "body", type: "text/plain" }],
              bodyValues: {
                body: { value: bodyText },
              },
              keywords: { "$draft": true },
            },
          },
        },
        "s0",
      ],
      [
        "EmailSubmission/set",
        {
          accountId,
          create: {
            sub1: {
              emailId: "#draft1",
              envelope: {
                mailFrom: { email: SENDER },
                rcptTo: [{ email: to }],
              },
            },
          },
        },
        "s1",
      ],
    ],
  };

  const res = await fetch(jmapPostUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${capabilityJwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`JMAP request failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

const TOKEN = "<capabilityJwt>";

sendEmail(TOKEN, "user@example.com", "Hello from Atomic Mail", "This was sent via JMAP.")
  .then((data) => console.log(JSON.stringify(data, null, 2)))
  .catch((err) => console.error(err));
```

</template>
<template #curl>

**The auth sequence, request by request.**

```bash
# 1) challenge
curl -X POST https://auth.atomicmail.ai/api/v1/challenge

# 2) session JWT for signup (first time)
curl -X POST https://auth.atomicmail.ai/api/v1/session \
  -H "Authorization: Bearer <challengeJWT>" \
  -H "Content-Type: application/json" \
  -d '{"powHex":"<powHex>","nonce":"<nonce>","username":"myagent"}'
# Read session JWT from response header:
# Authorization: Bearer <sessionJWT>

# 3) session JWT
curl -X POST https://auth.atomicmail.ai/api/v1/session \
  -H "Authorization: Bearer <challengeJWT>" \
  -H "Content-Type: application/json" \
  -d '{"powHex":"<powHex>","nonce":"<nonce>","apiKey":"<apiKey>"}'
# Read session JWT from response header:
# Authorization: Bearer <sessionJWT>

# 4) capability JWT
curl -X POST https://auth.atomicmail.ai/api/v1/capability \
  -H "Authorization: Bearer <sessionJwt>"
# Read capability JWT from response header:
# Authorization: Bearer <capabilityJWT>
```

Use the returned `capabilityJWT` as bearer token for JMAP requests.

</template>
</TabGroup>

## Related

<LinkRows columns="1" :items="[
  { title: 'REST authentication flow', desc: 'Every call in the token chain', link: '/rest-auth' },
  { title: 'Raw JMAP requests', desc: 'Send, read and attachments as JMAP batches', link: '/jmap' },
  { title: 'Install AgentSkill', desc: 'The same flow as one npx command', link: '/skill-install' },
]" />
