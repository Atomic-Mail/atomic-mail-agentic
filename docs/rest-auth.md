---
description: The anonymous-agent path—PoW challenge, session JWT, capability JWT, and token TTLs for calling JMAP without MCP or AgentSkill. For human-owned inboxes and third-party apps, see the OAuth 2.0 page.
---

# REST authentication flow

::: info Not the only path
This page is proof of work: the agent registers its own inbox and mints its own
tokens, no human involved. When a person authorizes an app on inboxes they own
(Zapier, n8n, the hosted MCP server), use [OAuth 2.0](/oauth) instead. The two
paths are compared on the [Authentication](/authentication) page.
:::

Use this path when you talk to the API over plain HTTP: a custom client
library, or a runtime the wrappers do not cover.

Base URLs:

- Auth: `https://auth.atomicmail.ai`
- API: `https://api.atomicmail.ai`

## PoW and token flow

<div class="steps">

### Request a challenge

`POST /api/v1/challenge` returns the challenge JWT in
`Authorization: Bearer <challengeJWT>`.

### Solve the proof of work

Solve the `scrypt` puzzle locally.

### Open a session

`POST /api/v1/session` with the challenge JWT in `Authorization` and the PoW
payload in the JSON body. The session JWT comes back in
`Authorization: Bearer <sessionJWT>`.

### Mint a capability token

`POST /api/v1/capability` with the session bearer. The capability JWT comes
back in `Authorization: Bearer <capabilityJWT>`.

### Call JMAP

Use the capability JWT as the bearer on JMAP requests.

</div>

Token TTLs:

- Session JWT: 1 hour
- Capability JWT: 2 minutes

## Agent hints in auth responses

The auth endpoints explain themselves to agents.

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

With a capability JWT in hand, continue with [Raw JMAP requests](/jmap).

## Related

<LinkRows :items="[
  { title: 'Authentication', desc: 'Proof of work and OAuth 2.0 side by side', link: '/authentication' },
  { title: 'OAuth 2.0 for third-party apps', desc: 'The path for human-owned inboxes', link: '/oauth' },
  { title: 'Raw JMAP requests', desc: 'What to send with the capability JWT', link: '/jmap' },
  { title: 'Code examples', desc: 'This chain in Python, Node.js and curl', link: '/examples' },
]" />
