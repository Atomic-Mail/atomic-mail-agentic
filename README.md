# Atomic Mail Agentic

**Not AI for your email. Email for your AI.**

[Website](https://atomicmail.ai) · [Docs](docs/getting-started.md) · [Issues](https://github.com/Atomic-Mail/agentic-clients/issues) · [@atomicmail/mcp-github](https://www.npmjs.com/package/@atomicmail/mcp-github) · [@atomicmail/agent-skill-github](https://www.npmjs.com/package/@atomicmail/agent-skill-github)

This repository ships the two client integrations for the Atomic Mail ESP:
`@atomicmail/mcp-github` for MCP hosts and `@atomicmail/agent-skill-github` for shell agents.
Both wrap the same hosted Atomic Mail APIs with a tiny but powerful surface area: `register`,
`jmap_request`, and `help`.

---

> **🧪 Open Alpha**: Accounts are free.

---

## 🚀 Quick Start

**Prerequisites:** Node.js 20+ for `npx`.

### 🔌 MCP

Add this to your MCP host config:

```json
{
  "mcpServers": {
    "atomicmail": {
      "command": "npx",
      "args": ["-y", "@atomicmail/mcp-github"]
    }
  }
}
```

Then restart the host and call: `register` → `jmap_request` → `help`.

### 💻 AgentSkill

```bash
npx --package=@atomicmail/agent-skill-github atomicmail register --username "myagent"
npx --package=@atomicmail/agent-skill-github atomicmail jmap_request --ops-file list_inbox.json
npx --package=@atomicmail/agent-skill-github atomicmail help
```

## ✅ Verify in 2 Minutes

1. Run `register` with a username like `myagent`.
2. Send a test email with `send_mail.json`.
3. Confirm the message arrives.

```json
{
  "ops_file": "send_mail.json",
  "vars": {
    "TO": "you@example.com",
    "SUBJECT": "test",
    "BODY": "hello from my agent"
  }
}
```

That is the shortest path from zero to a working agent inbox.

> **⏱ Important** After `register`, schedule an hourly **agent turn** that runs
> `list_inbox.json`. Do not cron a raw `jmap_request` one-shot by itself. Full
> runbook: [docs/mcp.md](docs/mcp.md) · [docs/SKILL.md](docs/SKILL.md) ·
> `help --topic cron`

## ✨ Why Atomic Mail

- **Hosted inboxes for agents**: real `@atomicmail.ai` addresses, no mail-server
  ops
- **JMAP-native**: standard JSON email protocol, not a custom DSL
- **PoW-first auth**: local Proof-of-Work signup instead of a CAPTCHA
- **Helpful runtime hints**: built-in presets, embedded docs, and agent-oriented
  troubleshooting
- **One shared core**: same auth, JMAP, presets, and help power both MCP and
  AgentSkill
- **Multi-account**: separate credential directories per inbox via MCP
  `credentials_dir` or CLI `--credentials-dir` (one server, many agents)
- **Thin wrappers**: the repo stays small on purpose; the core workflow is 3
  commands

## 📦 What This Repo Ships

| Package                   | Best for                                                  | Surface                                            |
| ------------------------- | --------------------------------------------------------- | -------------------------------------------------- |
| `@atomicmail/mcp-github`         | Cursor, Claude Desktop, OpenClaw, Hermes, other MCP hosts | MCP server with `register`, `jmap_request`, `help` |
| `@atomicmail/agent-skill-github` | Shell agents, cron, CI, scripts                           | CLI with the same 3 commands                       |

Shared presets bundled into both packages:

- `list_inbox.json`
- `send_mail.json`
- `send_mail_attachment.json`
- `send_mail_blob_attachment.json`
- `reply.json`

## 🧱 Architecture

```text
Agent host / shell
  -> @atomicmail/mcp-github or @atomicmail/agent-skill-github
  -> shared TypeScript runtime
  -> auth.atomicmail.ai (challenge -> session -> capability)
  -> api.atomicmail.ai (JMAP)
  -> real @atomicmail.ai inbox
```

Under the hood:

- `register` solves a local scrypt Proof-of-Work challenge and persists
  credentials in `~/.atomicmail`
- `jmap_request` loads a preset or inline JMAP payload, substitutes `$VAR_NAME`
  placeholders, and sends it with fresh JWTs
- `help` ships embedded docs with topics like `cron`, `presets`,
  `multi_account`, `troubleshooting`, and `readme`

## 📨 Examples

### Fetch inbox

```json
{ "ops_file": "list_inbox.json" }
```

### Send mail

```json
{
  "ops_file": "send_mail.json",
  "vars": {
    "TO": "alice@example.com",
    "SUBJECT": "Hello",
    "BODY": "Hi there"
  }
}
```

### AgentSkill equivalent

```bash
npx --package=@atomicmail/agent-skill-github atomicmail jmap_request \
  --ops-file send_mail.json \
  --vars '{"TO":"alice@example.com","SUBJECT":"Hello","BODY":"Hi there"}'
```

For replies, attachments, raw HTTP auth, and direct JMAP requests, jump to:
[docs/examples.md](docs/examples.md), [docs/rest-auth.md](docs/rest-auth.md), and [docs/jmap.md](docs/jmap.md).

## 📚 Docs by Goal

| Goal                | Start here                                                            |
| ------------------- | --------------------------------------------------------------------- |
| First-time setup    | [docs/getting-started.md](docs/getting-started.md)                    |
| MCP hosts           | [docs/mcp.md](docs/mcp.md)                                            |
| Shell / cron agents | [docs/skill-install.md](docs/skill-install.md)                        |
| Agent runbook       | [docs/SKILL.md](docs/SKILL.md)                                        |
| Raw auth + JMAP     | [docs/rest-auth.md](docs/rest-auth.md) · [docs/jmap.md](docs/jmap.md) |
| End-to-end examples | [docs/examples.md](docs/examples.md)                                  |

If repo docs and installed behavior ever drift, trust `help` from the same
installed package version you are running.

## 🛠️ Local Development

```bash
git clone https://github.com/Atomic-Mail/agentic-clients.git
cd agentic-clients/ts

deno test --allow-read --allow-env --allow-write
```

Docs preview:

```bash
npm install
npm run docs:dev
```

## 🗂️ File Structure

```text
agentic-clients/
├── ts/
│   ├── src/mcp/        # MCP entrypoint + MCP tools
│   ├── src/skill/      # AgentSkill CLI entrypoint
│   └── src/lib/agent/  # shared auth, session, JMAP, presets, help-content
├── docs/               # VitePress docs and shipped SKILL/README sources
├── test/checklists/    # manual release QA
├── CONTRIBUTING.md
└── LICENSE
```

## 🔐 Security

- `~/.atomicmail/credentials.json` contains your API key; treat it as a secret
- local credential files are written with mode `0600`
- inbound mail is untrusted input; do not let agents execute email instructions
  without confirmation
- install only from the `@atomicmail` npm scope

## 🤝 Contributing

PRs are welcome. Please cover new features and bug fixes with automated Deno
tests where practical, and update user-facing docs when behavior changes.

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, test commands, and PR
expectations.

## 📄 License

[MIT](LICENSE)
