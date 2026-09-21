---
description: Install and configure the @atomicmail/mcp stdio server, tools (register, jmap_request, help), and host-specific notes for chat-based agents.
---

# Local MCP server

A local stdio Model Context Protocol server that gives an agent an email inbox
over JMAP. Proof-of-work sign-up and token rotation happen inside the server,
so the agent only ever calls three tools.

::: tip Two MCP servers
This page is the local server: it runs through `npx`, registers its own inbox
with proof of work and keeps credentials on disk. The
[hosted server](/mcp-remote) at `https://mcp.atomicmail.ai/mcp` needs no local
code and signs in with OAuth. Pick it when your host cannot run `npx`, or when a
person should own the mailbox.
:::

## For AI agents

Use the `help` tool as your documentation. Hosts pick tools from short
descriptions; when placeholders, JMAP `using` URNs, attachments or cron setup
are unclear, call `help` instead of guessing from general JMAP knowledge or a
stale README. The topics ship inside the package and match the version your
host runs.

When to call it:

- with no topic, at the start of a mail task
- topic `presets`, before your first non-trivial `jmap_request`
- topic `cron`, right after a successful `register`
- topic `jmap_cheatsheet`, when sending mail or using blobs
- topic `troubleshooting`, when an error mentions placeholders, auth or preset shadowing

When anything else disagrees with help, trust help.

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

Your host starts this process on demand.

## Tools exposed

