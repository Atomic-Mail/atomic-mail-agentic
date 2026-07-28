---
description: Use @atomicmail/langchain to run Atomic Mail register, jmap_request, and help as LangChain tools.
---

# @atomicmail/langchain

`@atomicmail/langchain` exposes Atomic Mail as LangChain tools while reusing the
same shared runtime used by MCP and AgentSkill. It provides both:

- a ready-to-use tools array (`createAtomicMailTools`)
- a toolkit class (`AtomicMailToolkit`)

## Auth model

Proof of work — the agent owns its own inbox, no human sign-in. `register`
performs PoW signup and the shared runtime rotates session and capability tokens
for you; the underlying HTTP chain is [REST authentication](/rest-auth). If a
**person** should own the mailbox and authorize your app instead, use
[OAuth 2.0](/oauth) with a plain HTTP client.

## Install

```bash
npm install @atomicmail/langchain
```

## Tool surfaces

```ts
import { createAtomicMailTools, AtomicMailToolkit } from "@atomicmail/langchain";

const tools = await createAtomicMailTools();

const toolkit = await AtomicMailToolkit.create();
const registerTool = toolkit.registerTool;
const jmapTool = toolkit.jmapRequestTool;
const helpTool = toolkit.helpTool;
```

## Available tools

| Tool | Purpose |
| --- | --- |
| `register` | PoW signup / idempotent register with optional `forced` and `credentials_dir`. |
| `jmap_request` | Run JMAP request from `ops` or `ops_file` with vars and optional attachments. |
| `help` | Return built-in docs topics bundled with the package. |

## Behavior parity guarantees

The LangChain wrapper enforces the same core behavior as MCP and AgentSkill:

- register idempotency and `forced` semantics are delegated to shared `AgentSession.register`
- exactly one of `ops` or `ops_file` is required for `jmap_request`
- `dry_run` with attachments is rejected
- user vars are validated with `^[A-Z][A-Z0-9_]*$`
- post-register flow includes cron guidance (`help` topic `cron`)

## Credentials and environment

Defaults match the rest of the stack:

- credential directory: `ATOMIC_MAIL_CREDENTIALS_DIR` or `~/.atomicmail`
- auth API: `ATOMIC_MAIL_AUTH_URL`
- JMAP API: `ATOMIC_MAIL_API_URL`
- PoW salt: `ATOMIC_MAIL_SCRYPT_SALT`
- API key override: `ATOMIC_MAIL_API_KEY`

`credentials_dir` can be passed per tool call for multi-account use.

## Example

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

## See also

- [Raw JMAP requests](/jmap) — the method shapes `jmap_request` sends
- Other integrations: [Make.com](/make) · [n8n](/n8n) · [Dify](/dify) ·
  [Remote MCP](/mcp-remote)
