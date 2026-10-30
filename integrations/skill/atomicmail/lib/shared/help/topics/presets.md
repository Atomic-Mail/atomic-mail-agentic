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
the reply goes to the first usable Reply-To, else From, else Sender address,
with `Re: ` and `inReplyTo` set, and lands in the same thread.

`reply.json` replies to one address only: the first Reply-To address, else
From, else Sender (no reply-all). It sets `References` to the parent
Message-ID only, not the parent's whole chain, and takes no attachments. If the
original has no Message-ID, use `send_mail.json` with `TO`/`SUBJECT` instead.
