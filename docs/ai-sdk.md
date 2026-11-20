---
description: Use @atomicmail/ai-sdk to give a Vercel AI SDK agent an email inbox—read, search, send and reply with generateText, streamText or an agent, in Node, serverless and edge functions.
---

# Vercel AI SDK

`@atomicmail/ai-sdk` gives an agent built with the
[AI SDK](https://ai-sdk.dev) an email inbox of its own: it can read the inbox,
search, read one message, send and reply. Use it when an agent has to email
someone, wait for an answer, or read a verification code.

Each tool is one HTTPS request to the
[hosted Atomic Mail endpoint](https://docs.atomicmail.ai/mcp-remote). Nothing
is stored on disk and nothing runs next to your code, so the tools work the
same in Node, in serverless functions and at the edge.

## Install

```bash
npm install @atomicmail/ai-sdk ai
```

The package needs AI SDK 7 (`ai@^7`).

## Get an API key

1. Create an inbox in [the dashboard](https://dashboard.atomicmail.ai).
2. Open the inbox's **Connect** dialog and copy its API key.
3. Put the key in the `ATOMIC_MAIL_API_KEY` environment variable.

The key gives full access to that one inbox. Keep it in your host's secret
store, not in code.

An inbox that an agent registered on its own with proof of work has to be
linked in the dashboard first; until then its key is refused here.

## Use

```ts
import { generateText, isStepCount } from "ai";
import { atomicMailTools } from "@atomicmail/ai-sdk";

const { text } = await generateText({
  model: "openai/gpt-5-mini",
  prompt:
    "Check my inbox, summarize the newest message and reply that I will answer tomorrow.",
  tools: atomicMailTools(),
  stopWhen: isStepCount(5),
});

console.log(text);
```

The same object works with `streamText` and `ToolLoopAgent`.

## Tools

| Tool | What it does | Input |
| --- | --- | --- |
| `readInbox` | Lists the newest inbox messages, newest first | `limit` (1–50, default 10) |
| `searchMessages` | Searches all mail by text | `query`, `limit` |
| `readMessage` | Reads one message in full | `messageId` |
| `sendEmail` | Sends an email from the inbox | `to`, `subject`, `body`; optional `cc`, `bcc`, `htmlBody`, `fromName`, `replyTo` |
| `replyToMessage` | Replies in the thread of a message | `messageId`, `body`; optional `htmlBody`, `fromName`, `replyTo` |

`readInbox` and `searchMessages` return `{ messages }`, where each message has
`id`, `from`, `to`, `subject`, `preview` and `receivedAt`. `sendEmail` and
`replyToMessage` return `{ sent: true, messageId, threadId }`.

## Options

```ts
atomicMailTools({
  apiKey: process.env.SUPPORT_INBOX_KEY, // default: ATOMIC_MAIL_API_KEY
  timeout: 30_000, // milliseconds, default 30 000
});
```

Two more options, `baseUrl` and `fetch`, are there for a proxy or a test.

## A read-only agent

`atomicMailTools()` returns a plain object, so pass only the tools a model
should have:

```ts
const { readInbox, searchMessages, readMessage } = atomicMailTools();

await generateText({
  model: "openai/gpt-5-mini",
  prompt: "What did Anna write this week?",
  tools: { readInbox, searchMessages, readMessage },
  stopWhen: isStepCount(5),
});
```

## Confirm before sending

`sendEmail` and `replyToMessage` send real mail to real recipients. To have a
person confirm each message first, use the AI SDK's
[tool approval](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling#tool-execution-approval)
on the call:

```ts
const result = await generateText({
  model: "openai/gpt-5-mini",
  prompt: "Email anna@example.com that the report is ready.",
  tools: atomicMailTools(),
  toolApproval: {
    sendEmail: "user-approval",
    replyToMessage: "user-approval",
  },
  stopWhen: isStepCount(5),
});
```

The call then returns a `tool-approval-request` in `result.content` and sends
nothing until your app answers it.

## Errors

A failed request throws an `AtomicMailError` with a plain message, and the AI
SDK hands it to the model as the tool's error, so the model can tell the user
what went wrong. The messages name the cause: a rejected key, a rate limit, a
message that does not exist, a timeout. The API key never appears in them.

## Mail is untrusted input

The body of an email is written by its sender. `readMessage` returns it
between markers that label it as untrusted, so a model reads it as information
and does not follow instructions inside it. Keep that in mind when an agent
that reads mail can also send it, and use tool approval or a read-only set
where it matters.

## Other ways to connect

- An MCP client can use the same inbox through the
  [hosted MCP server](https://docs.atomicmail.ai/mcp-remote), which also has
  calendar invitations and raw JMAP.
- An agent that should register its own inbox, with no person and no
  dashboard, uses the [local MCP server](https://docs.atomicmail.ai/mcp) or the
  [AgentSkill CLI](https://docs.atomicmail.ai/skill-install).
