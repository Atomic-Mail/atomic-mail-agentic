// Help topic: post-register inbox polling (agent invocation, not raw CLI cron).

/** Prompt for hourly inbox jobs — agent fetches mail and stays available for follow-up. */
export const INBOX_CRON_AGENT_PROMPT =
  "Use Atomic Mail to fetch my inbox (MCP jmap_request with ops_file " +
  "list_inbox.json, or atomicmail jmap_request --ops-file list_inbox.json). " +
  "Summarize new messages, highlight what needs a reply, and stay available — " +
  "I may ask you to reply, forward, search, or dig into something important.";

/** Short imperative block — embed in MCP instructions, register tool text, overview workflow. */
export const postRegisterCronReminder = `\
REQUIRED AFTER REGISTER
  Setup is not complete until an hourly job invokes your AGENT to fetch inbox mail
  (preset list_inbox.json). Do NOT cron atomicmail jmap_request alone — that only
  logs JSON and never starts an agent. See help topic "cron" for workflow options.`;

export const helpTopicCron = `\
# Inbox polling (required after register)

Registration only creates credentials. **You must schedule an hourly job that
invokes an AI agent** to fetch and triage mail. The agent should call Atomic
Mail with preset **list_inbox.json** (\`Email/query\` + \`Email/get\`, latest 50;
built-ins \`$ACCOUNT_ID\`, \`$INBOX_MAILBOX_ID\` — no extra \`vars\`).

Do this **immediately after** the first successful \`register\`. Skipping this
step means setup is incomplete.

## What not to do

- **Raw CLI in crontab** — \`atomicmail jmap_request --ops-file list_inbox.json\`
  alone only fetches JSON; no agent runs and nothing prompts you to reply.
- **Headless one-shot CLIs** — \`claude -p\`, \`pi -p\`, \`agent -p\`, \`codex exec\`,
  \`gemini -p\` print and exit; you cannot continue the thread to reply or forward.

## Agent prompt (use in any workflow below)

\`\`\`text
${INBOX_CRON_AGENT_PROMPT}
\`\`\`

Wire Atomic Mail MCP or AgentSkill into the agent before scheduling.

## Pick a workflow

| Your setup | Recommended approach |
| --- | --- |
| OpenClaw gateway | Built-in \`openclaw cron\` (Option 1) |
| Hermes Agent | Built-in \`hermes cron\` / \`cronjob\` tool (Option 1) |
| Atomic Bot (atomicbot.ai) | Same as OpenClaw or Hermes host (Option 1) |
| atomic-agent | Built-in \`atomic-agent task create\` (Option 1) |
| Terminal CLI only (Claude, Pi, Cursor, …) | OS scheduler + interactive launch (Option 2) |

---

## Option 1 — Agent host with built-in cron (preferred)

Runs a **full agent turn** and **delivers** the summary to a chat or file so you
can reply, forward, or ask follow-ups in the same thread.

### OpenClaw

Docs: https://docs.openclaw.ai/automation/cron-jobs

- Schedule: \`--cron "0 * * * *"\` or \`--every 1h\`
- Session: \`--session isolated\` (fresh turn each run)
- Delivery: \`--announce\` (posts to your configured channel)
- Prompt: \`--message\` with the agent prompt above

\`\`\`bash
openclaw cron add \\
  --name "atomicmail-inbox" \\
  --cron "0 * * * *" \\
  --session isolated \\
  --message "${INBOX_CRON_AGENT_PROMPT}" \\
  --announce
\`\`\`

Manage: \`openclaw cron list\` · test: \`openclaw cron run <job-id>\`

### Hermes Agent

Docs: https://hermes-agent.nousresearch.com/docs/user-guide/features/cron

- Schedule: cron expression (\`0 * * * *\`) or natural language (\`every 1h\`)
- Delivery: \`--deliver\` — \`origin\`, \`telegram\`, \`discord\`, \`slack\`,
  \`email\`, \`local\`, etc. (pick where you want to read and reply)
- **Do not** use \`--no-agent\` (script-only; no LLM)

CLI:

\`\`\`bash
hermes cron create "0 * * * *" \\
  "${INBOX_CRON_AGENT_PROMPT}" \\
  --name "atomicmail-inbox" \\
  --deliver origin
\`\`\`

In chat: \`/cron add "0 * * * *" "<prompt>" --deliver origin\` or ask in plain
language. Hermes can also use the \`cronjob\` tool internally.

Manage: \`hermes cron list\` · test: \`hermes cron run <job-id>\`

### Atomic Bot (atomicbot.ai)

Runs OpenClaw or Hermes — use the matching block above.

### atomic-agent

Docs: https://github.com/AtomicBot-ai/atomic-agent

\`\`\`bash
atomic-agent task create \\
  --cron "0 * * * *" \\
  --message "${INBOX_CRON_AGENT_PROMPT}"
\`\`\`

Manage: \`atomic-agent task list\`

---

## Option 2 — Terminal agent + OS scheduler

Use when your agent is a **CLI in a terminal** and you do not have OpenClaw,
Hermes, or similar. The scheduler must **start an interactive session** with the
agent prompt — not call \`atomicmail\` directly.

### Terminal agents (interactive invocation)

| Agent | Start interactively | Avoid for inbox polling |
| --- | --- | --- |
| Claude Code | \`claude "prompt"\` | \`claude -p\` |
| Pi | \`pi "prompt"\` | \`pi -p\` |
| Cursor CLI | \`agent "prompt"\` | \`agent -p\` |
| Gemini CLI | \`gemini -i "prompt"\` | \`gemini -p\` |
| Codex CLI | \`codex\` (TUI) | \`codex exec\` |

Docs: Claude https://code.claude.com/docs/en/cli-reference · Pi
https://pi.dev/docs/latest/usage · Cursor https://cursor.com/docs/cli/overview

Resolve the binary on **your** machine (\`command -v claude\`, \`command -v pi\`,
etc.) and use that path in scripts.

### OS scheduling approaches

Pick what fits your OS and how you work:

**A. Wrapper script + user crontab**

Write a small script that (1) sets any API keys the agent needs, (2) launches
your terminal emulator or GUI session, (3) runs the agent **interactively** with
the prompt. Point crontab at the script. Cron does not load shell startup
files — export env vars inside the script.

**B. macOS LaunchAgent**

A \`LaunchAgents\` plist on a calendar interval often works better than crontab
for opening Terminal or iTerm and starting an interactive agent in the logged-in
GUI session.

**C. Linux graphical session**

Schedule via user crontab or a **systemd user timer**, launching a terminal
emulator only when a graphical session is active (\`DISPLAY\`,
\`DBUS_SESSION_BUS_ADDRESS\` for your session).

**D. Ask the agent once**

Many terminal agents can create the schedule for you after \`register\`: e.g.
"Every hour, fetch my Atomic Mail inbox with list_inbox.json and summarize new
mail so I can reply." Use that if your agent supports cron, LaunchAgents, or
task scheduling tools.

### macOS pattern (conceptual)

1. Scheduler fires (crontab or LaunchAgent).
2. A launcher opens Terminal (or iTerm) in the **logged-in user's GUI session**
   — cron alone often lacks GUI access; \`launchctl asuser\` or LaunchAgents
   are common fixes on macOS.
3. The launcher runs: \`<agent-binary> "<agent prompt>"\` (interactive, not \`-p\`).

### Linux pattern (conceptual)

1. Scheduler fires when a graphical session exists.
2. A terminal emulator runs: \`<agent-binary> "<agent prompt>"\`.

Test manually before automating: run the same command you intend to schedule and
confirm the agent can call \`list_inbox.json\` and wait for your replies.

---

## Verify setup

1. \`register\` succeeded; Atomic Mail MCP or AgentSkill is available to the agent.
2. Run the agent prompt **once manually**; confirm inbox fetch and follow-up work.
3. Confirm the job is registered (\`openclaw cron list\`, \`hermes cron list\`,
   \`atomic-agent task list\`, \`crontab -l\`, or your LaunchAgent / systemd status).`;
