---
description: Install and configure the @atomicmail/mcp stdio server, tools (register, jmap_request, help), and host-specific notes for chat-based agents.
---

# @atomicmail/mcp

Atomic Mail MCP server — a local stdio Model Context Protocol server that gives
an AI agent a programmable email inbox over JMAP, with automatic Proof-of-Work
auth and capability-token rotation.

## Install

```json
// mcp.json

{
  "mcpServers": {
    "atomicmail": {
      "command": "npx",
      "args": ["-y", "@atomicmail/mcp"]
    }
  }
}
```

Your MCP host spawns this process; see configuration below.

## Tools exposed

| Tool           | Description                                                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `register`     | PoW signup; persists credentials. Usernames are 5–21 characters (local-part of your `@atomicmail.ai` address). Idempotent when username matches inbox. A different username is rejected unless `forced: true` is passed. |
| `jmap_request` | JMAP batch via `ops` or `ops_file`. Uppercase `$VAR_NAME` tokens are substituted (`$ACCOUNT_ID` / `$INBOX` / `$INBOX_MAILBOX_ID` / `$UPLOAD_URL` / `$DOWNLOAD_URL` from session; others via optional `vars` map). |
| `help`         | Built-in docs (`topic` optional); use `topic: "readme"` for the published package `README.md`.                                                                                                                    |

## Typical MCP workflow

1. Call `register` with a username (or rely on existing `credentials.json`).
   If credentials already exist for a different username, pass `forced: true`
   only after backing up the credential directory.
2. `jmap_request` with `ops` or `ops_file` (optional `vars` for `$TO`,
   `$SUBJECT`, etc.).
3. `help` when stuck.

## `jmap_request` input patterns

`jmap_request` accepts either:

- inline `ops` — a JSON **string** whose value is either a **methodCalls array**
  (for example `[["Mailbox/get", {...}, "m0"]]`) or a full envelope object
  `{ "using": [...], "methodCalls": [...] }`, or
- `ops_file` — path to a JSON file containing the same shapes as `ops`.

When using `ops_file`, relative paths first resolve against the credential
directory. If a file is not present there, the runtime falls back to bundled
presets shipped in the npm package.

### Default `using` for a bare methodCalls array

If `ops` is **only** a methodCalls array (no `using` in the JSON), the server
merges the tool’s default capability list — today
**`urn:ietf:params:jmap:core`** and **`urn:ietf:params:jmap:mail`** only. For
**`EmailSubmission/set`**, **`Blob/upload`**, or **`Blob/get`**, either pass a
full envelope that includes the right URNs in `using`, or rely on your MCP host
passing an extended `using` array on the tool call (when supported). See
[`JMAP using and inline ops`](/jmap-using) for the full picture.

Successful responses may include a top-level **`_next`** field (suggested
follow-ups); that is not part of RFC 8620 — see [`Raw JMAP requests`](/jmap)
(“Successful responses and `_next`”).

## Presets and placeholders

Pass **`vars`** on the **`jmap_request`** tool next to **`ops`** or
**`ops_file`** (not inside the ops JSON string).

Examples:

`{ "ops_file": "list_inbox.json" }`

`{ "ops_file": "send_mail.json", "vars": { "TO": "a@b.com", "SUBJECT": "Hi", "BODY": "..." } }`

**Resolution:** relative `ops_file` paths resolve to the credential directory
first, then bundled presets in the package.

**Preset shadowing:** a file such as `list_inbox.json` in the credential
directory replaces the bundled preset with the same name. After upgrading
`@atomicmail/mcp`, errors about missing placeholders often mean an **older**
preset copy on disk — delete or update it, or pass an absolute `ops_file` path.

**Full** placeholder grammar, built-ins (`$INBOX` vs `$INBOX_MAILBOX_ID`,
attachment tokens, bundled preset names): use the **`help`** tool with topic
**`presets`**.

## Credential files and token lifecycle

Mode `0600`: `credentials.json` (includes `apiKey`, `inboxId`, endpoints, blob
URL templates), `session.jwt` (session bearer, rotated), `capability.jwt` (JMAP
bearer, short TTL). MCP and the AgentSkill CLI create and rotate these
automatically.

For raw HTTP auth steps, see [`REST authentication flow`](/rest-auth).

## Attachments and blobs

- **In-band (RFC 9404):** `Blob/upload` / `Blob/get` in the same JMAP batch as
  mail methods. Shapes, limits, and copy-paste JSON:
  [Raw JMAP requests](./jmap.md#attachments-rfc-9404-inline-blob-flow).
- **Out-of-band (RFC 8620):** session **`uploadUrl`** / **`downloadUrl`**. MCP
  **`attachments`** uploads each local file first, then substitutes
  `$ATTACHMENT_N_BLOB_ID` (and related placeholders) into your ops. Use preset
  **`send_mail_blob_attachment.json`** with **`attachments`**.

When the session advertises blob limits, **`jmap_request`** may **reject before
POST** computable oversize `Blob/upload` payloads and attachment file sizes (see
[RFC 9404 §3.1](https://www.rfc-editor.org/rfc/rfc9404#section-3.1)). If
`maxSizeBlobSet` is `null`, no client octet cap is applied (the server may still
reject the request).

## Defaults

- auth endpoint: `https://auth.atomicmail.ai`
- api endpoint: `https://api.atomicmail.ai`
- credentials directory: `~/.atomicmail`

## Overriding defaults

```json
{
  "mcpServers": {
    "atomicmail": {
      "command": "npx",
      "args": ["-y", "@atomicmail/mcp"],
      "env": {
        "ATOMIC_MAIL_AUTH_URL": "https://custom-auth.example",
        "ATOMIC_MAIL_API_URL": "https://custom-api.example",
        "ATOMIC_MAIL_CREDENTIALS_DIR": "/Users/me/.atomicmail",
        "ATOMIC_MAIL_INBOX_DOMAIN": "mail.example.com",
        "ATOMIC_MAIL_SCRYPT_SALT": "hex-salt-override",
        "ATOMIC_MAIL_API_KEY": "existing-api-key"
      }
    }
  }
}
```
