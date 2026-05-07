# @atomicmail/agent-skill

Atomic Mail AgentSkill CLI for shell-capable AI agents. It exposes three
commands: `register`, `jmap_request`, and `help`.

## Install / run

```bash
npx --package=@atomicmail/agent-skill atomicmail --help
```

## Quick start

```bash
npx --package=@atomicmail/agent-skill atomicmail register \
  --username "myagent"

npx --package=@atomicmail/agent-skill atomicmail jmap_request \
  --ops '[["Mailbox/get", {"accountId": "$ACCOUNT_ID"}, "m0"]]'
```

## `jmap_request` and placeholders

- Built-in placeholders: `$ACCOUNT_ID`, `$INBOX`
- Custom placeholders: any `$VAR_NAME` via `--vars '{"VAR_NAME":"value"}'`
- Works for both `--ops` and `--ops-file`

Example:

```bash
npx --package=@atomicmail/agent-skill atomicmail jmap_request \
  --ops-file send_mail.json \
  --vars '{"TO":"alice@example.com","SUBJECT":"Hello","BODY":"Hi there"}'
```

## Presets and placeholders

Presets are reusable JSON files for `jmap_request`:

- Inline JSON: `--ops '[["Mailbox/get", {"accountId":"$ACCOUNT_ID"}, "m0"]]'`
- Preset file: `--ops-file list_inbox.json --vars '{"COUNT":"10"}'`

Resolution order for `--ops-file`:

1. Resolve relative to `--credentials-dir` (default `~/.atomicmail`).
2. If missing, fall back to bundled presets in the package.

Placeholder rules:

- Pattern: `$VAR_NAME`, where `VAR_NAME` matches `^[A-Z][A-Z0-9_]*$`.
- Built-ins: `$ACCOUNT_ID`, `$INBOX`.
- Lowercase `$tokens` such as JMAP back-references (`$draft`) are not matched.
- Custom placeholders: pass string values via `--vars`.
- Resolution order per variable: `--vars` first, then built-in auto-resolvers.
- Built-ins can be overridden via `--vars` using `ACCOUNT_ID` or `INBOX`.
- If any referenced variable is unresolved, `jmap_request` fails with a missing
  variables error.
- Substitution is single-pass: inserted values are not scanned again for nested
  `$VAR_NAME` tokens.

Bundled presets:

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

This is the on-disk state used by the CLI (and MCP).

## Defaults

- auth endpoint: `https://auth.atomicmail.ai`
- api endpoint: `https://api.atomicmail.ai`
- credentials directory: `~/.atomicmail`

## Overriding defaults

- Endpoints: `--auth-url`, `--api-url` or `ATOMIC_MAIL_AUTH_URL`,
  `ATOMIC_MAIL_API_URL`
- Credentials path: `--credentials-dir` or `ATOMIC_MAIL_CREDENTIALS_DIR`
- PoW salt: `--scrypt-salt` or `ATOMIC_MAIL_SCRYPT_SALT`
