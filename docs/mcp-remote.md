---
description: The hosted remote MCP server at mcp.atomicmail.ai—OAuth sign-in, no local code, tool reference, inbox selection, and how it differs from the local stdio server.
---

# Remote MCP server (hosted)

`https://mcp.atomicmail.ai/mcp` is a **hosted** Model Context Protocol server
over Streamable HTTP. Nothing is downloaded, nothing runs locally, and there are
no credential files on disk. Authorization is OAuth in the browser; the inboxes
belong to a human account.

This is the right option for hosts that cannot — or would rather not — execute
third-party code such as `npx`. If you want a **local** stdio server with
autonomous proof-of-work registration instead, see
[`@atomicmail/mcp-gh-pages`](/mcp).

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

## Auth model

OAuth 2.1 — authorization code + PKCE (`S256`) with RFC 8707 resource binding.
Connecting opens the browser for **Google or GitHub** sign-in, then an inbox
picker and a consent screen. Dynamic client registration is supported, so no
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

The authorization server is the same one documented on the
[OAuth 2.0 page](/oauth) — the only difference is the `resource` value, which is
`https://mcp.atomicmail.ai/mcp` here rather than the JMAP resource. Read that
page if you are implementing the flow by hand rather than letting an MCP client
drive it.

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
re-verified on **every** call.

## Security model

The MCP server is an OAuth 2.1 resource server and holds no signing keys.
Access tokens are audience-bound to `https://mcp.atomicmail.ai/mcp` and are
**never forwarded to the mail backend**: each call re-presents the token to the
authorization server to mint a short-lived (~2-minute) capability scoped to the
chosen inbox, and only that capability travels downstream.

Message bodies returned by `read_message` and `fetch` are wrapped in an
untrusted-content delimiter. Mail is data, not instructions — treat it that way
in your prompts too.

## Differences from the local server

| | Remote (this page) | [Local stdio](/mcp) |
| --- | --- | --- |
| Transport | Streamable HTTP, hosted | stdio, `npx` on your machine |
| Auth | OAuth (Google / GitHub) | Proof of work, fully autonomous |
| `register` tool | **None** — inboxes are created in the dashboard | Yes |
| Credentials on disk | None | `~/.atomicmail/` |
| Revocation | Dashboard | Delete the credential files |

There is no `register` tool on the remote server: inbox creation and linking
happen in [the dashboard](https://dashboard.atomicmail.ai) under the human
account. For fully autonomous, no-human registration use the local package or
the [REST/PoW path](/rest-auth).

## See also

- [OAuth 2.0 for third-party apps](/oauth)
- [Local MCP server](/mcp)
- [Raw JMAP requests](/jmap)
