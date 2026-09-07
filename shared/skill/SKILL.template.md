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
{{ATOMICMAIL_CLI}} register --username "myagent"

{{ATOMICMAIL_CLI}} jmap_request --ops-file list_inbox.json
```

Run **`atomicmail --help`** or **`atomicmail <command> --help`** for flags.

## Defaults

- `authUrl`: `https://auth.atomicmail.ai`
- `apiUrl`: `https://api.atomicmail.ai`
- credentials directory: `{{CREDENTIALS_DIR_DEFAULT}}`

## Workflow

### 1. Register (new account)

```bash
{{ATOMICMAIL_CLI}} register \
  --username "alice" \
  --watch scheduled
```

`--watch` is **required** — it is your operator's decision, not yours; ask them.
Run `register` with no `--watch` to see the accepted values (each is a real
choice about how the operator works, so neither is a safe default to guess). On
the scheduling value, register prints the per-host schedule setup command.

Writes `credentials.json`, `session.jwt`, `capability.jwt`. Prints JSON
including `inbox` and `accountId`.

**Required next step:** the `watch` value decides who reads the inbox (see
[Inbox checks](#inbox-checks-after-register)). On `scheduled`, schedule a daily
**agent** turn with `list_inbox.json` on your runtime's own scheduler — never at
the OS level, and never cron `atomicmail jmap_request` alone.

Usernames must be 5–21 characters (local-part of your `@atomicmail.ai`
address).

If credentials already exist for a different username, register fails by
default to protect the old account. To add another inbox without replacing the
current one, pass a separate `--credentials-dir` (MCP: `credentials_dir` on
`register` / `jmap_request`). Use `--forced` only when you intend to replace
credentials in the **same** directory (after backing it up).

### 2. Register (existing API key, in case losing the credentials file)

```bash
{{ATOMICMAIL_CLI}} register \
  --api-key "..."
```

### 3. JMAP request

```bash
{{ATOMICMAIL_CLI}} jmap_request \
  --ops '[["Mailbox/get", {"accountId": "$ACCOUNT_ID"}, "m0"]]'
```

`$ACCOUNT_ID`, `$INBOX`, `$INBOX_MAILBOX_ID`, `$UPLOAD_URL`, and `$DOWNLOAD_URL`
resolve from the session/credentials. Other placeholders such as `$TO` or
`$SUBJECT` require `--vars` with a JSON object of strings (same substitution
applies to `--ops` and `--ops-file`).

Preset file:

```bash
{{ATOMICMAIL_CLI}} jmap_request \
  --ops-file list_inbox.json
```

With custom placeholders:

```bash
{{ATOMICMAIL_CLI}} jmap_request \
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
- `list_inbox.json` (latest 50; uses `$INBOX_MAILBOX_ID`) — **used for the scheduled inbox check**
- `reply.json` (`$MAIL_ID`, `$BODY`)

## Inbox checks (after register)

Registration only creates credentials. Nothing reads the inbox until something
wakes an agent to do it — that is what the required `watch` value decides, and it
is your operator's call, not yours:

- **`scheduled`** — a recurring job wakes an agent once a day to read the inbox
  and report what arrived.
- **`on-demand`** — no such job; mail is read only when a human asks, and
  anything arriving in between sits unread with nobody told.

### On `scheduled`, use your host's own scheduler

`register` prints the exact setup step for the runtime that called it, with the
credentials directory already filled in, plus the prompt to schedule. Use that
text verbatim — it is generated for your host.

| Your setup | Approach |
| --- | --- |
| OpenClaw | `openclaw cron add` with `--announce` |
| Hermes | `hermes cron create` or `/cron` with `--deliver origin`; not `--no-agent` |
| Atomic Bot | Same as OpenClaw or Hermes |
| atomic-agent | `atomic-agent task create --cron` |
| Claude Code Desktop | A local routine (Routines → New routine → Local); not `/loop`, which expires |
| Cursor, Pi, other session-only runtimes | No durable scheduler — ask your operator to schedule it on something they own |

**Never schedule at the OS level** — no crontab, launchd, systemd or wrapper
scripts. They run outside the host's permission model, so your operator cannot
see or pause the job where they manage their others, and the host cannot apply
its tool restrictions to it. They also break in practice: a scheduler has no
terminal, and an agent started from one hangs or exits at once.

**Never register in one runtime and schedule in another.** Nobody owns the
result.

**Never cron `atomicmail jmap_request` alone** — that only writes JSON somewhere;
no agent runs and nobody is told.

### Give the scheduled job the least it needs

It runs one command and reports back, and what it reads is mail written by
strangers. No file writing, no editing, no creating further scheduled jobs, no
spawning sessions. If your host supports a per-job tool allowlist, set it
explicitly instead of accepting the default.

Full details: `atomicmail help --topic cron` or MCP `help` topic `cron`.

### 4. Help

```bash
{{ATOMICMAIL_CLI}} help
{{ATOMICMAIL_CLI}} help --topic jmap_cheatsheet
```

## Security

- `credentials.json` holds the API key (mode `0600`). Do not commit it.
- JWT files are bearer secrets — do not log them.

## Attachments and blobs

Use **`send_mail_attachment.json`** (in-band base64) or **`send_mail_blob_attachment.json`**
with repeatable **`--attachment PATH`** (RFC 8620 upload — same flow as MCP
**`attachments`**). Rules, limits, and `Blob/upload` JSON shape:
**`atomicmail help --topic jmap_cheatsheet`**.

```bash
{{ATOMICMAIL_CLI}} jmap_request \
  --ops-file send_mail_attachment.json \
  --vars '{"TO":"you@example.com","SUBJECT":"Hi","BODY":"See file","ATTACHMENT_BASE64":"SGVsbG8=","ATTACHMENT_TYPE":"text/plain","ATTACHMENT_NAME":"note.txt"}'
```

## Overriding defaults

- Endpoints: `--auth-url`, `--api-url` or `ATOMIC_MAIL_AUTH_URL`,
  `ATOMIC_MAIL_API_URL`
- Credentials path: `--credentials-dir` or `ATOMIC_MAIL_CREDENTIALS_DIR`
- PoW salt: `--scrypt-salt` or `ATOMIC_MAIL_SCRYPT_SALT`
