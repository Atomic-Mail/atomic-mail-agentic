---
name: atomicmail
description: Read and write email through the Atomic Mail ESP from an AI agent. Handles proof-of-work authentication and JMAP so the agent thinks in JMAP method calls. Use when the user asks to register an email inbox, list mailboxes, fetch or send email.
---

# Atomic Mail

Atomic Mail exposes a programmable inbox over JMAP with PoW signup and JWT
rotation. This skill ships a single CLI entrypoint with three commands:
**`register`**, **`jmap_request`**, and **`help`** — matching the MCP server.

## When to use this skill

- Register a new inbox or log in with an existing API key.
- Send JMAP batches (inline JSON or preset files).
- Read built-in documentation (JMAP cheatsheet, presets, troubleshooting) or the
  package README (`atomicmail help --topic readme`).

**Call `atomicmail help` early and often** — before guessing
placeholders, `using` URNs, or cron setup. Start with `help --topic overview`,
then `presets` before custom `jmap_request` calls and `cron` after `register`.
If installed behavior disagrees with docs elsewhere, trust help from the running
package.

## Commands

```bash
npx --package=@atomicmail/agent-skill atomicmail register --username "myagent"

npx --package=@atomicmail/agent-skill atomicmail jmap_request --ops-file list_inbox.json
```

Run **`atomicmail --help`** or **`atomicmail <command> --help`** for flags.

## Defaults

- `authUrl`: `https://auth.atomicmail.ai`
- `apiUrl`: `https://api.atomicmail.ai`
- credentials directory: `~/.atomicmail`

## Workflow

### 1. Register (new account)

```bash
npx --package=@atomicmail/agent-skill atomicmail register \
  --username "alice"
```

Writes `credentials.json`, `session.jwt`, `capability.jwt`. Prints JSON
including `inbox` and `accountId`.

