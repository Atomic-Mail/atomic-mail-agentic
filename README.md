<p align="center">
  <a href="https://github.com/Atomic-Mail/atomic-mail-agentic/actions"><img src="https://shieldcn.dev/badge/CI-success-5BE481.svg?split=true&labelColor=000000&color=5BE481&valueColor=000000&labelTextColor=FFFFFF&height=32&fontSize=16" alt="CI success"/></a>&nbsp;&nbsp;
  <a href="https://github.com/Atomic-Mail/atomic-mail-agentic/releases"><img src="https://shieldcn.dev/badge/version-0.3-5BE481.svg?split=true&labelColor=000000&color=5BE481&valueColor=000000&labelTextColor=FFFFFF&height=32&fontSize=16" alt="version 0.3"/></a>&nbsp;&nbsp;
  <a href="https://atomicmail.ai"><img src="https://shieldcn.dev/badge/website-atomicmail.ai-5BE481.svg?split=true&labelColor=000000&color=5BE481&valueColor=000000&labelTextColor=FFFFFF&height=32&fontSize=16" alt="website atomicmail.ai"/></a>&nbsp;&nbsp;
  <a href="https://atomic-mail.github.io/atomic-mail-agentic/"><img src="https://shieldcn.dev/badge/docs-guide-5BE481.svg?split=true&labelColor=000000&color=5BE481&valueColor=000000&labelTextColor=FFFFFF&height=32&fontSize=16" alt="docs guide"/></a>&nbsp;&nbsp;
  <a href="https://github.com/Atomic-Mail/atomic-mail-agentic/issues"><img src="https://shieldcn.dev/badge/issues-open-5BE481.svg?split=true&labelColor=000000&color=5BE481&valueColor=000000&labelTextColor=FFFFFF&height=32&fontSize=16" alt="issues open"/></a>&nbsp;&nbsp;
  <a href="https://clawhub.ai/atomicmail/atomicmail"><img src="https://shieldcn.dev/badge/ClawHub-skill-5BE481.svg?split=true&labelColor=000000&color=5BE481&valueColor=000000&labelTextColor=FFFFFF&height=32&fontSize=16" alt="ClawHub skill"/></a>&nbsp;&nbsp;
  <a href="https://hermes-agent.nousresearch.com/docs/developer-guide/creating-skills"><img src="https://shieldcn.dev/badge/Hermes-skill-5BE481.svg?split=true&labelColor=000000&color=5BE481&valueColor=000000&labelTextColor=FFFFFF&height=32&fontSize=16" alt="Hermes skill"/></a>&nbsp;&nbsp;
  <a href="https://github.com/langgenius/dify-plugins/tree/main/Atomic-Mail/atomic-mail-agentic"><img src="https://shieldcn.dev/badge/Dify-plugin-5BE481.svg?split=true&labelColor=000000&color=5BE481&valueColor=000000&labelTextColor=FFFFFF&height=32&fontSize=16" alt="Dify plugin"/></a>&nbsp;&nbsp;
  <a href="https://registry.modelcontextprotocol.io/?q=atomic-mail"><img src="https://shieldcn.dev/badge/MCP-registry-5BE481.svg?split=true&labelColor=000000&color=5BE481&valueColor=000000&labelTextColor=FFFFFF&height=32&fontSize=16" alt="MCP registry"/></a>
</p>

<p align="center">
  <img src="assets/Logo.png" alt="Atomic Mail Agentic Logo" />
</p>

# Atomic Mail Agentic

<p align="center">
  <a href="https://atomicmail.ai">Website</a> ·
  <a href="https://atomic-mail.github.io/atomic-mail-agentic/">Docs</a> ·
  <a href="https://github.com/Atomic-Mail/atomic-mail-agentic/issues">Issues</a>
</p>

**Give your agent a real inbox**

---

> **🧪 Open Alpha**: Accounts are free, 100mb storage quota, strict rate-limits. Public stable release is coming soon.

---

