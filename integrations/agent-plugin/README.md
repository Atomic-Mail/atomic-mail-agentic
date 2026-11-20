# Atomic Mail Agentic plugin

Email inboxes for AI agents. This plugin connects your agent to the hosted
Atomic Mail MCP server at `https://mcp.atomicmail.ai/mcp`, so it can read,
search, send and reply to mail and schedule meetings by email.

The plugin follows the [Agent Plugins](https://agent-plugins.org) format:
`plugin.json` describes it and `mcp.json` declares the MCP server. Nothing runs
on your machine.

## Sign in

The first time your agent uses the server, a browser window opens. Sign in,
pick the inboxes the agent may use (or create one) and choose what it may do:
read mail, send mail, or both. You can revoke access at
any time in the [dashboard](https://dashboard.atomicmail.ai).

## Tools

| Tool | What it does |
| --- | --- |
| `read_inbox` | Latest messages in the inbox |
| `read_message` | One full message |
| `search_messages` | Full-text search of the mailbox |
| `send_email` | Send an email: plain text or HTML, CC and BCC, From name, Reply-To, attachments |
| `reply_to_message` | Reply in the same thread |
| `list_agents` | The inboxes your account owns |
| `send_invite`, `update_invite`, `cancel_invite` | Meeting invitations that work in Gmail, Outlook and Apple Mail |
| `list_invites`, `respond_to_invite` | Guests' answers and invitations you received |
| `help` | Built-in documentation |

## Try it

- "Check my inbox and summarize what is new."
- "Reply to the latest message from Anna and say Thursday works."
- "Invite anna@example.com to a 30-minute call tomorrow at 15:00."

## Links

- [Hosted MCP server guide](https://docs.atomicmail.ai/mcp-remote)
- [Documentation](https://docs.atomicmail.ai)
- [Support](https://docs.atomicmail.ai/support)
