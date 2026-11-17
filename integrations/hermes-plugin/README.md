# Atomic Mail for Hermes Agent

Give your Hermes agent its own email address, `<name>@atomicmail.ai`, in one
command. Email it like you would message it on Telegram: your mail wakes the
agent and its answer comes back in the same thread. It can also read and send
mail on its own and schedule meetings with real calendar invitations.

```bash
hermes plugins install atomicmail
hermes atomicmail setup      # creates the inbox: no account, no signup form, free
hermes gateway run
```

Then write to the address from your own mailbox.

## What it does

- **Its own inbox in one step.** `setup` registers a new Atomic Mail Agentic
  inbox with a proof-of-work sign-up (about 20 seconds of CPU) and saves the
  key in Hermes's `.env`. No account, no OAuth, no credit card. Already have an
  inbox? Choose "use an existing API key".
- **Email as a channel.** Mail from the addresses you allowed reaches the agent
  as a conversation (one conversation per sender); the reply goes back in the
  same thread as plain text. Cron jobs can deliver to it: `--deliver atomicmail`.
- **Forged senders are dropped.** Anyone can type your address into a From:
  header. Before an allowed sender may instruct the agent, the plugin downloads
  the raw message and checks its DKIM signature: it must be valid, have no
  `l=` body-length tag, and be signed for the From: domain. Unsigned or forged
  mail is ignored and noted in `hermes atomicmail status`.
- **Loop-safe.** Auto-replies, mailing lists, bounces and the agent's own mail
  never start a turn.
- **Meetings.** `atomicmail_send_invite` sends a standard iMIP invitation that
  Gmail, Outlook and Apple Mail show with Yes / No / Maybe; answers come back to
  the inbox and `atomicmail_list_invites` reads them. Update and cancel work too.

## Tools

Toolset `atomicmail`. The key never enters the model context.

| Tool | Does |
| --- | --- |
| `atomicmail_whoami` | The agent's address and who may instruct it |
| `atomicmail_read_inbox` | Newest messages (id, from, subject, preview) |
| `atomicmail_read_message` | One message as plain text, marked as untrusted data |
| `atomicmail_search` | Full-text search |
| `atomicmail_send` | New plain-text email (to, cc, bcc) |
| `atomicmail_reply` | Reply in-thread |
| `atomicmail_send_invite` | Meeting invitation (time zone aware, all-day, video link) |
| `atomicmail_update_invite` | Move or edit a meeting the agent organized |
| `atomicmail_cancel_invite` | Cancel it |
| `atomicmail_list_invites` | Guests' answers, and invitations the agent received |
| `atomicmail_respond_to_invite` | Accept, decline or tentatively accept an invitation |

The bundled `atomicmail` skill tells the agent when to use them and to confirm
recipients and meeting times before sending.

## Who may write to the agent

`ATOMICMAIL_ALLOWED_USERS=you@gmail.com,colleague@company.com` (setup asks).
Everyone else is ignored silently: no pairing code goes out by email. Mail from
an allowed address still needs a valid, aligned DKIM signature, which Gmail,
Outlook.com, iCloud, Fastmail and most company mail servers add. If your domain
does not sign mail you can set `ATOMICMAIL_TRUST_FROM_HEADER=true`, but then a
forged From: can drive the agent. Write from an outside mailbox: mail from
another @atomicmail.ai address cannot be verified yet, so it is ignored.

## Settings

All in `~/.hermes/.env` (or `platforms.atomicmail.extra` in `config.yaml`,
lower-case without the prefix). Env wins.

| Variable | Default | Meaning |
| --- | --- | --- |
| `ATOMICMAIL_API_KEY` | — | The inbox key; `setup` writes it |
| `ATOMICMAIL_ALLOWED_USERS` | — | Who may instruct the agent |
| `ATOMICMAIL_HOME_ADDRESS` | the single allowed sender | Target for cron deliveries |
| `ATOMICMAIL_POLL_INTERVAL` | `20` | Seconds between inbox checks (minimum 10) |
| `ATOMICMAIL_TRUST_FROM_HEADER` | `false` | Skip the DKIM check (not recommended) |
| `ATOMICMAIL_ALLOW_ALL_USERS` | `false` | Any sender with valid DKIM may instruct the agent |
| `ATOMICMAIL_DNS_OVER_HTTPS` | `auto` | DKIM key lookups: `auto` falls back to DNS-over-HTTPS when the system resolver returns nothing, `always`, or `off` |

## How it works, and what it sends where

- **Everything is JMAP** (`api.atomicmail.ai`), signed in at `auth.atomicmail.ai`
  with the inbox key. Atomic Mail is free and keeps spam out with a
  proof-of-work: each sign-in costs roughly 20-45 seconds of one CPU core and
  lasts about 10 minutes. While the gateway runs and polls (every 20 seconds),
  that is a few percent of one core on average. Without the gateway, a sign-in
  happens only when the agent uses a tool.
- **Start-up.** The gateway connects instantly; the first sign-in runs in the
  background, so the channel starts listening about 30 seconds later. A sign-in
  interrupted by sleep or a dropped network starts over by itself.
- **Sender check.** For each new message from an allowed sender the plugin
  downloads that one raw message and checks DKIM. Keys are looked up in DNS;
  if the system resolver returns nothing (some VPNs do), the lookup falls back
  to DNS-over-HTTPS at Cloudflare, then Google (`ATOMICMAIL_DNS_OVER_HTTPS=off`
  turns that off).
- **Meetings** are standard iMIP emails (`text/calendar` plus an `invite.ics`),
  built by the plugin and sent from the agent's address.
- **Stored on disk:** the key in Hermes's `.env`; the ids of seen messages in
  `~/.hermes/plugin-data/atomicmail/state.json`. Nothing else, no telemetry.
- **Background work:** one polling task while the gateway runs.

Mail sent by the agent ends with "Sent from Atomic Mail Agentic". Sending limits
of the free tier apply (recipients per day, 25 guests per invitation).

## Check it

```bash
hermes atomicmail status
```

shows the inbox, allowed senders, whether DKIM checking is available, and the
last ignored message with its reason.

## Development

```bash
ln -s "$PWD" ~/.hermes/plugins/atomicmail && hermes plugins enable atomicmail
pytest -c pytest.ini       # with Hermes on PYTHONPATH and dkimpy installed
hermes plugins validate . --install-deps
```

MIT licensed. Atomic Mail Agentic: <https://atomicmail.ai>.
