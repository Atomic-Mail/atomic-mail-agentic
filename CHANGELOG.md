# Changelog

Notable changes to Atomic Mail Agentic. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

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
