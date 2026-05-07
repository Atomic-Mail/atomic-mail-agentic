# REST API + JMAP Code Examples

This page provides direct HTTP examples for Atomic Mail without MCP/AgentSkill
wrappers.

- Auth base URL: `https://auth.atomicmail.ai`
- API base URL: `https://api.atomicmail.ai`
- Session discovery: `GET /.well-known/jmap`
- JMAP requests: `POST /jmap`

For full protocol details, see [`REST authentication flow`](/rest-auth) and
[`Raw JMAP requests`](/jmap).

## End-to-end flow

1. Request PoW challenge from auth service.
2. Solve PoW (`scrypt`, dynamic difficulty).
3. Register inbox (first time) or create session JWT with existing `apiKey`.
4. Exchange session JWT for short-lived capability JWT.
5. Call JMAP session endpoint, extract `accountId`.
6. Call JMAP `Email/*` methods.

---

## Python: PoW + auth + inbox read

This script demonstrates challenge solving and token acquisition, then reads the
latest messages from the inbox.

```python
import hashlib
import requests

AUTH_BASE = "https://auth.atomicmail.ai"
API_BASE = "https://api.atomicmail.ai"
USERNAME = "myagent"


def solve_pow(challenge: str, salt_hex: str, difficulty: int) -> int:
    """
    Find nonce such that scrypt(challenge:nonce) has required leading zero bits.
    """
    salt = bytes.fromhex(salt_hex)
    target_bits = "0" * difficulty
    nonce = 0

    while True:
        data = f"{challenge}:{nonce}".encode()
        digest = hashlib.scrypt(data, salt=salt, n=16384, r=8, p=1, dklen=32)
        bits = bin(int.from_bytes(digest, "big"))[2:].zfill(256)
        if bits.startswith(target_bits):
            return nonce
        nonce += 1


def get_challenge():
    r = requests.post(f"{AUTH_BASE}/api/v1/challenge")
    r.raise_for_status()
    return r.json()


def register_if_needed(challenge: str, nonce: int, username: str):
    """
    First-time flow. Save returned apiKey securely for future sessions.
    """
    payload = {
        "challenge": challenge,
        "nonce": str(nonce),
        "username": username,
    }
    r = requests.post(f"{AUTH_BASE}/api/v1/register", json=payload)
    r.raise_for_status()
    return r.json()


def create_session(challenge: str, nonce: int, api_key: str):
    payload = {
        "challenge": challenge,
        "nonce": str(nonce),
        "apiKey": api_key,
    }
    r = requests.post(f"{AUTH_BASE}/api/v1/session", json=payload)
    r.raise_for_status()
    return r.json()["sessionJwt"]


def create_capability(session_jwt: str):
    r = requests.post(
        f"{AUTH_BASE}/api/v1/capability",
        headers={"Authorization": f"Bearer {session_jwt}"},
    )
    r.raise_for_status()
    return r.json()["capabilityJwt"]


def discover_account_id(capability_jwt: str):
    r = requests.get(
        f"{API_BASE}/.well-known/jmap",
        headers={"Authorization": f"Bearer {capability_jwt}"},
    )
    r.raise_for_status()
    session = r.json()
    return session["primaryAccounts"]["urn:ietf:params:jmap:mail"]


def read_latest_emails(capability_jwt: str, account_id: str):
    payload = {
        "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
        "methodCalls": [
            [
                "Email/query",
                {
                    "accountId": account_id,
                    "filter": {"inMailbox": "INBOX"},
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
        f"{API_BASE}/jmap",
        headers={"Authorization": f"Bearer {capability_jwt}"},
        json=payload,
    )
    r.raise_for_status()
    return r.json()


if __name__ == "__main__":
    # 1) challenge + PoW
    ch = get_challenge()
    nonce = solve_pow(ch["challenge"], ch["salt"], ch["difficulty"])

    # 2) register once, then keep apiKey secure
    reg = register_if_needed(ch["challenge"], nonce, USERNAME)
    api_key = reg["apiKey"]
    print("Inbox:", reg["inbox"])

    # 3) session -> capability
    ch2 = get_challenge()
    nonce2 = solve_pow(ch2["challenge"], ch2["salt"], ch2["difficulty"])
    session_jwt = create_session(ch2["challenge"], nonce2, api_key)
    capability_jwt = create_capability(session_jwt)

    # 4) discover accountId and read inbox
    account_id = discover_account_id(capability_jwt)
    data = read_latest_emails(capability_jwt, account_id)
    emails = data["methodResponses"][1][1].get("list", [])
    for e in emails:
        print("-", e.get("subject"), e.get("from"))
```

---

## Node.js: send email with JMAP

This example assumes you already have:

- `capabilityJwt` (from auth flow)
- `accountId` (from `/.well-known/jmap`)
- Your sender inbox address

```js
const JMAP_URL = "https://api.atomicmail.ai/jmap";
const ACCOUNT_ID = "<your accountId>";
const TOKEN = "<capabilityJwt>";
const SENDER = "myagent@atomicmail.ai";

async function sendEmail(to, subject, bodyText) {
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
          accountId: ACCOUNT_ID,
          create: {
            draft1: {
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
          accountId: ACCOUNT_ID,
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

  const res = await fetch(JMAP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`JMAP request failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

sendEmail("user@example.com", "Hello from Atomic Mail", "This was sent via JMAP.")
  .then((data) => console.log(JSON.stringify(data, null, 2)))
  .catch((err) => console.error(err));
```

---

## cURL: quick auth sequence

```bash
# 1) challenge
curl -X POST https://auth.atomicmail.ai/api/v1/challenge

# 2) register (first time)
curl -X POST https://auth.atomicmail.ai/api/v1/register \
  -H "Content-Type: application/json" \
  -d '{"challenge":"<challenge>","nonce":"<nonce>","username":"myagent"}'

# 3) session JWT
curl -X POST https://auth.atomicmail.ai/api/v1/session \
  -H "Content-Type: application/json" \
  -d '{"challenge":"<challenge>","nonce":"<nonce>","apiKey":"<apiKey>"}'

# 4) capability JWT
curl -X POST https://auth.atomicmail.ai/api/v1/capability \
  -H "Authorization: Bearer <sessionJwt>"
```

Use the returned `capabilityJwt` as bearer token for JMAP requests.
