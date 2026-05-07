---
name: atomicmail
description: Read and write email through the Atomic Mail ESP from an AI agent. Handles proof-of-work authentication and JMAP so the agent thinks in JMAP method calls. Use when the user asks to register an email inbox, list mailboxes, fetch or send email.
license: MIT
compatibility: Requires Deno 2.0+ to run scripts directly, or Node 20+ / Bun 1.1+ via `npx @atomicmail/agent-skill` after publishing. Needs network access to the configured auth-service and api-service.
---

# Atomic Mail

Atomic Mail exposes a programmable inbox over JMAP with PoW signup and JWT
rotation. This skill ships a single CLI entrypoint with three commands:
**`register`**, **`jmap_request`**, and **`help`** — matching the MCP server.

## When to use this skill

- Register a new inbox or log in with an existing API key.
- Send JMAP batches (inline JSON or preset files).
- Read built-in documentation (JMAP cheatsheet, presets, troubleshooting).

## Commands

All invocations use `scripts/cli.ts` or the published binary **`atomicmail`**:

```bash
# Deno (repo)
deno run -A scripts/cli.ts register --username alice
deno run -A scripts/cli.ts jmap_request --ops-file x.json
deno run -A scripts/cli.ts help --topic presets

# Node / Bun (after publish)
npx --package=@atomicmail/agent-skill atomicmail register --username "myagent" ...
npx --package=@atomicmail/agent-skill atomicmail jmap_request --ops-file list_inbox.json --vars '{"COUNT":"10"}'
```

Run **`atomicmail --help`** or **`atomicmail <command> --help`** for flags.

## Defaults

- `authUrl`: `https://auth.atomicmail.ai`
- `apiUrl`: `https://api.atomicmail.ai`
- credentials directory: `~/.atomicmail`

## Workflow

### 1. Register (new account)

```bash
deno run -A scripts/cli.ts register \
  --username "alice"
```

Writes `credentials.json`, `session.jwt`, `capability.jwt`. Prints JSON
including `inbox` and `accountId`.

### 2. Register (existing API key, in case losing the credentials file)

```bash
deno run -A scripts/cli.ts register \
  --api-key "..."
```

### 3. JMAP request

```bash
deno run -A scripts/cli.ts jmap_request \
  --ops '[["Mailbox/get", {"accountId": "$ACCOUNT_ID"}, "m0"]]'
```

`$ACCOUNT_ID` and `$INBOX` resolve from the session/credentials. Other
placeholders such as `$TO` or `$SUBJECT` require `--vars` with a JSON object of
strings (same substitution applies to `--ops` and `--ops-file`).

Preset file:

```bash
deno run -A scripts/cli.ts jmap_request \
  --ops-file fetch_last_100.json
```

With custom placeholders:

```bash
deno run -A scripts/cli.ts jmap_request \
  --ops-file send_mail.json \
  --vars '{"TO":"alice@example.com","SUBJECT":"Hello","BODY":"Hi there"}'
```

Bundled presets (no local file creation required):

- `send_mail.json` (`$TO`, `$SUBJECT`, `$BODY`)
- `list_inbox.json` (`$COUNT`)
- `reply.json` (`$MAIL_ID`, `$BODY`)

### 4. Help

```bash
deno run -A scripts/cli.ts help
deno run -A scripts/cli.ts help --topic jmap_cheatsheet
```

## npm package

From the `skill/` directory:

```bash
deno task build:npm
cd npm && npm publish --access public
```

The published **`atomicmail`** binary exposes `register`, `jmap_request`, and
`help`.

## Security

- `credentials.json` holds the API key (mode `0600`). Do not commit it.
- JWT files are bearer secrets — do not log them.

## Overriding defaults

- Endpoints: `--auth-url`, `--api-url` or `ATOMIC_MAIL_AUTH_URL`,
  `ATOMIC_MAIL_API_URL`
- Credentials path: `--credentials-dir` or `ATOMIC_MAIL_CREDENTIALS_DIR`
- PoW salt: `--scrypt-salt` or `ATOMIC_MAIL_SCRYPT_SALT`

## Building

See repository [`AGENTS.md`](../AGENTS.md) for formatting (`deno fmt`) and
conventions.
