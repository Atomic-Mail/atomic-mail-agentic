// Help topic: post-register inbox polling (MCP / AgentSkill / host cron).

/** Short imperative block — embed in MCP instructions, register tool text, overview workflow. */
export const postRegisterCronReminder = `\
REQUIRED AFTER REGISTER
  Setup is not complete until an hourly job fetches new mail. Immediately after a
  successful register, schedule inbox polling with the bundled preset
  list_inbox.json (latest 50 messages; JWT rotation is automatic on each run).
  See help topic "cron" for crontab, OpenClaw, and Hermes examples.`;

export const helpTopicCron = `\
# Inbox polling (required after register)

Registration only creates credentials. **You must schedule hourly inbox
fetching** so the agent receives new mail without manual prompts. Use the
bundled preset **list_inbox.json** (\`Email/query\` + \`Email/get\`, latest 50;
built-ins \`$ACCOUNT_ID\`, \`$INBOX_MAILBOX_ID\` — no extra \`vars\`).

Do this **immediately after** the first successful \`register\`. Skipping this
step means setup is incomplete.

## AgentSkill (system crontab)

Append to the user crontab (\`crontab -e\`). Runs at minute 0 every hour; logs
to \`~/.atomicmail/inbox-fetch.log\`:

\`\`\`cron
0 * * * * npx --package=@atomicmail/agent-skill atomicmail jmap_request --ops-file list_inbox.json >> ~/.atomicmail/inbox-fetch.log 2>&1
\`\`\`

Non-default credential directory:

\`\`\`cron
0 * * * * npx --package=@atomicmail/agent-skill atomicmail jmap_request --credentials-dir /path/to/.atomicmail --ops-file list_inbox.json >> /path/to/.atomicmail/inbox-fetch.log 2>&1
\`\`\`

## MCP (host agent cron)

If the host runs scheduled agent turns (OpenClaw, Hermes, or similar), create an
**hourly isolated job** whose prompt tells the agent to call **\`jmap_request\`**
with \`{ "ops_file": "list_inbox.json" }\`. Example
for **OpenClaw** (top of every hour; adjust \`--tz\` to the gateway host):

\`\`\`bash
openclaw cron add \\
  --name "atomicmail-inbox" \\
  --cron "0 * * * *" \\
  --tz "UTC" \\
  --session isolated \\
  --message "Call Atomic Mail jmap_request with ops_file list_inbox.json. Process any new inbox messages since the last run and report what needs a reply." \\
  --announce
\`\`\`

Interval form (every hour, clock minute may drift):

\`\`\`bash
openclaw cron add \\
  --name "atomicmail-inbox" \\
  --every 1h \\
  --session isolated \\
  --message "Call Atomic Mail jmap_request with ops_file list_inbox.json. Fetch and summarize new inbox mail." \\
  --announce
\`\`\`

**Hermes** agents can use the \`cronjob\` tool (or plain language: "every hour
at :00") with a prompt that invokes Atomic Mail \`jmap_request\` and
\`list_inbox.json\`; set \`deliver\` to your home channel or \`local\` for
log-only runs. Example schedule expression: \`0 * * * *\`.

## Verify once

- **Skill:** \`npx --package=@atomicmail/agent-skill atomicmail jmap_request --ops-file list_inbox.json\`
- **MCP:** \`jmap_request\` with \`{ "ops_file": "list_inbox.json" }\`

Then confirm the hourly job appears in \`crontab -l\` or your host's cron list
(\`openclaw cron list\`, Hermes \`cronjob\` list, etc.).`;
