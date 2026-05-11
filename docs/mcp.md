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
| `register`     | PoW signup; persists credentials. Idempotent when username matches inbox.                                                                                                                                         |
| `jmap_request` | JMAP batch via `ops` or `ops_file`. Uppercase `$VAR_NAME` tokens are substituted (`$ACCOUNT_ID` / `$INBOX` / `$INBOX_MAILBOX_ID` / `$UPLOAD_URL` / `$DOWNLOAD_URL` from session; others via optional `vars` map). |
| `help`         | Built-in docs (`topic` optional); use `topic: "readme"` for the published package `README.md`.                                                                                                                    |

## Typical MCP workflow

1. Call `register` with a username (or rely on existing `credentials.json`).
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
passing an extended `using` array on the tool call (when supported).

## Presets and placeholders

Presets are reusable JSON files for `jmap_request` batches. With MCP, pass
`vars` on the **tool** input alongside `ops` or `ops_file` (not inside the ops
JSON string).

Example tool arguments:

`{ "ops_file": "list_inbox.json" }`

`{ "ops_file": "send_mail.json", "vars": { "TO": "a@b.com", "SUBJECT": "Hi", "BODY": "..." } }`

Resolution order for `ops_file`:

1. Resolve relative to credentials directory (`~/.atomicmail` by default).
2. If missing, fall back to bundled presets in the npm package.

**Preset shadowing:** a file such as `list_inbox.json` in the credential
directory **replaces** the bundled preset with the same name. After upgrading
`@atomicmail/mcp`, errors like **missing `$COUNT`** or **missing
`$INBOX_MAILBOX_ID`** usually mean an **older copy** of the preset is still on
disk — delete or update it, or point `ops_file` at an absolute path to a known
JSON file.

Placeholder rules:

- Pattern: `$VAR_NAME`, where `VAR_NAME` matches `^[A-Z][A-Z0-9_]*$`.
- Built-ins: `$ACCOUNT_ID`, `$INBOX`, `$INBOX_MAILBOX_ID`, `$UPLOAD_URL`,
  `$DOWNLOAD_URL`.
- **`$INBOX`** is your mailbox **email address** (from credentials).\
  **`$INBOX_MAILBOX_ID`** is the JMAP **mailbox id** for the inbox
  (`Mailbox/query` with `role: "inbox"`). Use **`$INBOX_MAILBOX_ID`** anywhere
  the API expects a mailbox id (for example `Email/query` → `filter.inMailbox`,
  or `Email/set` → `mailboxIds`).
- Lowercase `$tokens` such as JMAP back-references (`$draft`) are not matched.
- Custom placeholders: passed in `vars` as string values.
- Resolution order per variable: `vars` first, then built-in auto-resolvers.
- Built-ins can be overridden by providing `ACCOUNT_ID`, `INBOX`,
  `INBOX_MAILBOX_ID`, `UPLOAD_URL`, or `DOWNLOAD_URL` in `vars`.
- If any referenced variable is unresolved, `jmap_request` fails with a missing
  variables error.
- Substitution is single-pass: inserted values are not scanned again for nested
  `$VAR_NAME` tokens.

Bundled presets:

- `send_mail.json` — `$TO`, `$SUBJECT`, `$BODY` (draft + submit).
- `list_inbox.json` — latest **50** inbox messages (uses `$INBOX_MAILBOX_ID`; no
  extra vars).
- `reply.json` — `$MAIL_ID`, `$BODY` (reply in-thread).
- `send_mail_attachment.json` — `$TO`, `$SUBJECT`, `$BODY`,
  `$ATTACHMENT_BASE64`, `$ATTACHMENT_TYPE`, `$ATTACHMENT_NAME` (`Blob/upload` +
  send in one batch).

`ops_file` resolves against the credentials directory first, then bundled
presets inside the package.

Example:

`{ "ops_file": "list_inbox.json" }`

## Credential files and token lifecycle

Mode `0600`:

- `credentials.json` —
  `{ apiKey, inboxId, authUrl, apiUrl, scryptSalt, uploadUrl, downloadUrl }`
- `session.jwt` — 1h TTL, rotated via PoW
- `capability.jwt` — 2m TTL, rotated before JMAP calls

These files are created and rotated automatically by MCP tool calls. AgentSkill
CLI uses the same files.

During PoW auth, the challenge JWT is exchanged via `Authorization: Bearer ...`
for both `POST /api/v1/challenge` (response header) and `POST /api/v1/session`
(request header), and session JWT is read from the `POST /api/v1/session`
response header. `POST /api/v1/capability` accepts session JWT via bearer header
and returns capability JWT in the response bearer header. PoW values (`powHex`,
`nonce`) remain in the JSON body for session creation.

