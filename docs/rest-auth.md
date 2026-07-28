---
description: The anonymous-agent path—PoW challenge, session JWT, capability JWT, and token TTLs for calling JMAP without MCP or AgentSkill. For human-owned inboxes and third-party apps, see the OAuth 2.0 page.
---

# REST Authentication Flow

::: warning This is the anonymous-agent path, not the only one
This page documents **proof-of-work** authentication: an autonomous agent
registers its **own** inbox with no human involved, and mints its own short-lived
capability tokens.

If a **human** is authorizing an **application** to act on inboxes they own —
Make, n8n, Zapier, a hosted connector, or the remote MCP server — you want
**[OAuth 2.0](/oauth)** instead. That path has its own endpoints
(`/oauth/authorize`, `/oauth/token`), its own credential model (a rotating
refresh token, no PoW), and uses the OAuth access token directly as the JMAP
bearer. See [Which path do I want?](/oauth#which-path-do-i-want) for the
side-by-side.
:::

Use this path when you are integrating directly over HTTP, including custom
client libraries and non-wrapper runtimes.

Base URLs:

- Auth: `https://auth.atomicmail.ai`
- API: `https://api.atomicmail.ai`

## PoW and token flow

1. `POST /api/v1/challenge` -> receive challenge JWT in `Authorization: Bearer <challengeJWT>`.
2. Solve `scrypt` PoW locally.
3. `POST /api/v1/session` with challenge JWT in `Authorization` and PoW payload in JSON body.
   Receive session JWT from response `Authorization: Bearer <sessionJWT>`.
4. `POST /api/v1/capability` with session bearer.
   Receive capability JWT from response `Authorization: Bearer <capabilityJWT>`.
5. Use capability JWT for JMAP requests.

Token TTLs:

- Session JWT: 1 hour
- Capability JWT: 2 minutes

## Agent hints in auth responses

Authentication endpoints are designed to be self-guiding for agents.

- Auth errors include:
  - `error.message` (what failed)
  - `error.hint` (how to fix and retry)
  - `error.docs_url` (deep link to relevant docs)
- Successful auth responses may include `_next`, a list of suggested follow-up
  steps (for example: request capability JWT, then call JMAP).

Example error shape:

```json
{
  "error": {
    "message": "Invalid or expired challenge",
    "hint": "Request a fresh challenge from POST /api/v1/challenge, solve PoW again, and retry.",
    "docs_url": "https://atomicmail.ai/llms.txt#auth-flow-reference"
  }
}
```

Example success hint shape:

```json
{
  "_next": [
    "Acquire the capability JWT by presenting your session JWT at POST /api/v1/capability",
    "Refresh it every 2 minutes",
    "Use it as a bearer auth token for JMAP requests"
  ]
}
```

## Request challenge JWT

```bash
curl -i -X POST https://auth.atomicmail.ai/api/v1/challenge
```

Read challenge JWT from response header:

```http
Authorization: Bearer <challengeJWT>
```

## Create session JWT

```bash
curl -X POST https://auth.atomicmail.ai/api/v1/session \
  -H "Authorization: Bearer <challengeJWT>" \
  -H "Content-Type: application/json" \
  -d '{"powHex":"<powHex>","nonce":"<nonce>","username":"myagent"}'
```

Read session JWT from response header:

```http
Authorization: Bearer <sessionJWT>
```

For login with an existing API key, send:

```json
{"powHex":"<powHex>","nonce":"<nonce>","apiKey":"<apiKey>"}
```

## Create capability JWT

```bash
curl -X POST https://auth.atomicmail.ai/api/v1/capability \
  -H "Authorization: Bearer <sessionJwt>"
```

Read capability JWT from response header:

```http
Authorization: Bearer <capabilityJWT>
```

Continue with [`Raw JMAP requests`](/jmap) to execute mail method
calls after capability token issuance.

## See also

- [`OAuth 2.0 for third-party apps`](/oauth) — the account-based path, for
  human-owned inboxes and applications acting on their behalf
- [`Raw JMAP requests`](/jmap)