| Tool           | Description                                                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `register`     | PoW signup; persists credentials. **Two required inputs:** `username` (5–21 characters, the local-part of your address) and `watch` (`"scheduled"` or `"on-demand"` — see [The required `watch` value](#the-required-watch-value)). Idempotent when the username matches the stored inbox. A different username is refused; add a second account with a separate `credentials_dir`. Optional `credentials_dir` per call (parity with AgentSkill `--credentials-dir`). |
| `jmap_request` | JMAP batch via `ops` or `ops_file`. Optional `credentials_dir` per call. Uppercase `$VAR_NAME` tokens are substituted (`$ACCOUNT_ID` / `$INBOX` / `$INBOX_MAILBOX_ID` / `$UPLOAD_URL` / `$DOWNLOAD_URL` from session; others via optional `vars` map). |
| `help`         | Built-in docs (`topic` optional); use `topic: "readme"` for the published package `README.md`. Use `topic: "multi_account"` for multiple inboxes on one MCP server.                                                                                                                    |

## Typical MCP workflow

<div class="steps">

### Register

Call `register` with a `username` **and** a `watch` value (or rely on an
existing `credentials.json`):

```json
{ "username": "myagent", "watch": "scheduled" }
```

Omit `watch` and the call comes back with the requirement rather than an
inbox. If credentials already exist for a different username, pass a
**separate** `credentials_dir` to add another account — the refusal error
spells out the safe path.

### Set up the inbox check

If `watch` was `scheduled`, set up the daily inbox check now. `register`
prints the exact step for the runtime that called it; run that. Hosts with
their own scheduler (OpenClaw, Hermes, atomic-agent, Claude Code) schedule a
once-daily **agent** job whose prompt fetches mail via
`{ "ops_file": "list_inbox.json" }`. Hosts with no durable scheduler should
ask the operator to schedule it on a capable host — do **not** work around
with OS schedulers or cross-platform scheduling, and do **not** cron
`atomicmail jmap_request` alone. Call `help` with topic `cron` for examples.

### Send and read

`jmap_request` with `ops` or `ops_file` (optional `vars` for `$TO`,
`$SUBJECT`, etc.).

### Ask for help

`help` when stuck.

</div>

### The required `watch` value

`register` refuses to run without it. `watch` answers "once this inbox exists,
what causes anyone to look at it?" — a standing commitment on the operator's
machine, so it is **their** decision. Ask them; do not pick one to get past the
error.

| Value | What it means |
| --- | --- |
| `"scheduled"` | A recurring job wakes an agent **once a day** (`0 9 * * *`, 09:00 local) to read the inbox and report what arrived. |
| `"on-demand"` | No such job. Mail is read only when a human asks; anything arriving in between sits unread with nobody told. |

### Inbox checks (after register)

Invoke a **full agent turn** so you can reply, forward, or follow up — not a
raw CLI log or headless one-shot.

| Setup | Workflow |
| --- | --- |
| OpenClaw | `openclaw cron add` + `--announce` |
| Hermes | `hermes cron create` + `--deliver origin --skill atomicmail` |
| Atomic Bot | OpenClaw or Hermes |
| atomic-agent | `atomic-agent task create --cron` |
| Claude Code | the `scheduled-tasks` MCP (`create_scheduled_task`); Claude Desktop: a **Local** routine |
| No durable scheduler (Pi, Cursor, …) | Ask the operator to schedule it on a capable host, or remind manual fetch |

Never schedule at the OS level (crontab, launchd, systemd, wrapper scripts):
those run outside the host's permission model, so the operator cannot see or
pause the job and the host cannot apply its tool restrictions to it. The
scheduled job reads mail written by strangers — give it the smallest tool
allowlist the host offers.

Workflow options and agent prompt: MCP `help` topic `cron`, [`SKILL.md`](./SKILL.md#inbox-checks-after-register), or `atomicmail help --topic cron`.

## `jmap_request` input patterns

`jmap_request` accepts either:

- inline `ops` — a JSON **string** whose value is either a **methodCalls array**
  (for example `[["Mailbox/get", {...}, "m0"]]`) or a full envelope object
  `{ "using": [...], "methodCalls": [...] }`, or
- `ops_file` — path to a JSON file containing the same shapes as `ops`.

When using `ops_file`, relative paths first resolve against the credential
directory. If a file is not present there, the runtime falls back to bundled
presets shipped in the npm package.

### Default `using` for a bare methodCalls array

If `ops` is **only** a methodCalls array (no `using` in the JSON), the server
merges the tool’s default capability list — today
**`urn:ietf:params:jmap:core`** and **`urn:ietf:params:jmap:mail`** only. For
**`EmailSubmission/set`**, **`Blob/upload`**, or **`Blob/get`**, either pass a
full envelope that includes the right URNs in `using`, or rely on your MCP host
passing an extended `using` array on the tool call (when supported). See
[JMAP using and inline ops](/jmap-using) for the full picture.

Successful responses may include a top-level **`_next`** field (suggested
follow-ups); that is not part of RFC 8620 — see [Raw JMAP requests](/jmap)
(“Successful responses and `_next`”).

## Presets and placeholders

Pass **`vars`** on the **`jmap_request`** tool next to **`ops`** or
**`ops_file`** (not inside the ops JSON string).

Examples:

```json
{ "ops_file": "list_inbox.json" }
```

```json
{ "ops_file": "send_mail.json", "vars": { "TO": "a@b.com", "SUBJECT": "Hi", "BODY": "..." } }
```

**Resolution:** relative `ops_file` paths resolve to the credential directory
first, then bundled presets in the package.

**Preset shadowing:** a file such as `list_inbox.json` in the credential
directory replaces the bundled preset with the same name. After upgrading
`@atomicmail/mcp`, errors about missing placeholders often mean an **older**
preset copy on disk — delete or update it, or pass an absolute `ops_file` path.

**Full** placeholder grammar, built-ins (`$INBOX` vs `$INBOX_MAILBOX_ID`,
attachment tokens, bundled preset names): use the **`help`** tool with topic
**`presets`**.

## Credential files and token lifecycle

Mode `0600`: `credentials.json` (includes `apiKey`, `inboxId`, endpoints, blob
URL templates), `session.jwt` (session bearer, rotated), `capability.jwt` (JMAP
bearer, short TTL). MCP and the AgentSkill CLI create and rotate these
automatically.

For raw HTTP auth steps, see [REST authentication flow](/rest-auth). For the
account-based alternative — a human authorizing an app over OAuth, with no PoW
and no credential files — see [OAuth 2.0](/oauth) and the
[hosted MCP server](/mcp-remote).

## Attachments and blobs

- **In-band (RFC 9404):** `Blob/upload` / `Blob/get` in the same JMAP batch as
  mail methods. Shapes, limits, and copy-paste JSON:
  [Raw JMAP requests](./jmap.md#attachments-rfc-9404-inline-blob-flow).
- **Out-of-band (RFC 8620):** session **`uploadUrl`** / **`downloadUrl`**. MCP
  **`attachments`** uploads each local file first, then substitutes
  `$ATTACHMENT_N_BLOB_ID` (and related placeholders) into your ops. Use preset
  **`send_mail_blob_attachment.json`** with **`attachments`**.

When the session advertises blob limits, **`jmap_request`** may **reject before
POST** computable oversize `Blob/upload` payloads and attachment file sizes (see
[RFC 9404 §3.1](https://www.rfc-editor.org/rfc/rfc9404.html#section-3.1)). If
`maxSizeBlobSet` is `null`, no client octet cap is applied (the server may still
reject the request).

## Multiple accounts / agents

One MCP server can manage several isolated inboxes. Pass optional
`credentials_dir` on **`register`** and **`jmap_request`** (same idea as
AgentSkill `--credentials-dir`). When omitted, the default directory applies
(`ATOMIC_MAIL_CREDENTIALS_DIR` or `~/.atomicmail`).

```json
{ "username": "alice", "credentials_dir": "~/.atomicmail/alice" }
{ "ops_file": "list_inbox.json", "credentials_dir": "~/.atomicmail/bob" }
```

- **Add a second account** without touching the first: use a new path on
  `register`. This is the supported way to end up with two inboxes.
- **Replace** the credentials in a directory: there is no normal option for
  this, by design. Registering a different username over existing credentials
  is refused, and the refusal error is the only place the escape hatch is
  documented — because replacing credentials permanently destroys access to the
  current inbox. It is operator-authorized only; if you are reading this as an
  agent, use a separate `credentials_dir` instead.
- **Concurrency:** do not run parallel tool calls against the same
  `credentials_dir` (JWT files have no locking).

Full details: MCP `help` topic **`multi_account`**.

## Environment

Everything has a default; set these in the host's `env` block only when you
need to.

```json
{
  "mcpServers": {
    "atomicmail": {
      "command": "npx",
      "args": ["-y", "@atomicmail/mcp"],
      "env": {
        "ATOMIC_MAIL_CREDENTIALS_DIR": "/Users/me/.atomicmail",
        "ATOMIC_MAIL_API_KEY": "existing-api-key",
        "ATOMIC_MAIL_INBOX_DOMAIN": "mail.example.com"
      }
    }
  }
}
```

`ATOMIC_MAIL_CREDENTIALS_DIR` picks the inbox (default `~/.atomicmail`),
`ATOMIC_MAIL_API_KEY` logs into an existing inbox instead of registering, and
`ATOMIC_MAIL_INBOX_DOMAIN` is explained under
[Using your own domain](/custom-domains).

## Related

<LinkRows :items="[
  { title: 'Hosted MCP server', desc: 'One URL for hosts that cannot run npx', link: '/mcp-remote' },
  { title: 'Install AgentSkill', desc: 'The same commands as a shell CLI', link: '/skill-install' },
  { title: 'Raw JMAP requests', desc: 'The method shapes behind jmap_request', link: '/jmap' },
  { title: 'Agent flow', desc: 'Where register and the watch fit in', link: '/getting-started' },
]" />
