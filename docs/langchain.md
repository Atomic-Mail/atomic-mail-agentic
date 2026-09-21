---
description: Use the Atomic Mail LangChain packages—@atomicmail/langchain for JS and langchain-atomicmail for Python—to run register, jmap_request, and help as LangChain tools.
---

# LangChain

Atomic Mail ships LangChain integrations for **both** runtimes, built from the
same release and published at the same version:

| Language | Package | Install |
| --- | --- | --- |
| JavaScript / TypeScript | `@atomicmail/langchain` (npm) | `npm install @atomicmail/langchain` |
| Python | `langchain-atomicmail` (PyPI) | `pip install langchain-atomicmail` |

Both expose the same three tools — `register`, `jmap_request`, `help` — over the
same shared runtime that backs MCP and AgentSkill, so behavior does not drift
between them.

## Auth model

Proof of work — the agent owns its own inbox, no human sign-in. `register`
performs PoW signup and the shared runtime rotates session and capability tokens
for you; the underlying HTTP chain is [REST authentication](/rest-auth). If a
**person** should own the mailbox and authorize your app instead, use
[OAuth 2.0](/oauth) with a plain HTTP client.

## Install and use

<TabGroup group="lang" :tabs="[{ id: 'js', label: 'JavaScript' }, { id: 'py', label: 'Python' }]">
<template #js>

```bash
npm install @atomicmail/langchain
```

It provides both a ready-to-use tools array (`createAtomicMailTools`) and a
toolkit class (`AtomicMailToolkit`).

### Tool surfaces

```ts
import { createAtomicMailTools, AtomicMailToolkit } from "@atomicmail/langchain";

const tools = await createAtomicMailTools();

const toolkit = await AtomicMailToolkit.create();
const registerTool = toolkit.registerTool;
const jmapTool = toolkit.jmapRequestTool;
const helpTool = toolkit.helpTool;
```

#### Example

```ts
import { createAtomicMailTools } from "@atomicmail/langchain";

const [register, jmapRequest, help] = await createAtomicMailTools();

await register.invoke({ username: "myagent" });

const inbox = await jmapRequest.invoke({
  ops_file: "list_inbox.json",
});

const docs = await help.invoke({ topic: "presets" });
console.log(inbox, docs);
```

</template>
<template #py>

```bash
pip install langchain-atomicmail
```

Published on PyPI as **`langchain-atomicmail`**, released alongside the npm
package at the same version. It bundles the Python Atomic Mail runtime, so it is
the only install you need — there is no separate `atomicmail` package to add.

The same three tools, the same credential directory, and the same
`ATOMIC_MAIL_*` environment variables listed above apply.

</template>
</TabGroup>

## Available tools

| Tool | Purpose |
| --- | --- |
| `register` | PoW signup / idempotent register with optional `forced` and `credentials_dir`. |
| `jmap_request` | Run JMAP request from `ops` or `ops_file` with vars and optional attachments. |
| `help` | Return built-in docs topics bundled with the package. |

## Same behavior as MCP and AgentSkill

The LangChain tools share the runtime with the other wrappers, so:

- register idempotency and `forced` semantics are delegated to shared `AgentSession.register`
- exactly one of `ops` or `ops_file` is required for `jmap_request`
- `dry_run` with attachments is rejected
- user vars are validated with `^[A-Z][A-Z0-9_]*$`
- post-register flow includes cron guidance (`help` topic `cron`)

## Credentials and environment

The same environment as the other wrappers:

- credential directory: `ATOMIC_MAIL_CREDENTIALS_DIR` or `~/.atomicmail`
- API key override: `ATOMIC_MAIL_API_KEY`

`credentials_dir` can be passed per tool call for multi-account use.

## Related

<LinkRows :items="[
  { title: 'Raw JMAP requests', desc: 'The method shapes jmap_request sends', link: '/jmap' },
  { title: 'Agentic core', desc: 'The shared runtime both packages build on', link: '/core' },
  { title: 'n8n', desc: 'Community node, proof-of-work path', link: '/n8n' },
  { title: 'Dify', desc: 'Marketplace plugin, proof-of-work path', link: '/dify' },
  { title: 'Hosted MCP server', desc: 'One URL for chat hosts', link: '/mcp-remote' },
]" />
