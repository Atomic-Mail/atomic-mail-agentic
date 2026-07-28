---
description: Connect Atomic Mail to Make.com—OAuth 2.0 connection settings, the X-Atomic-Account-Id inbox header, and a worked scenario using Make's HTTP OAuth 2.0 module.
---

# Make.com

Make scenarios can read and send mail from an Atomic Mail inbox over JMAP,
authorized by [OAuth 2.0](/oauth). A human signs in once, picks an inbox, and the
connection is reusable across every scenario in the team.

::: info Availability
The **Atomic Mail** custom app is in Make's app-review pipeline and is not yet
listed in the public app directory. Until it is, the same integration works today
with Make's built-in **HTTP → Make an OAuth 2.0 request** module — the setup
below. When the app ships, the connection settings are identical; the modules
just become named ones.
:::

## Auth model

OAuth 2.0 authorization code with PKCE (`S256`), against
`https://auth.atomicmail.ai`. The client is **public** — there is no client
secret. Make stores the rotating refresh token on the connection and refreshes
the access token automatically.

The access token is used **directly** as the JMAP bearer; Make never handles a
short-lived capability token. See [OAuth 2.0 for third-party apps](/oauth) for
the whole flow, including the error shapes.

## Connection settings

Create a connection of type **OAuth 2.0 (authorization code)** with these values:

| Field | Value |
| --- | --- |
| Authorize URI | `https://auth.atomicmail.ai/oauth/authorize` |
| Token URI | `https://auth.atomicmail.ai/oauth/token` |
| Scope | `mail.read mail.send` (space-separated) |
| Scope separator | Space |
| Additional authorize parameter | `resource` = `https://api.atomicmail.ai/jmap` |
| PKCE | Required, `S256` |
| Client authentication | None (public client — leave the secret empty) |

Three of these are load-bearing and are the usual cause of a failed connection:

- **`resource` must be exactly `https://api.atomicmail.ai/jmap`** — byte for
  byte. No trailing slash. A mismatch fails the authorize step with
  `invalid_request`.
- **`/oauth/authorize` answers to `GET` only.** A `POST` returns `404`.
- **PKCE cannot be downgraded.** `code_challenge_method` must be the literal
  `S256`; `plain` and an absent challenge are both rejected.

Getting a `client_id`: register one with
[dynamic client registration](/oauth#getting-a-client-id), passing the redirect
URI Make displays in its connection dialog as your `redirect_uris` — it is
matched by exact string equality, so copy it verbatim. Alternatively, point
`client_id` at an `https://` client-metadata document listing the same URI.

## The inbox header

Every JMAP request needs an `X-Atomic-Account-Id` header naming which inbox to
act as. It is **required**, must be a UUID, and has **no default** — a missing or
malformed header is a `400`. Full contract:
[`X-Atomic-Account-Id`](/oauth#x-atomic-account-id-is-required-on-every-jmap-request).

Fetch the available values once, at the start of a scenario or when building the
connection:

```
GET https://auth.atomicmail.ai/api/v1/agents
Authorization: Bearer <access token>   ← Make adds this
```

Take `agents[].accountId` from the response. In Make's mapping panel that is
<span v-pre>`{{1.body.agents[1].accountId}}`</span> — Make's array indexing is **1-based**, so the
first element is `[1]`, not `[0]`.

## Worked scenario: read the newest inbox messages

**Module 1 — HTTP → Make an OAuth 2.0 request** (list the inboxes)

| Field | Value |
| --- | --- |
| URL | `https://auth.atomicmail.ai/api/v1/agents` |
| Method | `GET` |
| Parse response | Yes |

**Module 2 — HTTP → Make an OAuth 2.0 request** (query + fetch, one round trip)

| Field | Value |
| --- | --- |
| URL | `https://api.atomicmail.ai/jmap` |
| Method | `POST` |
| Header | `X-Atomic-Account-Id` = <span v-pre>`{{1.body.agents[1].accountId}}`</span> |
| Body type | Raw / JSON |
| Parse response | Yes |

```json
{
  "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
  "methodCalls": [
    ["Email/query", {
      "sort": [{ "property": "receivedAt", "isAscending": false }],
      "limit": 10
    }, "q0"],
    ["Email/get", {
      "#ids": { "resultOf": "q0", "name": "Email/query", "path": "/ids" },
      "properties": ["id", "subject", "from", "receivedAt", "preview"]
    }, "g0"]
  ]
}
```

Note there is **no `accountId`** in the method arguments. That is correct and
deliberate — the account is pinned server-side from the header, and a body
`accountId` cannot redirect the request elsewhere. See
[`accountId` in method arguments](/oauth#accountid-in-jmap-method-arguments).

Reading the result, again 1-based: the `Email/get` invocation is
<span v-pre>`{{2.body.methodResponses[2][2].list}}`</span>.

**Module 3 — Iterator** over that list, then whatever your scenario does with
each message.

## Sending

Sending is `Email/set` (create a draft) plus `EmailSubmission/set` (submit it) in
one batch — the shape is in
[Raw JMAP requests](/jmap). Two Make-specific notes:

- The connection needs `mail.send` in its scope. A read-only connection returns
  **403** with `error: "insufficient_scope"`; reconnect and approve sending.
- The `From` address must be the inbox you are acting as. The server rejects a
  mismatch, and — because JMAP reports set failures inside an HTTP `200` — a
  rejection can arrive as a populated `notCreated` rather than an HTTP error.
  Check `notCreated` explicitly in your error handling.

## Full-text search

`Email/query` with a `text`, `subject`, or `body` filter is backed by a real
full-text index, so search modules return matches instead of erroring:

```json
["Email/query", {
  "filter": { "text": "invoice" },
  "sort": [{ "property": "receivedAt", "isAscending": false }],
  "limit": 20
}, "q0"]
```

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Authorize step fails with `invalid_request` | `resource` missing, or not byte-identical to `https://api.atomicmail.ai/jmap` |
| Authorize returns `404` | The request was a `POST`; `/oauth/authorize` is `GET`-only |
| `400` on every JMAP call | `X-Atomic-Account-Id` missing or not a UUID — there is no default |
| `403 access_denied` | The `accountId` is not owned by the signed-in account |
| `403 insufficient_scope` | Send attempted on a `mail.read`-only connection |
| `401 invalid_token` | Access token expired, or the grant was revoked from the dashboard |
| Empty mapped fields | 0-based array index — Make's <span v-pre>`{{ }}`</span> indexing starts at `1` |

## See also

- [OAuth 2.0 for third-party apps](/oauth) — the authoritative auth reference
- [Raw JMAP requests](/jmap)
- [n8n](/n8n) · [Dify](/dify) · [LangChain](/langchain) · [Remote MCP](/mcp-remote)
