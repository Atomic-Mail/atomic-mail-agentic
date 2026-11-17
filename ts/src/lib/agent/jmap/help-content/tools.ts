// Help topic: tools (MCP help / AgentSkill help).

export const helpTopicTools = `\
# Tool / CLI reference

## register

**MCP input:** \`{ "username": string, "credentials_dir"?: string, "forced"?: boolean }\`  
**Skill:** \`register --username NAME [--credentials-dir DIR] [--forced]\` (or \`--api-key KEY\`).

Usernames must be 5–21 characters (local-part of your \`@atomicmail.ai\`
address).

Creates an inbox or returns the same \`{ inbox, accountId }\` when the
username matches the stored inbox local-part. A **different** username
fails by default to protect existing credentials. To add another account without
replacing the current one, pass a **separate** \`credentials_dir\` (MCP) or
\`--credentials-dir\` (skill) — see **multi_account** topic. To replace
credentials in the **same** directory, pass **\`forced: true\`** (MCP) or
**\`--forced\`** (skill) explicitly after backing up.

**After a successful register,** the operator's \`watch\` value decides who reads
the inbox (see **cron** topic — schedule a daily agent turn on your runtime's own
scheduler, with
\`list_inbox.json\`; no-native-cron hosts ask the operator or remind manual
fetch).

## Everyday mail (no JMAP needed)

The stdio MCP server and the CLI have the same tools as the hosted MCP server. In
the CLI each argument is a kebab-case flag.

- \`read_inbox\` (\`limit?\` 1-50, default 25) — latest inbox messages.
- \`read_message\` (\`message_id\`) — one message: headers, attachments with
  \`blobId\`, and the body as plain text inside an untrusted-content delimiter.
- \`search_messages\` (\`query\`, \`limit?\`) — full-text search of all mailboxes.
- \`send_email\` (\`to\`, \`subject\`, \`body?\`, \`html_body?\`, \`cc?\`, \`bcc?\`,
  \`from_name?\`, \`reply_to?\`, \`attachments?\`) — needs \`body\` and/or
  \`html_body\`; with \`html_body\` alone the plain-text part is derived from it.
  \`from_name\` is the display name on From (no \`@\`, \`<\` or \`>\`, at most 100
  characters). MCP \`attachments\`: \`{ path }\` or \`{ filename, data_base64 }\`;
  CLI: \`--attachment PATH\`, and \`--body-file\` / \`--html-body-file\` for long
  bodies.
- \`reply_to_message\` (\`message_id\`, \`body?\`, \`html_body?\`, \`from_name?\`,
  \`reply_to?\`, \`attachments?\`) — in-thread, to the original's Reply-To, else
  From, else Sender.
- \`list_agents\` — the inbox this credential directory holds.

\`agent_id?\` is accepted for parity with the hosted server: this inbox's id
passes, any other is refused. Choose an inbox with \`credentials_dir\` /
\`--credentials-dir\`.

## jmap_request

**MCP input:** \`{ "credentials_dir"?: string, "using"?: string[], "ops"?: string, "ops_file"?: string,
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
multi_account, troubleshooting. Topic \`readme\` prints the published package \`README.md\`
(same layout as npm; requires install from npm).`;
