# JMAP presets

Bundled presets:

- `send_mail.json`
- `list_inbox.json`
- `list_sent.json`
- `reply.json`
- `send_mail_attachment.json`
- `send_mail_blob_attachment.json`

Relative `ops_file` paths resolve from credentials directory first, then bundled
presets shipped with the package.

The send presets (`send_mail*.json`, `reply.json`) file the sender's copy in
the Sent mailbox (`$SENT_MAILBOX_ID`) and, once the submission succeeds, clear
`$draft` and set `$sent` on it via `onSuccessUpdateEmail`. So `list_inbox.json`
shows only mail that arrived; read what the agent sent with `list_sent.json`.
Accounts without a Sent mailbox fall back to the inbox.

`reply.json` takes `MAIL_ID` and `BODY`. The client looks the original up by
`MAIL_ID` and fills `$REPLY_TO`, `$REPLY_SUBJECT` and `$REPLY_MESSAGE_ID`, so
the reply goes to Reply-To (else From), with `Re: ` and `inReplyTo` set, and
lands in the same thread.
