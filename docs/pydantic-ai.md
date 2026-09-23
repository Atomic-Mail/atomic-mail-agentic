---
description: Use pydantic-ai-atomicmail to give a Pydantic AI agent its own inbox — register, jmap_request and help as a toolset or a capability.
---

# Pydantic AI

`pydantic-ai-atomicmail` plugs Atomic Mail into
[Pydantic AI](https://ai.pydantic.dev/) as either a **capability** or a plain
**toolset**, exposing the same three tools — `register`, `jmap_request`, `help` —
over the shared runtime that backs MCP, AgentSkill and the LangChain packages.

| Language | Package | Install |
| --- | --- | --- |
| Python | `pydantic-ai-atomicmail` (PyPI) | `pip install pydantic-ai-atomicmail` |

It bundles the Python Atomic Mail runtime, so it is the only install you need —
there is no separate `atomicmail` package to add.

## Auth model

Proof of work — the agent owns its own inbox, no human sign-in. `register`
performs PoW signup and the shared runtime rotates session and capability tokens
for you; the underlying HTTP chain is [REST authentication](/rest-auth). If a
**person** should own the mailbox and authorize your app instead, use
[OAuth 2.0](/oauth) with a plain HTTP client.

## Capability

The recommended entry point. A capability bundles the tools with instructions
telling the model how to use them:

```python
from pydantic_ai import Agent
from pydantic_ai_atomicmail import AtomicMailCapability

agent = Agent("openai:gpt-5.2", capabilities=[AtomicMailCapability()])
result = agent.run_sync("Check my inbox and summarise anything from today.")
```

Pass `instructions=None` to register the tools without the bundled instructions,
or a string of your own to replace them.

## Toolset

When you want the tools without the instructions, or want to compose them with
other [toolsets](https://ai.pydantic.dev/toolsets/):

```python
from pydantic_ai import Agent
from pydantic_ai_atomicmail import AtomicMailToolset

agent = Agent("openai:gpt-5.2", toolsets=[AtomicMailToolset()])
```

## Multiple inboxes

Both accept `credentials_dir`, which becomes the default for every tool call.
The model can still override it per call, so one process can drive several
inboxes:

```python
support = AtomicMailToolset(credentials_dir="/srv/agents/support/.atomicmail")
billing = AtomicMailToolset(credentials_dir="/srv/agents/billing/.atomicmail")
```

## Available tools

| Tool | Purpose |
| --- | --- |
| `register` | PoW signup / idempotent register with optional `forced` and `credentials_dir`. |
| `jmap_request` | Run JMAP request from `ops` or `ops_file` with vars and optional attachments. |
| `help` | Return built-in docs topics bundled with the package. |

## Same behavior as MCP and AgentSkill

The Pydantic AI tools share the runtime with the other wrappers, so:

- register idempotency and `forced` semantics are delegated to shared `AgentSession.register`
- exactly one of `ops` or `ops_file` is required for `jmap_request`
- `dry_run` with attachments is rejected
- user vars are validated with `^[A-Z][A-Z0-9_]*$`
- post-register flow includes cron guidance (`help` topic `cron`)

## Credentials and environment

The same environment as the other wrappers:

- credential directory: `ATOMIC_MAIL_CREDENTIALS_DIR` or `~/.atomicmail`
- API key override: `ATOMIC_MAIL_API_KEY`

## Related

<LinkRows :items="[
  { title: 'LangChain', desc: 'The same three tools for LangChain agents', link: '/langchain' },
  { title: 'Raw JMAP requests', desc: 'The method shapes jmap_request sends', link: '/jmap' },
  { title: 'Agentic core', desc: 'The shared runtime these packages build on', link: '/core' },
  { title: 'Hosted MCP server', desc: 'One URL for chat hosts', link: '/mcp-remote' },
]" />
