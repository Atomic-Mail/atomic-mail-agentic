# Changelog

Notable changes to Atomic Mail Agentic. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Changed

- **Sent mail is filed in Sent, no longer left as a draft in the inbox.**
  `send_mail.json`, `send_mail_attachment.json`,
  `send_mail_blob_attachment.json` and `reply.json` now create the sender's
  copy in the Sent mailbox and pass `onSuccessUpdateEmail` on
  `EmailSubmission/set`, so a successful send clears `$draft` and sets `$sent`
  (RFC 8621 §7.5). Previously every sent copy stayed in the inbox flagged
  `$draft` forever, which read as "never sent". **Visible change:**
  `list_inbox.json` no longer returns the agent's own sent mail; use the new
  `list_sent.json` for that. Accounts without a Sent mailbox fall back to the
  inbox, as before.

### Fixed

- **`reply.json` sends again.** It copied the original's recipient, subject and
  Message-ID with `#to` / `#subject` / `#inReplyTo` result references inside the
  `Email/set` create object, which RFC 8620 does not allow (references are only
  valid at the top level of method arguments), so the server answered
  `invalidProperties` and nothing was sent. The client now looks the original
  up by `MAIL_ID` and fills `$REPLY_TO` (Reply-To, else From), `$REPLY_SUBJECT`
  (single `Re: ` prefix) and `$REPLY_MESSAGE_ID` (`inReplyTo` / `references`),
  in TypeScript and Python. The preset's inputs are unchanged (`MAIL_ID`,
  `BODY`), so the n8n and Dify reply operations work without changes.

### Added

- `$SENT_MAILBOX_ID` session placeholder (`role: "sent"` mailbox, inbox
  fallback), resolved in TypeScript and Python.
- `list_sent.json` preset: the latest 50 messages the agent sent.

## [0.3.26] - 2026-08-07

### Added

- **Required `watch` parameter on `register`** (`"scheduled"` | `"on-demand"`),
  enforced in the MCP tool and the skill CLI wrappers only — it never reaches
  `session.register()`. Registration cannot complete without an operator-supplied
  value, turning "set up a recurring inbox check" from a request an agent can skip
  into a precondition it must resolve with its operator.
- **Per-host schedule setup on `watch="scheduled"`.** The calling runtime is
  detected from environment-variable markers (`CLAUDECODE`, `OPENCLAW_HOME`,
  `HERMES_SESSION`, `ATOMIC_AGENT`, `CURSOR_*`) — never from `PATH` — and
  `register` prints that host's own scheduler step: `openclaw cron add …`,
  `hermes cron create …`, or a Claude Code local-routine instruction. OS-level
  scheduling (cron/launchd/systemd) is deliberately never generated.
- Scheduled-job prompt bakes in a literal `--credentials-dir` (scheduled sessions
  inherit no environment), a per-inbox job name (`atomicmail-inbox-<user>`) so
  multiple inboxes cannot collide, and least-privilege tool-allowlist guidance.
- **Registration telemetry** (PostHog, MCP path): a `register` event carrying the
  chosen `watch` value and whether/which runtime was detected. No inbox names,
  addresses, or keys.
- Single shared source for all of the above: `shared/help/watch_schedule.json`
  and `shared/help/topics/cron.md`; TypeScript and Python read the same files.

### Changed

- Reworded the missing-`watch` error and the refused-existing-credentials error
  so that asking the operator is the cheapest path: each opens with the
  requirement / irreversible risk, no longer reads as a menu to pick from, and
  defers what the values mean to `help --topic cron`.
- `--forced` removed from `--help` (both CLIs) and from the MCP tool descriptions;
  its danger is documented only in the refusal error.
- Default inbox-check interval is once daily (`0 9 * * *`).
- **Hermes schedule now pins `--skill atomicmail` in the emitted `cron create`
  command** instead of only advising it in prose, so the daily job loads the
  Atomic Mail tool directly rather than depending on the binary resolving on
  `PATH` in a scheduled session that inherits no environment. Verify/least-privilege
  text was updated to match, with a fallback note for builds without the skill.
- **Claude Code schedule now names the real local mechanism** — the
  `scheduled-tasks` MCP (`create_scheduled_task` / `list_scheduled_tasks` /
  `delete_scheduled_task`, stored under `~/.claude/scheduled-tasks/`) — rather than
  the Claude Desktop "Routines" UI, which does not exist in the Claude Code CLI.
  Routines are kept as a Desktop-only footnote, and a first-run tool-approval step
  was added so unattended runs do not stall on a permission prompt.
