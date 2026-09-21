---
title: Authentication
description: The two ways into an Atomic Mail inbox — proof of work for autonomous agents and OAuth 2.0 for apps and people — side by side, with links to the full flow for each.
---

# Authentication

Two paths exist, and they are for different situations. Both end with the same
inbox and the same JMAP calls; only the way you get a bearer token differs.

## Which path do I want?

| | **Proof of work** | **OAuth 2.0** |
| --- | --- | --- |
| Who owns the inbox | The agent itself | A person's account |
| Who authorizes | Nobody, the agent solves a PoW challenge | The person, in a browser, at a consent screen |
| Credential you store | `apiKey` | Refresh token (rotating) |
| JMAP bearer | A capability JWT you mint and rotate yourself | The OAuth access token, used directly |
| Typical caller | AgentSkill, local MCP server, n8n, Dify, any autonomous agent | Zapier, hosted MCP server, your own app |
| Inbox selection | Implicit, one inbox per credential | Per request, via `X-Atomic-Account-Id` |
| Full reference | [REST authentication flow](/rest-auth) | [OAuth 2.0 for third-party apps](/oauth) |

## Proof of work

An autonomous agent registers its own inbox. No human, no browser, no API key
up front. This is what `register` does in every wrapper on this site.

<div class="steps">

### Challenge

`POST /api/v1/challenge` on `https://auth.atomicmail.ai` returns a challenge
JWT in the `Authorization` header.

### Solve and open a session

Solve the `scrypt` puzzle locally, then `POST /api/v1/session` with the
challenge JWT and the solution. Sign up with a `username` or log in with an
existing `apiKey`. The session JWT lives one hour.

### Mint a capability token

`POST /api/v1/capability` with the session bearer returns a capability JWT
that lives two minutes. Use it as the bearer on JMAP requests and mint a new
one when it expires.

</div>

Wrappers do all of this for you: `register` in [AgentSkill](/skill-install)
and the [local MCP server](/mcp) stores the `apiKey` in `~/.atomicmail`, and
`jmap_request` mints capability tokens as needed. The raw request and
response shapes, error hints and TTLs are on the
[REST authentication flow](/rest-auth) page.

## OAuth 2.0

A person authorizes an application to act on inboxes they own. Authorization
code with PKCE against `https://auth.atomicmail.ai`; the access token is the
JMAP bearer, and every JMAP request names the inbox with
`X-Atomic-Account-Id`.

Use it when a person should own the mailbox: [Zapier](/zapier), the
[hosted MCP server](/mcp-remote) with a browser sign-in, or your own app.
Endpoints, scopes, the resource indicator and the inbox listing call are on
the [OAuth 2.0](/oauth) page.

## Next

<LinkRows columns="1" :items="[
  { title: 'REST authentication flow', desc: 'Challenge, session, capability, every call', link: '/rest-auth' },
  { title: 'OAuth 2.0 for third-party apps', desc: 'Endpoints, PKCE, scopes, account header', link: '/oauth' },
  { title: 'Agent flow', desc: 'Where register fits in the full loop', link: '/getting-started' },
]" />
