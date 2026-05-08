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

| Tool           | Description                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `register`     | PoW signup; persists credentials. Idempotent when username matches inbox.                                                                                 |
| `jmap_request` | JMAP batch via `ops` or `ops_file`. Uppercase `$VAR_NAME` tokens are substituted (`$ACCOUNT_ID` / `$INBOX` / `$UPLOAD_URL` / `$DOWNLOAD_URL` from session; others via optional `vars` map). |
| `help`         | Built-in docs (`topic` optional).                                                                                                                         |

## Typical MCP workflow

1. Call `register` with a username (or rely on existing `credentials.json`).
2. `jmap_request` with `ops` or `ops_file` (optional `vars` for `$TO`,
   `$SUBJECT`, etc.).
3. `help` when stuck.

## `jmap_request` input patterns

`jmap_request` accepts either:

- inline `ops` (JMAP methodCalls array), or
- `ops_file` (JSON file path)

When using `ops_file`, relative paths first resolve against the credential
directory. If a file is not present there, the runtime falls back to bundled
presets shipped in the npm package.

## Presets and placeholders

Presets are reusable JSON files for `jmap_request` batches:

- Inline JSON: `{"ops":[...],"vars":{"COUNT":"10"}}`
- Preset file: `{"ops_file":"list_inbox.json","vars":{"COUNT":"10"}}`

Resolution order for `ops_file`:

1. Resolve relative to credentials directory (`~/.atomicmail` by default).
2. If missing, fall back to bundled presets in the npm package.

Placeholder rules:

- Pattern: `$VAR_NAME`, where `VAR_NAME` matches `^[A-Z][A-Z0-9_]*$`.
- Built-ins: `$ACCOUNT_ID`, `$INBOX`, `$UPLOAD_URL`, `$DOWNLOAD_URL`.
- Lowercase `$tokens` such as JMAP back-references (`$draft`) are not matched.
- Custom placeholders: passed in `vars` as string values.
- Resolution order per variable: `vars` first, then built-in auto-resolvers.
- Built-ins can be overridden by providing `ACCOUNT_ID`, `INBOX`, `UPLOAD_URL`, or `DOWNLOAD_URL` in `vars`.
- If any referenced variable is unresolved, `jmap_request` fails with a missing
  variables error.
- Substitution is single-pass: inserted values are not scanned again for nested
  `$VAR_NAME` tokens.

Bundled presets:

- `send_mail.json` (`$TO`, `$SUBJECT`, `$BODY`)
- `list_inbox.json` (`$COUNT`)
- `reply.json` (`$MAIL_ID`, `$BODY`)

`ops-file` resolves against credentials directory first, then bundled presets
inside the package.

Example:

`{ "ops_file": "list_inbox.json", "vars": { "COUNT": "10" } }`

## Credential files and token lifecycle

Mode `0600`:

- `credentials.json` — `{ apiKey, inboxId, authUrl, apiUrl, scryptSalt, uploadUrl, downloadUrl }`
- `session.jwt` — 4h TTL, rotated via PoW
- `capability.jwt` — 2m TTL, rotated before JMAP calls

These files are created and rotated automatically by MCP tool calls. AgentSkill
CLI uses the same files.

## Attachments and blobs

Two blob paths are supported:

- **RFC 9404 in-band blobs** via `Blob/upload` and `Blob/get` over `jmap_request`.
- **RFC 8620 out-of-band blobs** via `uploadUrl` and `downloadUrl` templates from JMAP session.

### Inline blob flow (RFC 9404)

Add `urn:ietf:params:jmap:blob` and upload data in the same JMAP batch:

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
            "data:asText": "Hello attachment",
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
        "create": { "s1": { "emailId": "#m1" } }
      },
      "s0"
    ]
  ]
}
```

### Separate upload/download flow (RFC 8620)

Use the templated URLs from session/credentials:

- `$UPLOAD_URL` template contains `{accountId}`.
- `$DOWNLOAD_URL` template contains `{accountId}`, `{blobId}`, `{name}`, and `{type}`.

Example (MCP flow):

1. Call `jmap_request` to get attachment metadata (for example `Email/get` with `attachments`).
2. Expand `$DOWNLOAD_URL` template with account/blob metadata and fetch bytes via HTTP bearer auth.
3. To upload bytes, expand `$UPLOAD_URL` with account id and POST binary content per RFC 8620 upload endpoint.

### Blob retrieval (RFC 9404)

For in-band retrieval, use `Blob/get`:

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
        "properties": ["id", "data:asBase64", "size", "type"]
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
