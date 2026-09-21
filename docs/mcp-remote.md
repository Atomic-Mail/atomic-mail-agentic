---
description: The hosted remote MCP server at mcp.atomicmail.ai—OAuth sign-in or one-step API-key connect, no local code, tool reference, inbox selection, and how it differs from the local stdio server.
---

# Hosted MCP server

`https://mcp.atomicmail.ai/mcp` is a hosted Model Context Protocol server over
Streamable HTTP. Nothing is downloaded, nothing runs locally, no credential
files land on disk. The inboxes belong to a human account, and there are two
ways to authorize: OAuth in the browser, or an inbox API key sent as a bearer
token.

Use it when your host cannot, or should not, run third-party code such as
`npx`. For a local stdio server that registers its own inbox with proof of
work, see the [local MCP server](/mcp).

## Connect

Paste the URL into any MCP client that supports remote servers. Hosts with a
connector UI (ChatGPT, Claude) accept it directly. For JSON-configured hosts:

```json
{
  "mcpServers": {
    "atomicmail": {
      "type": "http",
      "url": "https://mcp.atomicmail.ai/mcp"
    }
  }
}
```

That connects over OAuth. To skip the browser entirely, see the next section.

## One-step connect with an inbox API key

To connect one inbox with no browser round-trip, send that inbox's API key as
a bearer token. No authorization code, no consent screen, no callback URL: the
connection binds to that inbox on the first request.

```json
{
  "mcpServers": {
    "atomicmail": {
      "type": "http",
      "url": "https://mcp.atomicmail.ai/mcp",
      "headers": {
        "Authorization": "Bearer <inbox-api-key>"
      }
    }
  }
}
```

Two other header spellings are accepted, for hosts whose config does not let you
set `Authorization` freely:

```http
X-API-Key: <inbox-api-key>
Authorization: ApiKey <inbox-api-key>
```

The key comes from the inbox's **Connect** dialog in
[the dashboard](https://dashboard.atomicmail.ai). It is the same API key the
local packages accept in `register --api-key`.

Which one to use:

| | API key | OAuth |
| --- | --- | --- |
| Browser needed | No | Yes, once |
| Inboxes reachable | Exactly one — the key's | Any the account owns; `agent_id` selects |
| Consent screen | None | Yes, with scope choice |
| Revocation | Rotate the key in the dashboard | Revoke the grant in the dashboard |
| Best for | Headless hosts, CI, a single dedicated agent inbox | People, multi-inbox setups, anything that should show consent |

The key is a long-lived secret with full access to that inbox. Treat it like a
password: keep it in your host's secret store, not in a committed config file,
and prefer OAuth wherever a person is there to click through it.

## Auth model

OAuth 2.0 authorization code with PKCE (`S256`) and RFC 8707 resource binding.
Connecting opens the browser for Google or GitHub sign-in, then an inbox picker
and a consent screen. Dynamic client registration is supported, so no
pre-registered `client_id` is needed and most MCP clients complete the whole
handshake with no configuration from you.

Discovery is standards-based and automatic:

```bash
curl -s https://mcp.atomicmail.ai/.well-known/oauth-protected-resource/mcp
```

```json
{
  "resource": "https://mcp.atomicmail.ai/mcp",
  "authorization_servers": ["https://auth.atomicmail.ai"],
  "scopes_supported": ["mail.read", "mail.send"],
  "bearer_methods_supported": ["header"]
}
```

The authorization server is the one documented on the [OAuth 2.0](/oauth)
page. The only difference is the `resource` value: `https://mcp.atomicmail.ai/mcp`
here instead of the JMAP resource. Read that page if you drive the flow by hand
rather than through an MCP client.

Grants carry `mail.read` and/or `mail.send`, and can be revoked at any time from
[the dashboard](https://dashboard.atomicmail.ai).

## Tools

| Tool | Purpose |
| --- | --- |
| `read_inbox` | Most recent inbox messages (`agent_id?`, `limit` 1–50, default 25) |
| `read_message` | One full message by `message_id` (headers + plain-text body) |
| `search_messages` | Full-text mailbox search |
| `send_email` | Send a plain-text email (`to`, `subject`, `body`; optional `cc`, `bcc`, base64 `attachments`) |
| `reply_to_message` | Reply in-thread by `message_id` |
| `list_agents` | The inboxes the signed-in account owns |
| `search` / `fetch` | ChatGPT connector convention: `{ id, title, url }` results plus full-document fetch |
| `run_preset` | Bundled JMAP flows by name (`list_inbox`, `send_mail`, `reply`, attachment variants); supports `dry_run` |
| `jmap_request` | Raw JMAP method-call batch (advanced; may be disabled by the operator — `run_preset` always works) |
| `help` | Built-in docs (topics: `overview`, `tools`, `agents`, `auth`, `advanced`, `troubleshooting`) |

`search_messages` is backed by a real full-text index, so `text`, `subject`, and
`body` filters return matches rather than erroring.

## Choosing an inbox

`agent_id` is optional on every tool. When omitted the default is used: the
inbox bound to the connection at consent, or the only owned inbox. With several
inboxes and no default, the tool responds with a prompt to call `list_agents`
and pass one of the returned `accountId` values as `agent_id`. Ownership is
re-verified on every call.

## Security model

The MCP server is an OAuth 2.0 resource server and holds no signing keys.
Access tokens are audience-bound to `https://mcp.atomicmail.ai/mcp` and never
reach the mail backend: each call presents the token to the authorization
server, which mints a capability that lives about two minutes and is scoped to
the chosen inbox. Only that capability travels downstream.

Message bodies returned by `read_message` and `fetch` are wrapped in an
untrusted-content delimiter. Mail is data, not instructions; treat it that way
in your prompts too.

## Differences from the local server

| | Remote (this page) | [Local stdio](/mcp) |
| --- | --- | --- |
| Transport | Streamable HTTP, hosted | stdio, `npx` on your machine |
| Auth | OAuth (Google / GitHub), or an inbox API key as a bearer token | Proof of work, fully autonomous |
| `register` tool | None, inboxes are created in the dashboard | Yes |
| Credentials on disk | None | `~/.atomicmail/` |
| Revocation | Dashboard | Delete the credential files |

There is no `register` tool on the remote server: inbox creation and linking
happen in [the dashboard](https://dashboard.atomicmail.ai) under the human
account. For fully autonomous, no-human registration use the local package or
the [REST/PoW path](/rest-auth).

## Related

<LinkRows :items="[
  { title: 'OAuth 2.0 for third-party apps', desc: 'The auth server behind browser connect', link: '/oauth' },
  { title: 'Local MCP server', desc: 'Run the same tools on your machine via npx', link: '/mcp' },
  { title: 'Using your own domain', desc: 'Custom domains and $INBOX resolution', link: '/custom-domains' },
  { title: 'Raw JMAP requests', desc: 'The method shapes behind jmap_request', link: '/jmap' },
]" />
