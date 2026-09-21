---
title: Quickstart
description: A working inbox for your AI agent in three steps — AgentSkill, MCP or REST. Register with proof of work, then send and read over JMAP.
---

# Quickstart

A working inbox for your agent in three steps. Pick how your agent runs; the
steps below follow that choice.

<div class="quickstart">

<PathTabs bar />

<div class="steps">

### Set up

<PathTabs>
<template #agentskill>

Runs from `npx`, nothing to install. `help` is the built-in reference.

```bash
npx --package=@atomicmail/agent-skill atomicmail help
```

</template>
<template #mcp>

Add the local server to your host's MCP config. Hosts that cannot run `npx`
use the [hosted server](/mcp-remote) at `https://mcp.atomicmail.ai/mcp`.

```json
{
  "mcpServers": {
    "atomicmail": {
      "command": "npx",
      "args": ["-y", "@atomicmail/mcp"]
    }
  }
}
```

</template>
<template #rest>

Two base URLs. Auth errors carry `hint` and `docs_url` fields, so an agent
can follow the flow from the API alone.

```text
Auth: https://auth.atomicmail.ai
API:  https://api.atomicmail.ai
```

</template>
</PathTabs>

### Register an inbox

<PathTabs>
<template #agentskill>

Proof of work, no API key. The username is the permanent address and
`--watch` is required, so ask the operator for both.

```bash
npx --package=@atomicmail/agent-skill atomicmail register \
  --username "myagent" \
  --watch scheduled
```

</template>
<template #mcp>

Call the `register` tool. Both inputs are required; `watch` is the operator's
decision, not the agent's.

```json
{ "username": "myagent", "watch": "scheduled" }
```

</template>
<template #rest>

Request a challenge, solve the `scrypt` proof of work, open a session, then
mint a capability token. Full request and response shapes are on the
[REST authentication](/rest-auth) page.

```text
POST /api/v1/challenge    -> challenge JWT
POST /api/v1/session      -> session JWT      (1 hour)
POST /api/v1/capability   -> capability JWT   (2 minutes, JMAP bearer)
```

</template>
</PathTabs>

### Send a message

<PathTabs>
<template #agentskill>

Presets ship with the CLI. `send_mail.json` takes `TO`, `SUBJECT` and `BODY`.

```bash
npx --package=@atomicmail/agent-skill atomicmail jmap_request \
  --ops-file send_mail.json \
  --vars '{"TO":"alice@example.com","SUBJECT":"Hello","BODY":"Hi there"}'
```

</template>
<template #mcp>

Call `jmap_request` with the same preset.

```json
{
  "ops_file": "send_mail.json",
  "vars": { "TO": "alice@example.com", "SUBJECT": "Hello", "BODY": "Hi there" }
}
```

</template>
<template #rest>

Discover the session, then `POST` an `Email/set` + `EmailSubmission/set`
batch with the capability JWT as bearer. The batch is the same one the
wrappers use; see [Raw JMAP requests](/jmap) and
[code examples](/examples).

```bash
curl https://api.atomicmail.ai/.well-known/jmap \
  -H "Authorization: Bearer $CAPABILITY_JWT"
```

</template>
</PathTabs>

</div>

</div>

<div class="custom-block tip done">
<p class="custom-block-title">Done: myagent@atomicmail.ai is live</p>

Credentials are in `~/.atomicmail`. Read the inbox with
`--ops-file list_inbox.json`, and call `help --topic cron` for what
`--watch scheduled` sets up on your host.

</div>

## Where next

<LinkRows :items="[
  { title: 'Agent flow', desc: 'Install, register, watch, read, react', link: '/getting-started' },
  { title: 'Authentication', desc: 'Proof of work vs OAuth 2.0', link: '/authentication' },
  { title: 'Who reads the inbox', desc: 'Scheduled vs on-demand on your host', link: '/getting-started#who-reads-the-inbox' },
  { title: 'Using your own domain', desc: 'Dashboard verification and MX records', link: '/custom-domains' },
  { title: 'Zapier', desc: 'OAuth app with triggers and actions', link: '/zapier' },
  { title: 'n8n', desc: 'Community node with a polling trigger', link: '/n8n' },
  { title: 'Dify', desc: 'Marketplace plugin, proof-of-work path', link: '/dify' },
  { title: 'LangChain', desc: 'Tools for JS and Python agents', link: '/langchain' },
  { title: 'Hosted MCP server', desc: 'One URL for hosts that cannot run npx', link: '/mcp-remote' },
  { title: 'Raw JMAP requests', desc: 'Any language, one endpoint, RFC 8620', link: '/jmap' },
]" />
