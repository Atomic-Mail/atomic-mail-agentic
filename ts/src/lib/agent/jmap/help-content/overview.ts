// Help topic: overview (MCP help / AgentSkill help).

import { postRegisterCronReminder } from "./cron.ts";

export const helpTopicOverview = `\
# Atomic Mail — Overview

Atomic Mail is an email service provider (ESP) designed for AI agents. You
manage mail over JMAP (RFC 8620 + RFC 8621).

## Public surface (identical for MCP and AgentSkill)

Three operations only:

1. **register** — Proof-of-work signup (or idempotent replay when the same
   username matches the inbox already on disk). Usernames are 5–21 characters
   (local-part of \`@atomicmail.ai\`). When a different username is
   requested and credentials already exist, register fails unless forced
   explicitly (\`forced: true\` in MCP / \`--forced\` in AgentSkill). Persists
   credentials and returns \`{ inbox, accountId }\` (and \`apiKey\` on first
   signup).
2. **jmap_request** — Send a JMAP method-call batch; auth and JWT rotation are
   automatic. Pass inline \`ops\` JSON or an \`ops_file\` preset (same
   substitution for both). Session-backed tokens (\`$ACCOUNT_ID\`, \`$INBOX\`,
   \`$INBOX_MAILBOX_ID\`, \`$UPLOAD_URL\`, \`$DOWNLOAD_URL\`) resolve from
   credentials and JMAP session (\`$INBOX\` is always a full mailbox address;
   \`$INBOX_MAILBOX_ID\` is the inbox **mailbox id** for filters and
   \`mailboxIds\` — see **presets** topic). Pass any other \`$NAME\` via MCP
   \`vars\` or \`--vars\`. Optional **attachments** (MCP \`attachments\`, skill
   \`--attachment\`): each file is uploaded to \`uploadUrl\` (RFC 8620), then
   \`$ATTACHMENT_0_BLOB_ID\`, … are substituted into your JMAP JSON.
3. **help** — This documentation (optional \`topic\` / \`--topic\`), or the
   published package README (\`topic\` / \`--topic\` \`readme\`).

## Typical workflow

1. \`register\` with a username (5–21 characters).
2. **Required:** schedule hourly inbox polling with preset \`list_inbox.json\`
   (see **cron** topic — crontab, OpenClaw, Hermes). Setup is incomplete
   without this step.
3. \`jmap_request\` with JMAP method calls (presets may use \`$VAR_NAME\`; pass
   custom values in \`vars\` / \`--vars\`).
4. If stuck, read error hints and call \`help\`.

${postRegisterCronReminder}

Available topics: overview, installation, auth, jmap_cheatsheet, tools,
presets, cron, troubleshooting. Use \`readme\` for the npm package \`README.md\`.`;
