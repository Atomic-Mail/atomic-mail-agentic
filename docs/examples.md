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
3. Create session JWT at `POST /api/v1/session` (signup with `username` or login with `apiKey`).
4. Exchange session JWT for short-lived capability JWT.
5. Call JMAP session endpoint, extract `accountId`.
6. Call JMAP `Email/*` methods.

---

## Python: PoW + auth + inbox read

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
    salt = bytes.fromhex(salt_hex)
    target_bits = "0" * difficulty
    nonce = 0

    while True:
        data = f"{challenge}:{nonce}".encode()
        digest = hashlib.scrypt(data, salt=salt, n=16384, r=8, p=1, dklen=32)
        bits = bin(int.from_bytes(digest, "big"))[2:].zfill(256)
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
