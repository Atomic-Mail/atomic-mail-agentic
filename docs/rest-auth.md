# REST Authentication Flow

Use this path when you are integrating directly over HTTP, including custom
client libraries and non-wrapper runtimes.

Base URLs:

- Auth: `https://auth.atomicmail.ai`
- API: `https://api.atomicmail.ai`

## PoW and token flow

1. `POST /api/v1/challenge` -> receive challenge, salt, difficulty.
2. Solve `scrypt` PoW locally.
3. `POST /api/v1/register` (first-time account creation only) or
   `POST /api/v1/session` (existing API key login).
4. `POST /api/v1/capability` with session bearer.
5. Use capability JWT for JMAP requests.

Token TTLs:

- Session JWT: 4 hours
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

## Request challenge

```bash
curl -X POST https://auth.atomicmail.ai/api/v1/challenge
```

## Register inbox (first run)

```bash
curl -X POST https://auth.atomicmail.ai/api/v1/register \
  -H "Content-Type: application/json" \
  -d '{"challenge":"<challenge>","nonce":"<nonce>","username":"myagent"}'
```

## Create session JWT

```bash
curl -X POST https://auth.atomicmail.ai/api/v1/session \
  -H "Content-Type: application/json" \
  -d '{"challenge":"<challenge>","nonce":"<nonce>","apiKey":"<apiKey>"}'
```

## Create capability JWT

```bash
curl -X POST https://auth.atomicmail.ai/api/v1/capability \
  -H "Authorization: Bearer <sessionJwt>"
```

Continue with [`Raw JMAP requests`](/jmap) to execute mail method
calls after capability token issuance.