## Attachments and blobs

Two blob paths are supported:

- **RFC 9404 in-band blobs** via `Blob/upload` and `Blob/get` over
  `jmap_request`.
- **RFC 8620 out-of-band blobs** via `uploadUrl` and `downloadUrl` templates
  from JMAP session.

### Inline blob flow (RFC 9404)

Add `urn:ietf:params:jmap:blob` and upload bytes in the same JMAP batch.

On Atomic Mail, **`Blob/upload`** expects base64 in a **`data`** property (not
`data:asText` / `data:asBase64`). The created blob’s id is referenced from the
same batch as **`#b1`** when the create key is `b1`.

`Email/set` should include **`mailboxIds`** (map of mailbox id → `true`). Use
**`$INBOX_MAILBOX_ID`** as the key (see placeholders above).
**`EmailSubmission/set`** should include an **`envelope`** with **`mailFrom`**
and **`rcptTo`** (see bundled `send_mail.json`).

The example below uses **`SGVsbG8=`** as sample base64 (UTF-8 `Hello`). For a
parameterised attachment, use preset **`send_mail_attachment.json`** and pass
`ATTACHMENT_BASE64`, `ATTACHMENT_NAME`, and `ATTACHMENT_TYPE` in `vars`.

```json
{
  "using": [
    "urn:ietf:params:jmap:core",
    "urn:ietf:params:jmap:mail",
    "urn:ietf:params:jmap:submission",
    "urn:ietf:params:jmap:blob"
  ],
  "methodCalls": [
    [
      "Blob/upload",
      {
        "accountId": "$ACCOUNT_ID",
        "create": {
          "b1": {
            "data": "SGVsbG8=",
            "type": "text/plain"
          }
        }
      },
      "b0"
    ],
    [
      "Email/set",
      {
        "accountId": "$ACCOUNT_ID",
        "create": {
          "m1": {
            "mailboxIds": { "$INBOX_MAILBOX_ID": true },
            "from": [{ "email": "$INBOX" }],
            "to": [{ "email": "$TO" }],
            "subject": "With attachment",
            "bodyValues": {
              "body1": { "value": "See attachment." }
            },
            "textBody": [{ "partId": "body1", "type": "text/plain" }],
            "attachments": [
              {
                "blobId": "#b1",
                "type": "text/plain",
                "name": "note.txt"
              }
            ]
          }
        }
      },
      "m0"
    ],
    [
      "EmailSubmission/set",
      {
        "accountId": "$ACCOUNT_ID",
        "create": {
          "s1": {
            "emailId": "#m1",
            "envelope": {
              "mailFrom": { "email": "$INBOX" },
              "rcptTo": [{ "email": "$TO" }]
            }
          }
        }
      },
      "s0"
    ]
  ]
}
```

### Separate upload/download flow (RFC 8620)

Use the templated URLs from session/credentials:

- `$UPLOAD_URL` template contains `{accountId}`.
- `$DOWNLOAD_URL` template contains `{accountId}`, `{blobId}`, `{name}`, and
  `{type}`.

Example (MCP flow):

1. Call `jmap_request` to get attachment metadata (for example `Email/get` with
   `attachments`).
2. Expand `$DOWNLOAD_URL` template with account/blob metadata and fetch bytes
   via HTTP bearer auth.
3. To upload bytes, expand `$UPLOAD_URL` with account id and POST binary content
   per RFC 8620 upload endpoint.

### Blob retrieval (RFC 9404)

For in-band retrieval, use `Blob/get` with **`urn:ietf:params:jmap:blob`** in
`using`. Pass the blob id in **`ids`** (for example from **`vars`** as
`"BLOB_ID": "…"` → `"$BLOB_ID"` in ops).

Atomic Mail may reject some property names in **`properties`**; a minimal set
that works is **`data:asBase64`** and **`size`**:

```json
{
  "using": [
    "urn:ietf:params:jmap:core",
    "urn:ietf:params:jmap:blob"
  ],
  "methodCalls": [
    [
      "Blob/get",
      {
        "accountId": "$ACCOUNT_ID",
        "ids": ["$BLOB_ID"],
        "properties": ["data:asBase64", "size"]
      },
      "g0"
    ]
  ]
}
```

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
        "ATOMIC_MAIL_SCRYPT_SALT": "hex-salt-override",
        "ATOMIC_MAIL_API_KEY": "existing-api-key"
      }
    }
  }
}
```
