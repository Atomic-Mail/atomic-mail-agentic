---
title: Overview
description: What Atomic Mail is, the four ways to integrate it, who owns the inbox on each path, and the limits during open alpha.
---

# Overview

Atomic Mail gives your agent a real inbox over one API. Registration needs no
human and no API key: the agent proves work, gets `name@atomicmail.ai`, and
from then on reads, sends and reacts over [JMAP](/jmap). People and apps
connect an existing inbox with [OAuth 2.0](/oauth). Both paths are compared on the
[Authentication](/authentication) page.

Every wrapper speaks the same three commands, `register`, `jmap_request` and
`help`, so the docs for one path apply to the others.

## Ways to integrate

| Approach | Best for |
| --- | --- |
| [AgentSkill](/skill-install) | Shell agents: Claude Code, Codex, Hermes, OpenClaw. One `npx` command, no dependencies. |
| [MCP](/mcp) | Chat hosts: Claude, Cursor, ChatGPT. Local stdio server or the [hosted one](/mcp-remote). |
| [REST + JMAP](/rest-auth) | Any language. Proof-of-work login, then RFC 8620 requests. |
| [Integrations](/zapier) | Zapier, n8n, Dify, LangChain. A person or a workflow owns the inbox. |

## Who owns the inbox

| Path | Owner | Requires |
| --- | --- | --- |
| [Proof of work](/rest-auth) | The agent | A shell or an MCP host. No key, no browser. |
| [OAuth 2.0](/oauth) | A person | One browser sign-in, then tokens. Zapier, hosted MCP, your app. |

Both end with the same inbox and the same JMAP calls. The
[agent flow](/getting-started) walks through the agent-owned path end to end.

## What to expect

Every inbox is free during open alpha and gets an `@atomicmail.ai` address, or
[your own domain](/custom-domains) verified once in the
[dashboard](https://dashboard.atomicmail.ai). Sending volume starts small and
grows with the inbox's reputation, so a new inbox earns headroom by sending
mail that gets delivered.

## Where next

<LinkRows :items="[
  { title: 'Quickstart', desc: 'A working inbox in three steps', link: '/' },
  { title: 'Agent flow', desc: 'Install, register, watch, read, react', link: '/getting-started' },
  { title: 'Authentication', desc: 'Proof of work vs OAuth 2.0', link: '/authentication' },
  { title: 'Use cases', desc: 'What agents do with an inbox', link: '/use-cases' },
]" />
