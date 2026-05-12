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
   session and credentials (\`$INBOX\` is always a full mailbox address; see
   presets topic); pass any other names via MCP \`vars\` or skill
   \`--vars\`. Optional **local file attachments** (MCP \`attachments\`, skill
   \`--attachment\`): each file is RFC 8620–uploaded to \`uploadUrl\` first, then
   \`$ATTACHMENT_0_BLOB_ID\`, \`$ATTACHMENT_0_NAME\`, \`$ATTACHMENT_0_TYPE\`, …
   are substituted into the same standard JMAP JSON you would hand-write.
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

From the repo: \`cd ts\` then \`deno run -A src/skill/cli.ts <command> ...\` (see
repository \`README.md\` for publishing and build tasks).

## Shared credentials

MCP and the skill use the same directory layout (default \`~/.atomicmail/\`):

- \`credentials.json\`, \`session.jwt\`, \`capability.jwt\`

## Overriding defaults

- Endpoints: \`ATOMIC_MAIL_AUTH_URL\`, \`ATOMIC_MAIL_API_URL\`
- Credentials path: \`ATOMIC_MAIL_CREDENTIALS_DIR\` (MCP), \`--credentials-dir\` (skill)
- Optional PoW salt: \`ATOMIC_MAIL_SCRYPT_SALT\`

## From source (development)

From the repository \`ts/\` directory:

\`\`\`bash
deno run -A src/mcp/main.ts                    # MCP stdio (development)
deno run -A build_mcp_npm.ts [version]         # MCP npm output -> ./mcp_npm
deno run -A build_skill_npm.ts [version]       # skill npm output -> ./skill_npm
\`\`\`

See the repository \`README.md\` for publishing.`,

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
- urn:ietf:params:jmap:blob — required for \`Blob/upload\`, \`Blob/get\`, and
  \`Blob/lookup\` (see RFC 9404 §4.3 for reverse blob references).

## Session blob limits (RFC 9404 §3.1)

From \`accounts[accountId].accountCapabilities["urn:ietf:params:jmap:blob"]\`:
\`maxSizeBlobSet\`, \`maxDataSources\`, \`supportedTypeNames\`,
\`supportedDigestAlgorithms\`. MCP and AgentSkill **reject before POST** when a
computable \`Blob/upload\` or an \`attachments\` file would exceed advertised
\`maxSizeBlobSet\` or \`maxDataSources\` (\`maxSizeBlobSet: null\` = no client
octet cap). Literal (non-\`#\`) \`blobId\` slices are not pre-sized on the client.

## \`Blob/upload\` shape (RFC 9404)

Each \`create.<id>\` is an **UploadObject**:

- **\`data\`**: required **array** of **DataSourceObject** (concatenated in order;
  \`[]\` yields an empty blob).
- **\`type\`**: optional media-type hint (\`String|null\` in the RFC).

Each **DataSourceObject** must contain **exactly one** of (RFC 9404 §4.1):

- **\`{ "data:asText": "…" }\`** — UTF-8 text (invalid UTF-8 → \`notCreated\`).
- **\`{ "data:asBase64": "…" }\`** — base64 octets (invalid base64 → \`notCreated\`).
- **\`{ "blobId": "…", "offset"?, "length"? }\`** — byte range from an existing
  blob; \`offset\` / \`length\` may be omitted or \`null\` per the RFC. In one
  batch, use \`"#b4"\` when referring to a blob created earlier in the same
  request.

**Not RFC-compliant** (do not expect servers to accept them): \`data\` as a
plain string; \`data:asBase64\` or \`data:asText\` on the **upload object** top
level instead of **inside** an element of the \`data\` array; more than one of
the above inside a single array element.

**Email parts:** in \`Email/set\`, \`attachments[]\` references the blob with
\`blobId\` (e.g. \`"#b1"\` for create key \`b1\`), plus \`type\` / \`name\` per
RFC 8621.

**Out-of-band:** RFC 8620 \`POST\` to \`uploadUrl\` (MCP \`attachments\` / skill
\`--attachment\`) then use \`$ATTACHMENT_N_BLOB_ID\` in the same JMAP JSON.

## Placeholders

- \`$ACCOUNT_ID\`, \`$INBOX\` (full mailbox **email** for \`From\` / envelope; from
  \`inboxId\`, appending \`@atomicmail.ai\` or \`ATOMIC_MAIL_INBOX_DOMAIN\` when
  needed), \`$INBOX_MAILBOX_ID\` (JMAP mailbox id — use for \`Email/query\` →
  \`inMailbox\` and \`Email/set\` → \`mailboxIds\`), \`$UPLOAD_URL\`,
  \`$DOWNLOAD_URL\` resolve from the session.
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

\`Blob/upload\` must follow RFC 9404 (see **\`Blob/upload\` shape** above). The
bundled preset \`send_mail_attachment.json\` uses base64 parts:
\`"data": [{ "data:asBase64": "$ATTACHMENT_BASE64" }]\` plus \`type\`. Vars:
\`TO\`, \`SUBJECT\`, \`BODY\`, \`ATTACHMENT_BASE64\`, \`ATTACHMENT_TYPE\`,
\`ATTACHMENT_NAME\`.

Minimal inline example (base64 for UTF-8 \`Hello\`; replace addresses):

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
      "create": {"b1": {"data": [{ "data:asBase64": "SGVsbG8=" }], "type": "text/plain"}}
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

## Attachment via RFC 8620 (\`uploadUrl\`) — still standard JMAP

Keep \`Email/set\` / \`EmailSubmission/set\` exactly as in RFC 8621; only the blob
bytes go out-of-band: pass MCP \`attachments\` or skill \`--attachment PATH\`
(repeatable). The client \`POST\`s each file to the session \`uploadUrl\`, then
substitutes \`$ATTACHMENT_0_BLOB_ID\`, \`$ATTACHMENT_0_NAME\`, \`$ATTACHMENT_0_TYPE\`
into your \`ops\` / preset before the \`/jmap/\` batch. Bundled
\`send_mail_blob_attachment.json\` is a minimal one-file example; for several
parts, add more objects under \`attachments\` referencing \`$ATTACHMENT_1_BLOB_ID\`, etc.

## Blob/get

Request only RFC 9404 §4.2 property names (e.g. \`data:asBase64\`, \`size\`, or
\`digest:<algorithm>\` from \`supportedDigestAlgorithms\`). Do not list \`id\`
or \`type\` in \`properties\` — \`id\` is still returned on each result object.

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

## Blob/lookup

Reverse lookup: which mail objects reference a blob. Parameters \`typeNames\`,
\`ids\`; errors include \`unknownDataType\`. See RFC 9404 §4.3.

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
  \`ATTACHMENT_NAME\`. Fine for modest sizes; large files should use RFC 8620
  upload instead (see \`send_mail_blob_attachment.json\`).
- \`send_mail_blob_attachment.json\` — one attachment whose \`blobId\` comes from
  \`$ATTACHMENT_0_BLOB_ID\` (etc.). Use with MCP \`attachments\` or skill
  \`--attachment PATH\` so the client uploads files to \`uploadUrl\` before the
  batch; \`vars\`: \`TO\`, \`SUBJECT\`, \`BODY\`. For several files in one
  \`Email/set\`, write normal JMAP JSON referencing \`$ATTACHMENT_1_BLOB_ID\`, …

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
- \`$ATTACHMENT_N_BLOB_ID\`, \`$ATTACHMENT_N_NAME\`, \`$ATTACHMENT_N_TYPE\`,
  \`$ATTACHMENT_N_SIZE\` (N = 0, 1, …) and \`$ATTACHMENT_COUNT\` — injected when
  you pass MCP \`attachments\` or skill \`--attachment\`; you can still override
  them in \`vars\` / \`--vars\` if needed.

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

## \`invalidProperties\` / \`notCreated\` on \`Blob/upload\`

RFC 9404 requires \`data\` as an **array** of objects, each with **exactly one**
of \`data:asText\`, \`data:asBase64\`, or a \`blobId\` slice. Typical mistakes:
\`data\` as a raw string; \`data:asBase64\` on the upload object instead of
inside an array element; mixing two forms in one object. See topic
\`jmap_cheatsheet\` (\`Blob/upload\` shape) and preset \`send_mail_attachment.json\`.

## RFC 8620 binary \`POST\` to \`uploadUrl\` returns 404

The session lists an \`uploadUrl\` template, but your deployment must expose
that HTTP resource. If \`POST\` returns 404, out-of-band upload is not wired
on the server — use \`Blob/upload\` in JMAP instead, or fix the API gateway.

## \`Blob/upload\` succeeds but \`size\` is 0 (or \`Email/set\` rejects the blob)

The server accepted the method but did not persist octets (broken or
incomplete \`Blob/upload\`). Verify with a tiny \`data: [{ "data:asBase64": "QQ==" }]\`
payload; if \`size\`
stays 0, fix the JMAP/blob implementation on the host before sending
attachments.

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
