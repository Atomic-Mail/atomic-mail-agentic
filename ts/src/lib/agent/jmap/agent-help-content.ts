// Long-form help for MCP `help` tool and AgentSkill `help` command.

export const HELP_TOPICS: Record<string, string> = {
  overview: `\
# Atomic Mail — Overview

Atomic Mail is an email service provider (ESP) designed for AI agents. You
manage mail over JMAP (RFC 8620 + RFC 8621).

## Public surface (identical for MCP and AgentSkill)

Three operations only:

1. **register** — Proof-of-work signup (or idempotent replay when the same
   username matches the inbox already on disk). Persists credentials and
   returns \`{ inbox, accountId }\` (and \`apiKey\` on first signup).
2. **jmap_request** — Send a JMAP method-call batch. Auth and JWT rotation are
   automatic. Pass inline \`ops\` JSON or an \`ops_file\` preset path (same
   substitution applies to both). Uppercase tokens like \`$ACCOUNT_ID\`,
   \`$INBOX\`, \`$TO\`, \`$SUBJECT\` are replaced before the request is sent.
   \`$ACCOUNT_ID\` / \`$INBOX\` come from the JMAP session and credentials; pass
   any other names via MCP \`vars\` or skill \`--vars\`.
3. **help** — This documentation (optional \`topic\` / \`--topic\`).

## Typical workflow

1. \`register\` with a username.
2. \`jmap_request\` with JMAP method calls (presets may use \`$VAR_NAME\`; pass
   custom values in \`vars\` / \`--vars\`).
3. If stuck, read error hints and call \`help\`.

Available topics: overview, installation, auth, jmap_cheatsheet, tools,
presets, troubleshooting.`,

  installation: `\
# Atomic Mail — Installation

## MCP (stdio)

\`\`\`json
{
  "mcpServers": {
    "atomicmail": {
      "command": "npx",
      "args": ["-y", "@atomicmail/mcp"]
    }
  }
}
\`\`\`

## AgentSkill (shell)

\`\`\`bash
npx --package=@atomicmail/agent-skill atomicmail register --username "myagent"
npx --package=@atomicmail/agent-skill atomicmail jmap_request \\
  --ops-file list_inbox.json \\
  --vars '{"COUNT":"10"}'
npx --package=@atomicmail/agent-skill atomicmail help
\`\`\`

From the repo: \`deno run -A scripts/cli.ts <command> ...\` inside \`skill/\`.

## Shared credentials

MCP and the skill use the same directory layout (default \`~/.atomicmail/\`):

- \`credentials.json\`, \`session.jwt\`, \`capability.jwt\`

## Overriding defaults

- Endpoints: \`ATOMIC_MAIL_AUTH_URL\`, \`ATOMIC_MAIL_API_URL\`
- Credentials path: \`ATOMIC_MAIL_CREDENTIALS_DIR\` (MCP), \`--credentials-dir\` (skill)
- Optional PoW salt: \`ATOMIC_MAIL_SCRYPT_SALT\`

## From source (development)

From the repo \`mcp/\` or \`skill/\` directory:

\`\`\`bash
deno task start   # MCP
deno task build:npm
\`\`\`

See each package README for details.`,

  auth: `\
# Atomic Mail — Auth flow

Auth is automatic after \`register\` (or when \`credentials.json\` + API key
exist).

1. **Challenge** — \`POST /api/v1/challenge\`
2. **Proof-of-work** — scrypt until difficulty satisfied
3. **Session JWT** — \`POST /api/v1/session\` (4h TTL); signup returns a
   one-time \`apiKey\`
4. **Capability JWT** — \`POST /api/v1/capability\` (2 min TTL) used as the
   JMAP bearer

JWTs are rotated before expiry and written back to disk.

## Credential files (mode 0600)

\`credentials.json\` — \`{ apiKey, inboxId, authUrl, apiUrl, scryptSalt }\`  
\`session.jwt\` — session token  
\`capability.jwt\` — capability token

## Overriding defaults

- \`ATOMIC_MAIL_AUTH_URL\` (default: \`https://auth.atomicmail.ai\`)
- \`ATOMIC_MAIL_API_URL\` (default: \`https://api.atomicmail.ai\`)
- \`ATOMIC_MAIL_SCRYPT_SALT\` (optional)
- \`ATOMIC_MAIL_API_KEY\` (optional)
- \`ATOMIC_MAIL_CREDENTIALS_DIR\` (default: \`~/.atomicmail\`)`,

  jmap_cheatsheet: `\
# JMAP cheatsheet

## Capabilities (\`using\`)

- urn:ietf:params:jmap:core
- urn:ietf:params:jmap:mail
- urn:ietf:params:jmap:submission

## Examples

Use \`$ACCOUNT_ID\` and \`$INBOX\` for session fields; use \`$TO\`, \`$SUBJECT\`,
etc., and supply values via MCP \`vars\` or \`--vars\` (JSON object of strings).

### Mailboxes
\`\`\`json
["Mailbox/get", {"accountId": "$ACCOUNT_ID"}, "m0"]
\`\`\`

### Query + fetch emails
\`\`\`json
["Email/query", {
  "accountId": "$ACCOUNT_ID",
  "filter": {"inMailbox": "$INBOX"},
  "sort": [{"property": "receivedAt", "isAscending": false}],
  "limit": 100
}, "q0"]
\`\`\`

### Send (add submission to \`using\`)

Include \`urn:ietf:params:jmap:submission\` in the envelope \`using\` array
when calling \`EmailSubmission/set\`.

## Tips

- Back-references (\`#ids\`, \`#draft\`) chain calls in one batch.
- Save reusable JSON as preset files and pass \`ops_file\`.`,

  tools: `\
# Tool / CLI reference

## register

**MCP input:** \`{ "username": string }\`  
**Skill:** \`register --username NAME\` (or \`--api-key KEY\`).

Creates an inbox or returns the same \`{ inbox, accountId }\` when the
username matches the stored inbox local-part. A **different** username
replaces credentials in the directory and registers a new inbox.

## jmap_request

**MCP input:** \`{ "using"?: string[], "ops"?: string, "ops_file"?: string,
"vars"?: Record<string, string> }\` — keys in \`vars\` are names without \`$\`
(e.g. \`TO\` for \`$TO\`). Exactly one of \`ops\` or \`ops_file\`.

**Skill:** \`jmap_request --ops '...'\` or \`--ops-file path\` plus
\`--credentials-dir\` (optional), plus optional \`--vars '<json>'\`, \`--using\`,
\`--dry-run\`.

## help

**MCP:** \`{ "topic"?: string }\`  
**Skill:** \`help [--topic TOPIC]\`

Topics: overview, installation, auth, jmap_cheatsheet, tools, presets,
troubleshooting.`,

  presets: `\
# JMAP presets

Save a method-call array or a full \`{ "using", "methodCalls" }\` envelope
as JSON, then pass \`ops_file\` (MCP) or \`--ops-file\` (skill).

Relative paths first resolve against the credential directory (MCP) or current
\`--credentials-dir\` (skill). If not found, the runtime falls back to bundled
presets that ship in both npm packages.

## Bundled presets

- \`send_mail.json\` — sends one email using \`$TO\`, \`$SUBJECT\`, \`$BODY\`.
- \`list_inbox.json\` — returns the latest \`$COUNT\` inbox messages.
- \`reply.json\` — replies in-thread using \`$MAIL_ID\` and \`$BODY\`.

## Placeholders

Syntax: \`$VAR_NAME\` where \`VAR_NAME\` matches \`/^[A-Z][A-Z0-9_]*$/\` (so JMAP
keywords like \`$draft\` stay untouched).

- \`$ACCOUNT_ID\` — primary mail account id (from \`GET /.well-known/jmap\` when
  referenced).
- \`$INBOX\` — inbox email address from credentials.
- Any other \`$FOO\` — must appear in MCP \`vars\` or skill \`--vars\` as
  \`"FOO": "..."\` (string values only; JSON escaping in the preset body is your
  responsibility).

You may override \`ACCOUNT_ID\` / \`INBOX\` via \`vars\` / \`--vars\` if needed.`,

  troubleshooting: `\
# Troubleshooting

## Custom endpoint configuration issues

Defaults are production endpoints. Set env vars only for custom deployments.

## No API key / register first

Run \`register\`, or set \`ATOMIC_MAIL_API_KEY\`, or copy an existing
\`credentials.json\` into the credential directory.

## auth-service /api/v1/session returned 401

Invalid \`apiKey\` or wrong \`ATOMIC_MAIL_SCRYPT_SALT\` for this deployment.

## Capability JWT missing inboxId

Server/version mismatch — verify \`ATOMIC_MAIL_AUTH_URL\`.

## Could not read ops file

Check the path; use an absolute path if unsure.

## Missing values for variables (\`$TO\`, etc.)

Pass every custom placeholder in MCP \`vars\` or \`--vars\` as a JSON object of
strings. Ensure \`register\` completed so \`$ACCOUNT_ID\` / \`$INBOX\` can resolve.`,
};

export const HELP_TOPIC_LIST = Object.keys(HELP_TOPICS);

export function getHelp(topic?: string): string {
  if (!topic) {
    return HELP_TOPICS["overview"];
  }
  const key = topic.toLowerCase().replace(/[\s-]/g, "_");
  return (
    HELP_TOPICS[key] ??
      `Unknown topic "${topic}". Available topics: ${
        HELP_TOPIC_LIST.join(", ")
      }`
  );
}
