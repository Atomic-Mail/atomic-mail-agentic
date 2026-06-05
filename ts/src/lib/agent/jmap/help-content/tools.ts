// Help topic: tools (MCP help / AgentSkill help).

export const helpTopicTools = `\
# Tool / CLI reference

## register

**MCP input:** \`{ "username": string, "forced"?: boolean }\`  
**Skill:** \`register --username NAME [--forced]\` (or \`--api-key KEY\`).

Usernames must be 5–21 characters (local-part of your \`@atomicmail.ai\`
address).

Creates an inbox or returns the same \`{ inbox, accountId }\` when the
username matches the stored inbox local-part. A **different** username
fails by default to protect existing credentials. To replace credentials in the
directory and register a new inbox, pass **\`forced: true\`** (MCP) or
**\`--forced\`** (skill) explicitly.

**After a successful register you must** schedule an hourly **agent** job that
calls \`jmap_request\` / \`--ops-file\` **\`list_inbox.json\`** (see **cron**
topic — do not cron the CLI alone).

## jmap_request

**MCP input:** \`{ "using"?: string[], "ops"?: string, "ops_file"?: string,
"vars"?: Record<string, string>, "attachments"?: { path, filename?, content_type? }[] }\` —
keys in \`vars\` are names without \`$\` (e.g. \`TO\` for \`$TO\`). Exactly one of
\`ops\` or \`ops_file\`. When \`attachments\` is non-empty, each path is read on
the MCP host, \`POST\`ed to JMAP \`uploadUrl\` (RFC 8620), then
\`$ATTACHMENT_N_BLOB_ID\` / \`$ATTACHMENT_N_NAME\` / \`$ATTACHMENT_N_TYPE\` /
\`$ATTACHMENT_N_SIZE\` and \`$ATTACHMENT_COUNT\` are available in \`ops\` (same
semantics as if you had pasted those strings in \`vars\`).

**Skill:** \`jmap_request --ops '...'\` or \`--ops-file path\` plus
\`--credentials-dir\` (optional), plus optional \`--vars '<json>'\`,
\`--attachment PATH\` (repeatable), \`--attachment-path-base DIR\`, \`--using\`,
\`--dry-run\` (not with \`--attachment\`).

## help

**MCP:** \`{ "topic"?: string }\`  
**Skill:** \`help [--topic TOPIC]\`

Topics: overview, installation, auth, jmap_cheatsheet, tools, presets, cron,
troubleshooting. Topic \`readme\` prints the published package \`README.md\`
(same layout as npm; requires install from npm).`;
