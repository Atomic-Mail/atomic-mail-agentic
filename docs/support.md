---
title: Support
description: Where to get help with Atomic Mail Agentic — support email, GitHub issues, X, the dashboard and the package pages on npm and PyPI.
---

# Support

Write to [support@atomicmail.ai](mailto:support@atomicmail.ai) for anything about
an inbox you own: accounts, addresses, custom domains, delivery. Send it from the
address that owns the inbox, that is how we match you to it.

For bugs and requests in the agent packages, the AgentSkill CLI, the MCP servers,
presets and integrations, open a
[GitHub issue](https://github.com/Atomic-Mail/atomic-mail-agentic/issues). Include
the command or tool call and the error text; every auth error already carries a
`hint` and a `docs_url`, paste them too.

Inboxes, API keys, custom domains and OAuth grants are managed in the
[dashboard](https://dashboard.atomicmail.ai). Release notes and announcements go
out on [X](https://x.com/atomic_mail) and in the [changelog](/changelog).

## Before you write

Most agent-side questions are answered by the package itself. Run
`atomicmail help` (or the `help` tool in MCP) with a topic such as `cron`,
`presets`, `troubleshooting` or `jmap_cheatsheet`. The installed help matches the
version you are running, which this site cannot promise. The
[agent flow](/getting-started) and [authentication](/authentication) pages cover
the two questions we get most: what `--watch` sets up, and which auth path a
caller should use.

## Source and packages

| Package | Registry | What it is |
| --- | --- | --- |
| [atomic-mail-agentic](https://github.com/Atomic-Mail/atomic-mail-agentic) | GitHub | AgentSkill, MCP servers, presets, integrations, this documentation |
| [@atomicmail/agent-skill](https://www.npmjs.com/package/@atomicmail/agent-skill) | npm | AgentSkill CLI |
| [@atomicmail/mcp](https://www.npmjs.com/package/@atomicmail/mcp) | npm | Local MCP server |
| [@atomicmail/langchain](https://www.npmjs.com/package/@atomicmail/langchain) | npm | LangChain tools for JavaScript |
| [langchain-atomicmail](https://pypi.org/project/langchain-atomicmail/) | PyPI | LangChain tools for Python |
| [@atomicmail/agentic-core](https://www.npmjs.com/package/@atomicmail/agentic-core) | npm | Shared runtime for integrations |
| [@atomicmail/n8n-nodes-atomicmail](https://www.npmjs.com/package/@atomicmail/n8n-nodes-atomicmail) | npm | n8n community node |
