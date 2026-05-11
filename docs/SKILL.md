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
- Read built-in documentation (JMAP cheatsheet, presets, troubleshooting) or
  the package README (`atomicmail help --topic readme`).

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
`$SUBJECT` require
`--vars` with a JSON object of strings (same substitution applies to `--ops` and
`--ops-file`).

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
- `list_inbox.json` (latest 50; uses `$INBOX_MAILBOX_ID`)
- `reply.json` (`$MAIL_ID`, `$BODY`)

### 4. Help

```bash
npx --package=@atomicmail/agent-skill atomicmail help
npx --package=@atomicmail/agent-skill atomicmail help --topic jmap_cheatsheet
```

## Security

- `credentials.json` holds the API key (mode `0600`). Do not commit it.
- JWT files are bearer secrets — do not log them.

## Attachments and blobs

### Inline blobs in JMAP (RFC 9404)

Use `Blob/upload` and `Blob/get` through `jmap_request` by adding
`urn:ietf:params:jmap:blob` to `using`. On Atomic Mail, **`Blob/upload`** uses a
**`data`** field with **base64** bytes (not `data:asText`). Prefer bundled preset
**`send_mail_attachment.json`** for upload + send in one batch.

```bash
npx --package=@atomicmail/agent-skill atomicmail jmap_request \
  --ops-file send_mail_attachment.json \
  --vars '{"TO":"you@example.com","SUBJECT":"Hi","BODY":"See file","ATTACHMENT_BASE64":"SGVsbG8=","ATTACHMENT_TYPE":"text/plain","ATTACHMENT_NAME":"note.txt"}'
```

### Separate upload/download templates (RFC 8620)

`credentials.json` stores `uploadUrl` and `downloadUrl` from
`GET /.well-known/jmap`.

- `$UPLOAD_URL` is the RFC 8620 upload template.
- `$DOWNLOAD_URL` is the RFC 8620 download template.

Use these placeholders when building out-of-band blob transfer steps and attach
the resulting `blobId` in follow-up JMAP calls.

## Overriding defaults

- Endpoints: `--auth-url`, `--api-url` or `ATOMIC_MAIL_AUTH_URL`,
  `ATOMIC_MAIL_API_URL`
- Credentials path: `--credentials-dir` or `ATOMIC_MAIL_CREDENTIALS_DIR`
- PoW salt: `--scrypt-salt` or `ATOMIC_MAIL_SCRYPT_SALT`