**Required next step:** schedule an hourly **agent** job that fetches inbox mail
via `list_inbox.json` (see [Hourly inbox cron](#hourly-inbox-cron-required)).
Do not cron `atomicmail jmap_request` alone. Setup is incomplete without the
agent job.

Usernames must be 5–21 characters (local-part of your `@atomicmail.ai`
address).

If credentials already exist for a different username, register fails by
default to protect the old account. To add another inbox without replacing the
current one, pass a separate `--credentials-dir` (MCP: `credentials_dir` on
`register` / `jmap_request`). Use `--forced` only when you intend to replace
credentials in the **same** directory (after backing it up).

### 2. Register (existing API key, in case losing the credentials file)

```bash
npx --package=@atomicmail/agent-skill atomicmail register \
  --api-key "..."
```

### 3. JMAP request

```bash
npx --package=@atomicmail/agent-skill atomicmail jmap_request \
  --ops '[["Mailbox/get", {"accountId": "$ACCOUNT_ID"}, "m0"]]'
```

`$ACCOUNT_ID`, `$INBOX`, `$INBOX_MAILBOX_ID`, `$UPLOAD_URL`, and `$DOWNLOAD_URL`
resolve from the session/credentials. Other placeholders such as `$TO` or
`$SUBJECT` require `--vars` with a JSON object of strings (same substitution
applies to `--ops` and `--ops-file`).

Preset file:

```bash
npx --package=@atomicmail/agent-skill atomicmail jmap_request \
  --ops-file list_inbox.json
```

With custom placeholders:

```bash
npx --package=@atomicmail/agent-skill atomicmail jmap_request \
  --ops-file send_mail.json \
  --vars '{"TO":"alice@example.com","SUBJECT":"Hello","BODY":"Hi there"}'
```

Bundled presets (no local file creation required):

- `send_mail.json` (`$TO`, `$SUBJECT`, `$BODY`)
- `send_mail_attachment.json` (`$TO`, `$SUBJECT`, `$BODY`, `$ATTACHMENT_BASE64`,
  `$ATTACHMENT_TYPE`, `$ATTACHMENT_NAME`)
- `send_mail_blob_attachment.json` (`$TO`, `$SUBJECT`, `$BODY`; pair with
  repeatable **`--attachment PATH`** for RFC 8620 upload →
  `$ATTACHMENT_0_BLOB_ID`, …)
- `list_inbox.json` (latest 50; uses `$INBOX_MAILBOX_ID`) — **used by the hourly agent inbox job**
- `reply.json` (`$MAIL_ID`, `$BODY`)

## Hourly inbox cron (required)

Registration only creates credentials. **Immediately after** the first
successful `register`, schedule an **hourly job that invokes your AI agent** to
fetch and triage mail (`list_inbox.json` inside the agent prompt). You need a
conversation where you can reply, forward, or ask follow-ups — not a log file.

**Do not** cron `atomicmail jmap_request` alone (no agent). **Do not** use
headless one-shot CLIs (`claude -p`, `pi -p`, `codex exec`) if you want to
continue the thread.

### Pick a workflow

| Your setup | Approach |
| --- | --- |
| OpenClaw | `openclaw cron add` with `--announce` |
| Hermes | `hermes cron create` or `/cron` with `--deliver` |
| Atomic Bot | Same as OpenClaw or Hermes |
| atomic-agent | `atomic-agent task create --cron` |
| Terminal CLI (Claude, Pi, Cursor, …) | OS scheduler + interactive agent launch |

Full options, agent prompt, and patterns: `atomicmail help --topic cron` or MCP
`help` topic `cron`.

### Agent prompt (all workflows)

```text
Use Atomic Mail to fetch my inbox (MCP jmap_request with ops_file list_inbox.json, or atomicmail jmap_request --ops-file list_inbox.json). Summarize new messages, highlight what needs a reply, and stay available — I may ask you to reply, forward, search, or dig into something important.
```

### Built-in cron examples

**OpenClaw** — [cron docs](https://docs.openclaw.ai/automation/cron-jobs): isolated
session, `--announce` for delivery.

**Hermes** — [cron docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron):
`--deliver origin` (or `telegram`, `discord`, `email`, …); not `--no-agent`.

**atomic-agent** — `atomic-agent task create --cron "0 * * * *" --message "<prompt>"`

### Terminal agents

Start **interactively** with the prompt: `claude "…"`, `pi "…"`, `agent "…"`,
`gemini -i "…"`. Use a wrapper script + crontab, macOS LaunchAgent, or Linux
systemd user timer — see `help --topic cron` for the decision guide.

### 4. Help

```bash
npx --package=@atomicmail/agent-skill atomicmail help
npx --package=@atomicmail/agent-skill atomicmail help --topic jmap_cheatsheet
```

## Security

- `credentials.json` holds the API key (mode `0600`). Do not commit it.
- JWT files are bearer secrets — do not log them.

## Attachments and blobs

Use **`send_mail_attachment.json`** (in-band base64) or **`send_mail_blob_attachment.json`**
with repeatable **`--attachment PATH`** (RFC 8620 upload — same flow as MCP
**`attachments`**). Rules, limits, and `Blob/upload` JSON shape: **`atomicmail help --topic jmap_cheatsheet`** and [Raw JMAP requests](./jmap.md#attachments-rfc-9404-inline-blob-flow).

```bash
npx --package=@atomicmail/agent-skill atomicmail jmap_request \
  --ops-file send_mail_attachment.json \
  --vars '{"TO":"you@example.com","SUBJECT":"Hi","BODY":"See file","ATTACHMENT_BASE64":"SGVsbG8=","ATTACHMENT_TYPE":"text/plain","ATTACHMENT_NAME":"note.txt"}'
```

## Overriding defaults

- Endpoints: `--auth-url`, `--api-url` or `ATOMIC_MAIL_AUTH_URL`,
  `ATOMIC_MAIL_API_URL`
- Credentials path: `--credentials-dir` or `ATOMIC_MAIL_CREDENTIALS_DIR`
- PoW salt: `--scrypt-salt` or `ATOMIC_MAIL_SCRYPT_SALT`
