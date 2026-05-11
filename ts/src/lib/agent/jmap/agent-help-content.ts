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
   \`$INBOX\`, \`$UPLOAD_URL\`, \`$DOWNLOAD_URL\`, \`$TO\`, \`$SUBJECT\` are
   replaced before the request is sent. \`$ACCOUNT_ID\` / \`$INBOX\` /
   \`$INBOX_MAILBOX_ID\` / \`$UPLOAD_URL\` / \`$DOWNLOAD_URL\` come from the JMAP
   session and credentials; pass any other names via MCP \`vars\` or skill
   \`--vars\`.
3. **help** — This documentation (optional \`topic\` / \`--topic\`), or the
   published package README (\`topic\` / \`--topic\` \`readme\`).

## Typical workflow

1. \`register\` with a username.
2. \`jmap_request\` with JMAP method calls (presets may use \`$VAR_NAME\`; pass
   custom values in \`vars\` / \`--vars\`).
3. If stuck, read error hints and call \`help\`.

Available topics: overview, installation, auth, jmap_cheatsheet, tools,
presets, troubleshooting. Use \`readme\` for the npm package \`README.md\`.`,

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
  --ops-file list_inbox.json
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

1. **Challenge** — \`POST /api/v1/challenge\`, read challenge JWT from
   \`Authorization: Bearer <challengeJWT>\`
2. **Proof-of-work** — scrypt until difficulty satisfied
3. **Session JWT** — \`POST /api/v1/session\` with challenge JWT in
   \`Authorization: Bearer ...\` and PoW fields (\`powHex\`, \`nonce\`) in JSON
   body; read session JWT from response \`Authorization: Bearer ...\` (1h TTL);
   signup returns \`apiKey\` once
4. **Capability JWT** — \`POST /api/v1/capability\` with session JWT in
   \`Authorization: Bearer ...\`; read capability JWT from response
   \`Authorization: Bearer ...\` (2 min TTL) used as the JMAP bearer

JWTs are rotated before expiry and written back to disk.

## Credential files (mode 0600)

\`credentials.json\` — \`{ apiKey, inboxId, authUrl, apiUrl, scryptSalt, uploadUrl, downloadUrl }\`  
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

Common URNs:

- urn:ietf:params:jmap:core
- urn:ietf:params:jmap:mail
- urn:ietf:params:jmap:submission — required for \`EmailSubmission/set\`
- urn:ietf:params:jmap:blob — required for \`Blob/upload\` / \`Blob/get\`

## Placeholders

- \`$ACCOUNT_ID\`, \`$INBOX\` (inbox **email**), \`$INBOX_MAILBOX_ID\` (JMAP mailbox
  id for the inbox — use for \`Email/query\` → \`inMailbox\` and \`Email/set\` →
  \`mailboxIds\`), \`$UPLOAD_URL\`, \`$DOWNLOAD_URL\` resolve from the session.
- Pass \`$TO\`, \`$SUBJECT\`, \`$BODY\`, etc. via MCP \`vars\` or skill \`--vars\`
  (object of strings).

## Bare methodCalls vs full envelope

If \`ops\` is **only** a methodCalls array, the default \`using\` is **core + mail**
only. For submission or blob methods, pass a full \`{ "using", "methodCalls" }\`
object (or use bundled presets, which include the right \`using\`).

## Mailboxes

\`\`\`json
["Mailbox/get", {"accountId": "$ACCOUNT_ID"}, "m0"]
\`\`\`

## Query + fetch latest inbox mail

\`inMailbox\` must be a **mailbox id**, not the email address — use
\`$INBOX_MAILBOX_ID\`.

\`\`\`json
{
  "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
  "methodCalls": [
    ["Email/query", {
      "accountId": "$ACCOUNT_ID",
      "filter": {"inMailbox": "$INBOX_MAILBOX_ID"},
      "sort": [{"property": "receivedAt", "isAscending": false}],
      "limit": 25
    }, "q0"],
    ["Email/get", {
      "accountId": "$ACCOUNT_ID",
      "#ids": {"resultOf": "q0", "name": "Email/query", "path": "/ids"},
      "properties": ["id", "threadId", "receivedAt", "from", "to", "subject", "preview"]
    }, "g0"]
  ]
}
\`\`\`

## Send one email (draft + submit)

Same pattern as bundled \`send_mail.json\`: \`Email/set\` includes
\`mailboxIds\` with \`$INBOX_MAILBOX_ID\` as the mailbox id key, then
\`EmailSubmission/set\` with \`envelope\`.

\`\`\`json
{
  "using": [
    "urn:ietf:params:jmap:core",
    "urn:ietf:params:jmap:mail",
    "urn:ietf:params:jmap:submission"
  ],
  "methodCalls": [
    ["Email/set", {
      "accountId": "$ACCOUNT_ID",
      "create": {
        "d1": {
          "mailboxIds": {"$INBOX_MAILBOX_ID": true},
          "from": [{"email": "$INBOX"}],
          "to": [{"email": "$TO"}],
          "subject": "$SUBJECT",
          "textBody": [{"partId": "b", "type": "text/plain"}],
          "bodyValues": {"b": {"value": "$BODY"}},
          "keywords": {"$draft": true}
        }
      }
    }, "c0"],
    ["EmailSubmission/set", {
      "accountId": "$ACCOUNT_ID",
      "create": {
        "s1": {
          "emailId": "#d1",
          "envelope": {
            "mailFrom": {"email": "$INBOX"},
            "rcptTo": [{"email": "$TO"}]
          }
        }
      }
    }, "c1"]
  ]
}
\`\`\`

## Attachment in one batch (\`Blob/upload\` + send)

Atomic Mail expects blob bytes in a \`data\` property (**base64** string), not
\`data:asText\`. Prefer preset \`send_mail_attachment.json\` with \`vars\`:
\`TO\`, \`SUBJECT\`, \`BODY\`, \`ATTACHMENT_BASE64\`, \`ATTACHMENT_TYPE\`,
\`ATTACHMENT_NAME\`.

Minimal inline shape (replace base64 and addresses):

\`\`\`json
{
  "using": [
    "urn:ietf:params:jmap:core",
    "urn:ietf:params:jmap:mail",
    "urn:ietf:params:jmap:submission",
    "urn:ietf:params:jmap:blob"
  ],
  "methodCalls": [
    ["Blob/upload", {
      "accountId": "$ACCOUNT_ID",
      "create": {"b1": {"data": "SGVsbG8=", "type": "text/plain"}}
    }, "b0"],
    ["Email/set", {
      "accountId": "$ACCOUNT_ID",
      "create": {
        "m1": {
          "mailboxIds": {"$INBOX_MAILBOX_ID": true},
          "from": [{"email": "$INBOX"}],
          "to": [{"email": "$TO"}],
          "subject": "With attachment",
          "bodyValues": {"body1": {"value": "See attachment."}},
          "textBody": [{"partId": "body1", "type": "text/plain"}],
          "attachments": [{"blobId": "#b1", "type": "text/plain", "name": "note.txt"}]
        }
      }
    }, "m0"],
    ["EmailSubmission/set", {
      "accountId": "$ACCOUNT_ID",
      "create": {
        "s1": {
          "emailId": "#m1",
          "envelope": {
            "mailFrom": {"email": "$INBOX"},
            "rcptTo": [{"email": "$TO"}]
          }
        }
      }
    }, "s0"]
  ]
}
\`\`\`

## Blob/get

\`\`\`json
{
  "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:blob"],
  "methodCalls": [
    ["Blob/get", {
      "accountId": "$ACCOUNT_ID",
      "ids": ["$BLOB_ID"],
      "properties": ["data:asBase64", "size"]
    }, "g0"]
  ]
}
\`\`\`

## Tips

- Back-references (\`#b1\`, \`#m1\`, \`#draft\`) chain calls in one batch.
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
troubleshooting. Topic \`readme\` prints the published package \`README.md\`
(same layout as npm; requires install from npm).`,

  presets: `\
# JMAP presets

Save a method-call array or a full \`{ "using", "methodCalls" }\` envelope
as JSON, then pass \`ops_file\` (MCP) or \`--ops-file\` (skill).

Relative paths first resolve against the credential directory (MCP) or current
\`--credentials-dir\` (skill). If not found, the runtime falls back to bundled
presets that ship in both npm packages.

## Bundled presets

- \`send_mail.json\` — sends one email using \`$TO\`, \`$SUBJECT\`, \`$BODY\`.
- \`list_inbox.json\` — latest 50 inbox messages (uses \`$INBOX_MAILBOX_ID\`).
- \`reply.json\` — replies in-thread using \`$MAIL_ID\` and \`$BODY\`.
- \`send_mail_attachment.json\` — \`Blob/upload\` + send; \`vars\`: \`TO\`,
  \`SUBJECT\`, \`BODY\`, \`ATTACHMENT_BASE64\`, \`ATTACHMENT_TYPE\`,
  \`ATTACHMENT_NAME\`.

## Placeholders

Syntax: \`$VAR_NAME\` where \`VAR_NAME\` matches \`/^[A-Z][A-Z0-9_]*$/\` (so JMAP
keywords like \`$draft\` stay untouched).

- \`$ACCOUNT_ID\` — primary mail account id (from \`GET /.well-known/jmap\` when
  referenced).
- \`$INBOX\` — inbox email address from credentials.
- \`$INBOX_MAILBOX_ID\` — JMAP mailbox id for the inbox (extra \`Mailbox/query\`;
  use for \`Email/query\` / \`Email/set\` where the API wants a mailbox id).
- \`$UPLOAD_URL\` — RFC 8620 upload URL template from JMAP session.
- \`$DOWNLOAD_URL\` — RFC 8620 download URL template from JMAP session.
- Any other \`$FOO\` — must appear in MCP \`vars\` or skill \`--vars\` as
  \`"FOO": "..."\` (string values only; JSON escaping in the preset body is your
  responsibility).

You may override \`ACCOUNT_ID\` / \`INBOX\` / \`INBOX_MAILBOX_ID\` /
\`UPLOAD_URL\` / \`DOWNLOAD_URL\` via \`vars\` / \`--vars\` if needed.`,

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
strings. Ensure \`register\` completed so \`$ACCOUNT_ID\` / \`$INBOX\` can resolve.

## \`invalidArguments\` on \`Email/query\` / \`filter/inMailbox\`

\`inMailbox\` must be a **mailbox id**, not your inbox email. Use the built-in
\`$INBOX_MAILBOX_ID\` placeholder (or run \`Mailbox/get\` / \`Mailbox/query\` and
paste the id into \`vars\`).

## \`invalidProperties\` on \`Blob/upload\` (\`data:asText\`, etc.)

On Atomic Mail, put base64 content in a \`data\` field. See \`help\` topic
\`jmap_cheatsheet\` or preset \`send_mail_attachment.json\`.

## Site docs vs installed MCP version

The VitePress site (\`docs/\` in the repo) may be **ahead of** the version
\`npx -y @atomicmail/mcp\` resolves to until a new package is published. If
\`help\` or presets disagree with the website, prefer the behavior of your
installed package or run from source after \`git pull\`.`,
};

export const HELP_TOPIC_LIST = Object.keys(HELP_TOPICS);

export function normalizeHelpTopic(topic: string): string {
  return topic.toLowerCase().replace(/[\s-]/g, "_");
}

export function getHelp(topic?: string): string {
  if (!topic) {
    return HELP_TOPICS["overview"];
  }
  const key = normalizeHelpTopic(topic);
  if (key === "readme") {
    return (
      'Topic "readme" prints the package README.md from the npm install. ' +
      'From MCP use {"topic":"readme"}; from the CLI: ' +
      "`atomicmail help --topic readme`."
    );
  }
  return (
    HELP_TOPICS[key] ??
      `Unknown topic "${topic}". Available topics: ${
        HELP_TOPIC_LIST.join(", ")
      }, readme`
  );
}
