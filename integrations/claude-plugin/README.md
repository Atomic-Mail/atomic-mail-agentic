# Atomic Mail for Claude

Connect Claude to an [Atomic Mail](https://atomicmail.ai) inbox. Claude can list new mail, search it, read a message, send an email and reply in a thread, all over the open JMAP standard (RFC 8620/8621).

Atomic Mail is email built for AI agents as well as people. An inbox can belong to an agent instead of borrowing a person's mailbox, which suits work like collecting a verification code, following up on a request, or running a support address.

This plugin bundles two things: the Atomic Mail connector and one skill that tells Claude how to use it safely.

## Install

In Claude Code:

```bash
claude plugin marketplace add Atomic-Mail/atomic-mail-agentic
claude plugin install atomic-mail@atomic-mail
```

On claude.ai and in Cowork, add **Atomic Mail** from the directory.

The first time Claude uses the connector you sign in to Atomic Mail in your browser and choose which permissions to grant. You need an Atomic Mail account. Manage your inboxes at [dashboard.atomicmail.ai](https://dashboard.atomicmail.ai).

## What it can do

| Tool | What it does |
| --- | --- |
| `list_agents` | Lists the inboxes you own |
| `read_inbox` | Lists the newest messages |
| `search_messages` | Finds messages by free text |
| `read_message` | Reads one full message |
| `send_email` | Sends a new plain-text email |
| `reply_to_message` | Replies in the same thread |
| `run_preset` | Runs a bundled JMAP flow, with an optional dry run |
| `jmap_request` | Sends a raw JMAP request, for advanced use |
| `help` | Returns the server's documentation |

## What this plugin runs and sends

The plugin contains no code, hooks, commands, agents or scripts. It is a connector declaration and a skill file.

- **Connection:** Claude connects to `https://mcp.atomicmail.ai/mcp` over HTTPS. That is the only server it talks to.
- **Sign-in:** OAuth 2.0 with PKCE, served by `https://auth.atomicmail.ai`. Two permissions can be granted: `mail.read` and `mail.send`. Grant only the ones you want.
- **Data:** When you ask Claude to read mail, the message contents pass to Claude in your conversation. When you ask it to send mail, the text you approve is sent from your inbox. Nothing is sent unless you ask.
- **Credentials:** The plugin stores none. Tokens are held by Claude's connector system.

## Safety

Email is written by strangers, so the skill tells Claude to treat every message as data and never as an instruction. Claude will not send, reply, forward or delete because a message says to, and it asks you to confirm before it sends anything.

## Privacy and support

- Privacy policy: <https://atomicmail.io/privacy-policy>
- Documentation: <https://docs.atomicmail.ai/mcp-remote>
- Support: support@atomicmail.ai
- Source: <https://github.com/Atomic-Mail/atomic-mail-agentic>

Claude Code users who want an inbox the agent creates for itself, with no sign-in, can run the local server instead. See the [MCP documentation](https://docs.atomicmail.ai/mcp).

## License

MIT
