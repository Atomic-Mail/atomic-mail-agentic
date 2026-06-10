---
description: Install and run the @atomicmail/agent-skill CLI (register, jmap_request, help) for shell-capable agents and automation.
---

# @atomicmail/agent-skill

Atomic Mail AgentSkill CLI for shell-capable AI agents. It exposes three
commands: `register`, `jmap_request`, and `help`. **`jmap_request`** uses the
same shared library as **`@atomicmail/mcp`**.

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

Usernames must be 5–21 characters (local-part of your `@atomicmail.ai`
address).

If credentials already exist for a different username, `register` fails by
default. Pass `--forced` only after backing up the credential directory.

## Required: hourly agent inbox job

After `register`, **you must** schedule an **hourly AI agent** to fetch and
triage mail with preset `list_inbox.json`. Do **not** cron `atomicmail
jmap_request` alone — that only logs JSON and never invokes an agent.

Pick the workflow that matches your agent host (OpenClaw, Hermes, atomic-agent,
or terminal CLI + OS scheduler). Options and agent prompt:
[`SKILL.md`](./SKILL.md#hourly-inbox-cron-required) · `atomicmail help --topic cron`
· MCP `help` topic `cron`

## `jmap_request`, presets, and placeholders

`jmap_request` accepts inline `--ops` JSON or `--ops-file` (same shapes as MCP:
methodCalls array or full `{ "using", "methodCalls" }`). Pass custom
`$PLACEHOLDERS` via `--vars '{"PLACEHOLDER":"value"}'` (keys without `$`).

```bash
npx --package=@atomicmail/agent-skill atomicmail jmap_request \
  --ops-file send_mail.json \
  --vars '{"TO":"alice@example.com","SUBJECT":"Hello","BODY":"Hi there"}'
```

**Resolution:** relative `--ops-file` resolves to `--credentials-dir` (default
`~/.atomicmail`), then bundled presets.

**Details** (placeholder grammar, built-ins, shadowing, bundled preset list,
attachments): see [@atomicmail/mcp](./mcp.md) and the embedded **`help`** topic
**`presets`** (`atomicmail help --topic presets`).

## Shared state

Each credential **directory** is an isolated account (default `~/.atomicmail`,
mode `0600` files):

- `credentials.json`
- `session.jwt`
- `capability.jwt`

The CLI and MCP read and write the directory you select per command
(`--credentials-dir` / `credentials_dir`) or the default from
`ATOMIC_MAIL_CREDENTIALS_DIR`. Multiple accounts = multiple directories; see
MCP `help` topic `multi_account` or [mcp.md](./mcp.md#multiple-accounts--agents).

## Defaults

- auth endpoint: `https://auth.atomicmail.ai`
- api endpoint: `https://api.atomicmail.ai`
- credentials directory: `~/.atomicmail`

## Overriding defaults

- Endpoints: `--auth-url`, `--api-url` or `ATOMIC_MAIL_AUTH_URL`,
  `ATOMIC_MAIL_API_URL`
- Credentials path: `--credentials-dir` or `ATOMIC_MAIL_CREDENTIALS_DIR`
- PoW salt: `--scrypt-salt` or `ATOMIC_MAIL_SCRYPT_SALT`