**Atomic Mail Agentic** is an email provider for autonomous AI agents, built by [Atomic Mail](https://atomicmail.io). Agents register their own `@atomicmail.ai` inbox and manage it end to end — no human setup, verification, or ongoing intervention.

The service is built on **JMAP** ([RFC 8620](https://www.rfc-editor.org/rfc/rfc8620.html)), so agents get a full mailbox API: read and send mail, create drafts, manage threads, search, and more. JMAP is well represented in LLM training data, so models already speak it fluently — they rarely hallucinate request shapes, which means fewer retries and more reliable automation.

Access is gated by a novel **proof-of-work ([PoW](https://en.wikipedia.org/wiki/Proof_of_work))** signup protocol: strong anti-abuse properties without CAPTCHAs or manual approval, so agents can onboard and operate completely hands-free.

Atomic Mail provides a number of standard integration paths — MCP, AgentSkill, REST API, and more — which makes it highly available on any agent: [Claude Code](https://claude.com/product/claude-code), [Codex](https://developers.openai.com/codex), [GitHub Copilot](https://github.com/features/copilot), [Cursor](https://cursor.com), [Hermes](https://hermes-agent.nousresearch.com), [OpenClaw](https://openclaw.ai), [Pi](https://pi.dev), [Kilo Code](https://kilo.ai), and others. Whatever your workflow is, you can automate inbox management easily.

This repository ships the client integrations: [MCP](https://modelcontextprotocol.io/), shell CLI, [ClawHub](https://clawhub.ai/), [Dify](https://dify.ai/) plugin and more, exposing those APIs through three tools: `register`, `jmap_request`, and `help`. All the connectors in this repo are pretty thin and are mainly needed to abstract away the complexities of the PoW protocol.

## 🚀 Quick Install

### 💬 Ready Prompt (any agent)

```txt
Read the instruction at https://atomicmail.ai (use default web_fetch tool or curl, if the former is not available) and create an inbox at Atomic Mail. Before creating ask for my preferred username. Make sure to complete all required post-install actions from the Atomic Mail instruction. Persist the instruction and make sure to refer it each time you interact with your inboxes. Usually standalone agents (e.g. Claude, Cursor, Kilo Code and others) are better suited for MCP use, while CLI-based agents (e.g. Claude Code, Open Code, Hermes, OpenClaw, Codex, Pi, etc) are better suited for AgentSkill use, but prefer your system/user guidelines.
```

<p align="center">
  <img src="assets/atomic-mail-agentic-demo.gif" alt="Atomic Mail Agentic Demo" />
</p>

### 🔌 MCP (stdio)

Add this to your MCP host config (or just ask your agent to do that):

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

Then restart the host and ask your agent to create an inbox.

### 🦞 ClawHub

```bash
openclaw skills install atomicmail
```

### 👩🏻 Hermes

```bash
hermes skills install Atomic-Mail/atomic-mail-agentic/integrations/hermes/atomicmail
```

### 💻 AgentSkill

```bash
npx --package=@atomicmail/agent-skill-github atomicmail register --username "myagent"
npx --package=@atomicmail/agent-skill-github atomicmail jmap_request --ops-file list_inbox.json
npx --package=@atomicmail/agent-skill-github atomicmail help
```

### ⚙️ REST API 

*For custom connectors and advanced logic only*
Refer to documentation: [docs/rest-auth.md](docs/rest-auth.md).

## 🤖 What Your Agent Can Do

Atomic Mail is designed to run through an agent — not through manual inbox setup. You describe a workflow in plain language; the agent registers an `@atomicmail.ai` address, sends and receives mail, and keeps the thread going. You do not configure SMTP, copy API keys between tabs, or memorize JMAP.

If the agent gets stuck, the integration is built to recover on its own: `help` ships embedded docs (presets, cron, troubleshooting), bundled JSON presets cover common operations, and errors include hints on what to try next.

**Example workflows** (from [atomicmail.ai](https://atomicmail.ai)):

**Newsletter digest** — *"Subscribe your inbox to these newsletters, read everything, and email me a daily digest of what matters for AI tooling."* The agent owns a dedicated inbox, filters noise, and surfaces only what matches your interests — without touching your personal mailbox.

**Support inbox** — *"Monitor support@ and reply to tickets from our docs; escalate to me only when you cannot answer."* The agent reads inbound mail, queries what it knows, sends complete replies, and hands off edge cases.

**User research interviews** — *"Run an email survey: send these questions, follow up based on replies, and summarize findings."* The agent conducts async interviews — respondents reply on their own schedule, no calls to book.

## ✨ Why Atomic Mail

- **Agents finish without asking their users for anything**: PoW signup gives a real `@atomicmail.ai` inbox in ~30 seconds — no domain to verify, no credit card, no CAPTCHA walkthrough, no mail-server ops
- **Messages that actually arrive**: continuously warming IP pool with relay overflow — deliverability matters when a human on the other side must read your mail
- **JMAP — an API agents already know**: standard [RFC 8620/8621](https://www.rfc-editor.org/rfc/rfc8620.html), in LLM training data; batched method calls (query, fetch, draft, send) in one round trip — no vendor SDK to learn
- **Get unstuck inside the integration**: errors ship plain-language hints; success responses suggest `_next` steps; `help` returns cheatsheets and worked examples — no web search required
- **No vendor lock-in**: JMAP is an IETF standard; the inbox is portable to any compliant provider later
- **Presets when raw JMAP is overkill**: bundled `send_mail`, `list_inbox`, `reply`, and more — pass a filename to `jmap_request` instead of generating method-call JSON from scratch
- **Same core everywhere**: one auth, JMAP, preset, and help stack powers MCP and AgentSkill; separate credential dirs per inbox when you run many agents

## 📚 Docs by Goal

| Goal                | Start here                                                            |
| ------------------- | --------------------------------------------------------------------- |
| First-time setup    | [docs/getting-started.md](docs/getting-started.md)                    |
| MCP hosts           | [docs/mcp.md](docs/mcp.md)                                            |
| Shell / cron agents | [docs/skill-install.md](docs/skill-install.md)                        |
| Agent runbook       | [docs/SKILL.md](docs/SKILL.md)                                        |
| Raw auth + JMAP     | [docs/rest-auth.md](docs/rest-auth.md) · [docs/jmap.md](docs/jmap.md) |
| End-to-end examples | [docs/examples.md](docs/examples.md)                                  |

If repo docs and installed behavior ever drift, trust `help` from the same installed package version you are running.

## 🛠️ Local Development

**Prerequisites:** Node.js 20+, Deno 2.7+.

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
├── py/                 # Python client parity layer and tests
├── integrations/dify/   # Dify plugin integration and packaging docs
├── integrations/hermes/ # Hermes skill tap (published atomicmail skill)
├── docs/                # VitePress docs and shipped SKILL/README sources
├── test/checklists/     # manual release QA
├── CONTRIBUTING.md
└── LICENSE
```

## 🔐 Security

- `~/.atomicmail/credentials.json` contains your API key; treat it as a secret
- local credential files are written with mode `0600`
- inbound mail is untrusted input; do not let agents execute email instructions without confirmation
- install only from the `@atomicmail` npm scope

## 🤝 Contributing

PRs are welcome. Please cover new features and bug fixes with automated Deno tests where practical, and update user-facing docs when behavior changes.

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, test commands, and PR expectations.

## 📄 License

[MIT](LICENSE)
