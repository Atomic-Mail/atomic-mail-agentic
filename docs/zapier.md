---
description: Connect Atomic Mail to Zapier—OAuth 2.0 connection, the inbox picker, triggers and actions, and the JMAP behavior behind them.
---

# Zapier

Zaps read and send mail from an Atomic Mail inbox over JMAP, authorized by
[OAuth 2.0](/oauth). A human signs in once, picks an inbox, and the connection is
reusable across every Zap in the account. The Zapier integration is currently in
beta and is available from the Zapier App Directory.

## Auth model

OAuth 2.0 authorization code with PKCE (`S256`), against `https://auth.atomicmail.ai`.
Zapier stores the rotating refresh token on the connection and refreshes the access token
automatically.

The access token is used **directly** as the JMAP bearer; Zapier never handles a
short-lived capability token. See [OAuth 2.0 for third-party apps](/oauth) for the whole
flow, including the error shapes.

## Connection settings

| Field | Value |
| --- | --- |
| Authorize URL | `https://auth.atomicmail.ai/oauth/authorize` |
| Token URL | `https://auth.atomicmail.ai/oauth/token` |
| Scope | `mail.read mail.send` (space-separated) |
| Additional authorize parameter | `resource` = `https://api.atomicmail.ai/jmap` |
| PKCE | Required, `S256` |
| Grant type | Authorization code |

Three settings cause most failed connections:

- `resource` must be exactly `https://api.atomicmail.ai/jmap`, byte for byte, no
  trailing slash. A mismatch fails the authorize step with `invalid_request`.
- `/oauth/authorize` answers to `GET` only. A `POST` returns `404`.
- PKCE cannot be downgraded: `code_challenge_method` must be the literal `S256`.

Getting a `client_id`: register one with
[dynamic client registration](/oauth#getting-a-client-id), passing the redirect URI Zapier
displays (it looks like `https://zapier.com/dashboard/auth/oauth/return/App123CLIAPI/`) as
your `redirect_uris`. It is matched by exact string equality, so copy it verbatim,
trailing slash included.

## Triggers and actions

| Kind | Name | What it does |
| --- | --- | --- |
| Trigger | **New Email** | Fires for each new message in the selected inbox |
| Trigger | **New Email Matching Search** | Same, filtered by a full-text search term |
| Action | **Send Email** | `Email/set` + `EmailSubmission/set` in one batch |
| Action | **Reply To Email** | Replies to a message by ID, in the same thread |
| Action | **Create Draft** | Creates a draft without sending it |

Every step has an **Inbox** dropdown. An OAuth grant covers every inbox its owner has, so
each step names the one it acts as — see below.

Triggers poll: Zapier checks every 1–15 minutes depending on the user's plan,
and deduplicates on the JMAP email ID, so a message never fires twice.

## The inbox picker

Behind the dropdown is the same endpoint any integration can call:

```bash
curl https://auth.atomicmail.ai/api/v1/agents \
  -H "Authorization: Bearer <access token>"
```

`agents[].accountId` becomes the `X-Atomic-Account-Id` header on every JMAP request. The
header is required, must be a UUID, and has no default — a missing or malformed
value is a `400`. Full contract:
[`X-Atomic-Account-Id`](/oauth#x-atomic-account-id-is-required-on-every-jmap-request).

## Sending

Sending needs `mail.send` in the connection's scope. The consent screen lets the human
narrow the grant to read-only, so treat sending as requested-not-guaranteed: a read-only
connection returns 403 with `error: "insufficient_scope"`, and the Zap says to
reconnect and approve sending.

The `From` address is always the inbox being acted as. It is resolved from `Identity/get`,
never rebuilt as `<inboxId>@atomicmail.ai` — accounts on
[custom domains](/custom-domains) have a different address, and the server rejects a
mismatch.

## Not on this path

**Agent self-registration.** Zapier is the human-authorized path: the inbox is created at
the consent screen. An agent that registers its own inbox with proof of work uses the
[REST authentication flow](/rest-auth) instead — that is a different credential model, and
it is not something a Zap does.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Authorize step fails with `invalid_request` | `resource` missing, or not byte-identical to `https://api.atomicmail.ai/jmap` |
| Authorize returns `404` | The request was a `POST`; `/oauth/authorize` is `GET`-only |
| `400` on every step | `X-Atomic-Account-Id` missing or not a UUID — there is no default |
| `403 access_denied` | The selected inbox is not owned by the connected account |
| `403 insufficient_scope` | Send attempted on a `mail.read`-only connection |
| `401 invalid_token` | Access token expired, or the grant was revoked from the dashboard |
| Connection stops working after a while | A refresh token was reused. Rotation invalidates the old one, and reuse revokes the grant — reconnect |
| The Zap says success but no mail arrived | A JMAP `notCreated` was ignored. Set failures arrive inside an HTTP `200` |

## Related

<LinkRows :items="[
  { title: 'OAuth 2.0 for third-party apps', desc: 'The authoritative auth reference', link: '/oauth' },
  { title: 'Raw JMAP requests', desc: 'The calls behind each trigger and action', link: '/jmap' },
  { title: 'n8n', desc: 'Community node on the proof-of-work path', link: '/n8n' },
  { title: 'Dify', desc: 'Marketplace plugin on the proof-of-work path', link: '/dify' },
  { title: 'LangChain', desc: 'Tools for JS and Python agents', link: '/langchain' },
  { title: 'Hosted MCP server', desc: 'Same authorization server, MCP resource', link: '/mcp-remote' },
]" />
