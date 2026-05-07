# @atomicmail/agent-skill

Atomic Mail AgentSkill CLI for AI agents. It exposes three commands: `register`,
`jmap_request`, and `help` (same surface as `@atomicmail/mcp`).

## Install / run

```bash
npx --package=@atomicmail/agent-skill atomicmail --help
```

From source:

```bash
deno run -A scripts/cli.ts --help
```

## Quick start

```bash
npx --package=@atomicmail/agent-skill atomicmail register \
  --username "myagent"

npx --package=@atomicmail/agent-skill atomicmail jmap_request \
  --ops '[["Mailbox/get", {"accountId": "$ACCOUNT_ID"}, "m0"]]'
```

## Placeholder substitution

- Built-in placeholders: `$ACCOUNT_ID`, `$INBOX`
- Custom placeholders: any `$VAR_NAME` via `--vars '{"VAR_NAME":"value"}'`
- Works for both `--ops` and `--ops-file`

Example:

```bash
npx --package=@atomicmail/agent-skill atomicmail jmap_request \
  --ops-file send_mail.json \
  --vars '{"TO":"alice@example.com","SUBJECT":"Hello","BODY":"Hi there"}'
```

Bundled presets (available by filename):

- `send_mail.json` (`$TO`, `$SUBJECT`, `$BODY`)
- `list_inbox.json` (`$COUNT`)
- `reply.json` (`$MAIL_ID`, `$BODY`)

`--ops-file` resolves against `--credentials-dir` first, then bundled presets
inside the package.

## Shared state

Credential files in `~/.atomicmail` (mode `0600`):

- `credentials.json`
- `session.jwt`
- `capability.jwt`

The skill and MCP server share this layout.

## Overriding defaults

- Endpoints: `--auth-url`, `--api-url` or `ATOMIC_MAIL_AUTH_URL`,
  `ATOMIC_MAIL_API_URL`
- Credentials path: `--credentials-dir` or `ATOMIC_MAIL_CREDENTIALS_DIR`
- PoW salt: `--scrypt-salt` or `ATOMIC_MAIL_SCRYPT_SALT`
