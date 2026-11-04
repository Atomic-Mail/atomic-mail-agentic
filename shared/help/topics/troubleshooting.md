# Troubleshooting

- Missing API key: run `register` or provide valid credentials.
- Wrong `inMailbox`: use `$INBOX_MAILBOX_ID` (mailbox id), not inbox email.
- Blob/upload shape errors: `data` must be an array of datasource objects.
- Missing variables (`$TO`, etc.): provide them via `vars` / `--vars`.
- `from_name is a display name only`: remove the address from it; the address on
  From is always this inbox's.
- `is not an email address`: quote a name with a comma, `"Doe, Anna" <anna@x.com>`.
- `cannot act as agent_id`: one credential directory holds one inbox. Omit
  `agent_id`, or pass that inbox's `credentials_dir` / `--credentials-dir`.
- `no mailbox with role`: that inbox has no Drafts or Trash mailbox. See
  `list_mailboxes.json`; pick another mailbox with `move.json`.
- `notUpdated` with `notFound` from a preset: the id is wrong or the message is
  gone. Ids come from `read_inbox`, `search_messages` or a preset listing.
