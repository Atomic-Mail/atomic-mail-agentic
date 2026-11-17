# JMAP cheatsheet

## Capabilities (`using`)

- `urn:ietf:params:jmap:core`
- `urn:ietf:params:jmap:mail`
- `urn:ietf:params:jmap:submission`
- `urn:ietf:params:jmap:blob`

## Placeholders

- `$ACCOUNT_ID`, `$INBOX`, `$INBOX_MAILBOX_ID`, `$SENT_MAILBOX_ID`, `$UPLOAD_URL`, `$DOWNLOAD_URL`
- `$DRAFTS_MAILBOX_ID`, `$TRASH_MAILBOX_ID` (TypeScript client; an inbox without
  that mailbox gets an error, not a fallback)
- Any other `$NAME` must come from `vars` / `--vars`.

## Notes

- Bare methodCalls arrays default to core+mail only.
- For submission/blob methods use a full envelope with `using`.
- `inMailbox` expects mailbox id (`$INBOX_MAILBOX_ID`), not email address.
- When sending, create the email in `$SENT_MAILBOX_ID` and pass
  `onSuccessUpdateEmail: {"#<submissionId>": {"keywords/$draft": null, "keywords/$sent": true}}`
  on `EmailSubmission/set`, or the copy stays flagged `$draft`.
- HTML, From name and Reply-To on an `Email/set` create: `"htmlBody": [{"partId":
  "h", "type": "text/html"}]` next to `textBody`, with `"h"` in `bodyValues`;
  `"from": [{"email": "$INBOX", "name": "$FROM_NAME"}]`; `"replyTo": [{"email":
  "$HELP"}]`. The `send_email` tool does all of this for you.
- Result references (`"#ids": {"resultOf": …}`) work on read methods only. The
  server refuses them on `Email/set` and other writes, so pass real ids there.
- A large attachment: `GET $DOWNLOAD_URL` with the `{accountId}`, `{blobId}`,
  `{name}` and `{type}` filled in (they may appear URL-encoded, as
  `%7BaccountId%7D`), and `Authorization: Bearer <capability.jwt>`.
