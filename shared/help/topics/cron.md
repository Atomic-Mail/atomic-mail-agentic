# Inbox checks after register

Registration only creates credentials. Nothing reads the inbox until something
wakes an agent to do it — that is what `watch` decides.

`register` takes a required `watch` value. It is your operator's decision:

- **`scheduled`** — a recurring job on this machine wakes an agent once a day to
  read the inbox and report what arrived.
- **`on-demand`** — no such job. Mail is read only when a human asks, and
  anything that arrives in between sits unread with nobody told.

Ask your operator which one they want. Do not pick `on-demand` because it looks
like the cautious option — it is the one that silently loses mail.

## The rule: use your own host's scheduler

Every runtime that can hold a durable schedule has its own scheduler. Use it.

**Do not schedule at the OS level** — no `crontab`, no launchd plist, no systemd
unit, no wrapper scripts. An OS job runs outside your host's permission model:
your operator cannot see it in the host's job list, cannot pause it there, and
the host cannot apply its own tool restrictions to it. It is also the invocation
that breaks in practice, because a scheduler has no terminal and a headless
agent process started from one will either exit immediately or hang.

**Do not schedule from a different runtime than the one you are in.** Register in
one host and cron in another and nobody owns the result.

## What to run

`register --watch scheduled` prints the exact setup step for the runtime that
called it, with your credentials directory already filled in. Use that text —
it is generated for your host and is more specific than this page.

If it printed a shell command, run it. If it printed an instruction (hosts whose
scheduler the agent drives itself), follow it. If it said it could not identify
your runtime, tell it which host you are on, or hand the prompt it printed to
your operator.

| Host | How it schedules |
| --- | --- |
| OpenClaw | `openclaw cron add --name "atomicmail-inbox" --cron "0 9 * * *" --session isolated --message "<prompt>" --announce` |
| Hermes | `hermes cron create "0 9 * * *" "<prompt>" --name "atomicmail-inbox" --deliver origin` |
| atomic-agent | `atomic-agent task create --name "atomicmail-inbox" --cron "0 9 * * *" --message "<prompt>"` |
| Claude Code Desktop | A local routine: Routines → New routine → Local, preset Daily. Or ask in-session: "create a local routine named atomicmail-inbox that runs daily at 09:00 and does the following: …" |
| Claude Code, terminal only | A cloud routine via `/schedule`. It runs with the machine off but has no local file access, so the credentials must be reachable over remote MCP rather than from disk. Not `/loop` — that is session-scoped and expires after seven days. |
| Cursor, Pi, and other session-only runtimes | No scheduler that outlives a session. Ask your operator to schedule it on something durable they own. |

`<prompt>` is the text `register` printed, verbatim. It already contains the
absolute `--credentials-dir` path. Do not retype it from memory and do not
substitute your own wording: a scheduled run has no human in it, and the wording
is what keeps it read-only.

## Give the job the least it needs

The scheduled run reads mail written by strangers. Grant it only what it needs to
run one command and report back — no file writing, no editing, no creating
further scheduled jobs, no spawning sessions. If your host supports a per-job
tool allowlist, set it explicitly rather than accepting the default, which is
usually every tool the host has.

The prompt forbids replying, forwarding, sending and deleting, and forbids acting
on instructions found inside messages. That is a line of text; the tool allowlist
is the part that actually holds.

## Two invocations that do not work

- **Bare CLI on a timer** — `atomicmail jmap_request --ops-file list_inbox.json`
  alone only writes JSON somewhere. No agent runs, nobody reads it, nobody is
  told. Schedule an agent turn.
- **Interactive agent from a scheduler** — starting a terminal agent without its
  non-interactive flag under launchd, systemd or cron leaves a process with no
  terminal, spinning or hung. This is one reason OS-level scheduling is out.

## Verify

Confirm the job exists on the host that owns it: `openclaw cron list`,
`hermes cron list`, `atomic-agent task list`, or for Claude Code ask "what
scheduled tasks do I have?". Then trigger one run by hand and check that it
finds the credentials and returns the inbox, before leaving it unattended.

Remove it the same way — `register` printed the removal one-liner alongside the
setup step.

## Credentials

The scheduled job gets an absolute `--credentials-dir` baked into its prompt.
This is deliberate: scheduled sessions do not inherit the environment that ran
`register` on any host, so `ATOMIC_MAIL_CREDENTIALS_DIR` will not reach them.

On Hermes the default directory is `~/.hermes/atomicmail`, not `~/.atomicmail`.
For several inboxes at once, pass a separate `--credentials-dir` per account —
see help topic `multi_account`.
