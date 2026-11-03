// Help topic: troubleshooting (MCP help / AgentSkill help). Mirrors
// shared/help/topics/troubleshooting.md (the runtime source); this is the fallback.

export const helpTopicTroubleshooting = `\
# Troubleshooting

## Setup

- **No credentials yet:** run \`register\`, set \`ATOMIC_MAIL_API_KEY\`, or copy an
  existing \`credentials.json\` into the credential directory.
- **\`/api/v1/session returned 401\`:** the API key is wrong for this inbox, or
  the inbox is suspended. If a key that used to work now fails, the inbox is
  suspended: write to support@atomicmail.ai from any address and include the
  inbox address, never the key.
- **Capability JWT missing inboxId:** server/version mismatch — check
  \`ATOMIC_MAIL_AUTH_URL\`.
- **Custom endpoints:** the defaults are the production endpoints. Set the env
  vars only for a custom deployment.
- **Could not read ops file:** check the path; use an absolute path if unsure.

## Requests

- **Wrong \`inMailbox\`:** use \`$INBOX_MAILBOX_ID\` (the mailbox id), not the inbox
  address.
- **Missing values for variables (\`$TO\`, …):** pass every custom placeholder in
  MCP \`vars\` or \`--vars\` as a JSON object of strings. \`register\` must have
  completed so \`$ACCOUNT_ID\` / \`$INBOX\` resolve.
- **Blob/upload shape errors:** \`data\` must be an array of datasource objects.
- **\`forbiddenFrom\`:** send as this inbox — use \`$INBOX\` as the \`from\` address.
- **\`from_name is a display name only\`:** remove the address from it; the
  address on From is always this inbox's.
- **\`is not an email address\`:** quote a name with a comma,
  \`"Doe, Anna" <anna@x.com>\`.
- **\`cannot act as agent_id\`:** one credential directory holds one inbox. Omit
  \`agent_id\`, or pass that inbox's \`credentials_dir\` / \`--credentials-dir\`.
- **\`no mailbox with role\`:** that inbox has no Drafts or Trash mailbox. See
  \`list_mailboxes.json\`; pick another mailbox with \`move.json\`.
- **\`notUpdated\` with \`notFound\` from a preset:** the id is wrong or the message
  is gone. Ids come from \`read_inbox\`, \`search_messages\` or a preset listing.

## Limits

Details: https://docs.atomicmail.ai/limits

- **\`tooManyRecipients\`:** too many recipients in one message, or for today.
  Split the message, or send the rest the next day (UTC).
- **HTTP 429:** too many messages in a short time. Wait the number of seconds
  in \`Retry-After\`, then retry.
- **HTTP 413 on upload:** keep each file, and all attachments of one message,
  under 1 MB.
- **Mailbox full:** incoming mail is no longer delivered. Delete old messages.

## Hosted MCP server

- **"The API key is invalid, or its inbox is not active":** API keys work on the
  hosted server only for an inbox attached to an account. Link the inbox in the
  dashboard, or connect with OAuth instead. A suspended inbox gets the same
  answer.
`;
