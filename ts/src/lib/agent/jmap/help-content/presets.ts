// Help topic: presets (MCP help / AgentSkill help).

export const helpTopicPresets = `\
# JMAP presets

Save a method-call array or a full \`{ "using", "methodCalls" }\` envelope
as JSON, then pass \`ops_file\` (MCP) or \`--ops-file\` (skill).

Relative paths first resolve against the credential directory (MCP) or current
\`--credentials-dir\` (skill). If not found, the runtime falls back to bundled
presets that ship in both npm packages.

## Bundled presets

- \`send_mail.json\` — sends one email using \`$TO\`, \`$SUBJECT\`, \`$BODY\`.
- \`list_inbox.json\` — latest 50 inbox messages (uses \`$INBOX_MAILBOX_ID\`).
  **Use this preset for the scheduled inbox check** (see **cron** topic).
- \`list_sent.json\` — latest 50 messages the agent sent (uses
  \`$SENT_MAILBOX_ID\`). The send presets file their copy in Sent and clear
  \`$draft\` on success, so sent mail no longer shows in the inbox listing.
- \`reply.json\` — replies in-thread using \`$MAIL_ID\` and \`$BODY\`. Replies
  to one address only (first Reply-To, else From, else Sender), sets
  \`References\` to the parent Message-ID only, and takes no attachments.
- \`send_mail_attachment.json\` — \`Blob/upload\` + send; \`vars\`: \`TO\`,
  \`SUBJECT\`, \`BODY\`, \`ATTACHMENT_BASE64\`, \`ATTACHMENT_TYPE\`,
  \`ATTACHMENT_NAME\`. Fine for modest sizes; large files should use RFC 8620
  upload instead (see \`send_mail_blob_attachment.json\`).
- \`send_mail_blob_attachment.json\` — one attachment whose \`blobId\` comes from
  \`$ATTACHMENT_0_BLOB_ID\` (etc.). Use with MCP \`attachments\` or skill
  \`--attachment PATH\` so the client uploads files to \`uploadUrl\` before the
  batch; \`vars\`: \`TO\`, \`SUBJECT\`, \`BODY\`. For \`text/*\` parts referenced
  by \`blobId\`, the client adds \`charset\` (default \`utf-8\`) when omitted (RFC
  8621). For several files in one \`Email/set\`, write normal JMAP JSON
  referencing \`$ATTACHMENT_1_BLOB_ID\`, …

Also in the stdio MCP server and the CLI:

- \`list_mailboxes.json\` — every mailbox: \`id\`, \`name\`, \`role\`, counts.
- \`search.json\` — full-text search of all mailboxes (\`$QUERY\`), latest 50.
- \`get_thread.json\` — every message of a thread (\`$THREAD_ID\`).
- \`mark_read.json\` — sets \`$seen\` (\`$MAIL_ID\`).
- \`label.json\` — adds a keyword (\`$MAIL_ID\`, \`$LABEL\`).
- \`move.json\` — moves to a mailbox (\`$MAIL_ID\`, \`$MAILBOX_ID\`).
- \`delete.json\` — moves to Trash, recoverable (\`$MAIL_ID\`).
- \`create_draft.json\` — stores a draft, sends nothing (\`$TO\`, \`$SUBJECT\`,
  \`$BODY\`).
- \`forward.json\` — forwards a message, the whole original attached as \`.eml\`
  (\`$MAIL_ID\`, \`$TO\`, \`$BODY\`: your note, may be empty).
- \`download_attachment.json\` — attachment bytes as base64 (\`$BLOB_ID\`).

## Placeholders

Syntax: \`$VAR_NAME\` where \`VAR_NAME\` matches \`/^[A-Z][A-Z0-9_]*$/\` (so JMAP
keywords like \`$draft\` stay untouched).

- \`$ACCOUNT_ID\` — primary mail account id (from \`GET /.well-known/jmap\` when
  referenced).
- \`$INBOX\` — inbox email address from credentials.
- \`$INBOX_MAILBOX_ID\` — JMAP mailbox id for the inbox (extra \`Mailbox/query\`;
  use for \`Email/query\` → \`inMailbox\`; sends use \`$SENT_MAILBOX_ID\`).
- \`$SENT_MAILBOX_ID\` — JMAP mailbox id for Sent (\`role: "sent"\`); falls back
  to the inbox id on accounts without a Sent mailbox.
- \`$DRAFTS_MAILBOX_ID\`, \`$TRASH_MAILBOX_ID\` — JMAP mailbox ids by role, in the
  stdio MCP server and the CLI; an inbox without that mailbox gets an error.
- \`$UPLOAD_URL\` — RFC 8620 upload URL template from JMAP session.
- \`$DOWNLOAD_URL\` — RFC 8620 download URL template from JMAP session.
- Any other \`$FOO\` — must appear in MCP \`vars\` or skill \`--vars\` as
  \`"FOO": "..."\` (string values only; values are JSON-escaped automatically
  inside string literals, so pass raw text and do not pre-escape; bare tokens
  are inserted verbatim).
- \`$ATTACHMENT_N_BLOB_ID\`, \`$ATTACHMENT_N_NAME\`, \`$ATTACHMENT_N_TYPE\`,
  \`$ATTACHMENT_N_SIZE\` (N = 0, 1, …) and \`$ATTACHMENT_COUNT\` — injected when
  you pass MCP \`attachments\` or skill \`--attachment\`; you can still override
  them in \`vars\` / \`--vars\` if needed.

You may override \`ACCOUNT_ID\` / \`INBOX\` / \`INBOX_MAILBOX_ID\` /
\`SENT_MAILBOX_ID\` / \`UPLOAD_URL\` / \`DOWNLOAD_URL\` via \`vars\` / \`--vars\` if
needed.`;
