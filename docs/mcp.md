# @atomicmail/mcp

Atomic Mail MCP server — a local stdio Model Context Protocol server that gives
an AI agent a programmable email inbox over JMAP, with automatic Proof-of-Work
auth and capability-token rotation.

The server is authored in TypeScript on Deno and built with
[`dnt`](https://jsr.io/@deno/dnt) into a Node-compatible npm package, so the
**same source** runs unchanged on Deno, Node, and Bun.

It is the MCP companion to
[`@atomicmail/agent-skill`](https://www.npmjs.com/package/@atomicmail/agent-skill)
— a CLI with identical credential semantics. The MCP and the skill share the
same on-disk layout (`credentials.json` + `session.jwt` + `capability.jwt`).

## Tools exposed

| Tool           | Description                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `register`     | PoW signup; persists credentials. Idempotent when username matches inbox.                                                                                 |
| `jmap_request` | JMAP batch via `ops` or `ops_file`. Uppercase `$VAR_NAME` tokens are substituted (`$ACCOUNT_ID` / `$INBOX` from session; others via optional `vars` map). |
| `help`         | Built-in docs (`topic` optional).                                                                                                                         |

## Install

```bash
npx -y @atomicmail/mcp
bunx @atomicmail/mcp
deno run -A npm:@atomicmail/mcp/atomicmail-mcp
```

Your MCP host spawns this process; see configuration below.

## Defaults

- auth endpoint: `https://auth.atomicmail.ai`
- api endpoint: `https://api.atomicmail.ai`
- credentials directory: `~/.atomicmail`

## Credential files

Mode `0600`:

- `credentials.json` — `{ apiKey, inboxId, authUrl, apiUrl, scryptSalt }`
- `session.jwt` — 4h TTL, rotated via PoW
- `capability.jwt` — 2m TTL, rotated before JMAP calls

Use **`npx atomicmail register`** (from `@atomicmail/agent-skill`) against the
same directory, or the MCP `register` tool.

## MCP host configuration examples

### Cursor

`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "atomicmail": {
      "command": "npx",
      "args": ["-y", "@atomicmail/mcp"]
    }
  }
}
```

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

## Typical agent workflow

1. `register` with a username (or rely on existing `credentials.json`).
2. `jmap_request` with `ops` or `ops_file` (optional `vars` for `$TO`,
   `$SUBJECT`, etc.).
3. `help` when stuck.

## JMAP presets (`ops_file`)

Relative paths first resolve against the credential directory. If a file is not
present there, the runtime falls back to bundled presets shipped in the npm
package.

Bundled presets:

- `send_mail.json` (`$TO`, `$SUBJECT`, `$BODY`)
- `list_inbox.json` (`$COUNT`)
- `reply.json` (`$MAIL_ID`, `$BODY`)

Example:

`{ "ops_file": "list_inbox.json", "vars": { "COUNT": "10" } }`

See `help` with topic `presets`.

## Develop

```bash
deno task start
deno task check
deno task fmt
deno task build:npm
node npm/esm/mcp/src/main.js
```

### Project layout

```
mcp/
├── deno.json
├── build_npm.ts
├── README.md
├── src/
│   ├── main.ts
│   └── tools/
│       ├── register.ts
│       ├── jmap.ts
│       └── help.ts
└── npm/               # dnt output (gitignored)
```

Shared auth/JMAP logic lives in [`../lib/`](../lib/) (`AgentSession`, etc.).

## License

MIT
