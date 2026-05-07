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
| `jmap_request` | JMAP batch via `ops` or `ops_file`. Uppercase `$VAR_NAME` tokens are substituted (`$ACCOUNT_ID` / `$INBOX` from session; others via optional `vars` map). |
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
- Built-ins: `$ACCOUNT_ID`, `$INBOX`.
- Lowercase `$tokens` such as JMAP back-references (`$draft`) are not matched.
- Custom placeholders: passed in `vars` as string values.
- Resolution order per variable: `vars` first, then built-in auto-resolvers.
- Built-ins can be overridden by providing `ACCOUNT_ID` or `INBOX` in `vars`.
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

- `credentials.json` — `{ apiKey, inboxId, authUrl, apiUrl, scryptSalt }`
- `session.jwt` — 4h TTL, rotated via PoW
- `capability.jwt` — 2m TTL, rotated before JMAP calls

These files are created and rotated automatically by MCP tool calls. AgentSkill
CLI uses the same files.

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
