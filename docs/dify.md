---
description: Use Atomic Mail in Dify — install the marketplace plugin, the six tools it adds, the optional credentials, and a triage workflow pattern.
---

# Dify

Atomic Mail is a tool plugin in the Dify marketplace. It works in Agent apps,
where the model picks tools itself, and in Workflow apps, where you wire tool
nodes by hand.

## Auth model

Proof of work: the plugin's `register` tool creates or recovers an inbox the
app itself owns, with no human sign-in. The underlying HTTP chain is
[REST authentication](/rest-auth). If a person should own the mailbox and
authorize the app instead, call [OAuth 2.0](/oauth) from a Dify HTTP Request
node.

## Install

<div class="steps">

### Install from the marketplace

In your Dify workspace open **Plugins**, search for **Atomic Mail** and
install it. Plugins are workspace-scoped: install once, use in every app of
that workspace.

### Credentials are optional

The plugin settings have three fields, all optional. **API Key**: an existing
Atomic Mail key, if you want to skip `register`. **Auth URL** and **API URL**:
leave at the defaults, `https://auth.atomicmail.ai` and
`https://api.atomicmail.ai`, unless you were given a custom environment.

### Register once

Run the `register` tool with a `username`. It creates the inbox, or logs back
into it when an API key is set. Then read `help` with topic `cron` and decide
with the operator how the inbox will be read.

</div>

## Tools

| Tool | What it does |
| --- | --- |
| `register` | Create the inbox or log into it. Inputs: `username`, optional `forced`, `account_id` |
| `send_mail` | Send a message: `to`, `subject`, `body`, optional attachments |
| `reply` | Reply to a message by id |
| `list_inbox` | List recent messages |
| `jmap_request` | Any JMAP batch, inline `ops` or an `ops_file` preset with `vars` |
| `help` | Built-in topics: `cron`, `presets`, `jmap_cheatsheet`, `troubleshooting` |

`send_mail`, `reply` and `list_inbox` are shortcuts over `jmap_request`; use
`jmap_request` when you need anything they do not cover. `account_id` on every
tool isolates a second inbox inside the same workspace.

## In an Agent app

Add the Atomic Mail tools to the app, start with `register`, and keep `help`
in the tool list so the agent can look things up while it runs.

## In a Workflow app

Add a **Tool** node, choose an Atomic Mail action, pick or create the plugin
credentials if Dify asks, and map workflow variables to the tool inputs.
Dify's own guides: [Tool node](https://docs.dify.ai/en/cloud/use-dify/nodes/tools)
and [tools in a workspace](https://docs.dify.ai/en/cloud/use-dify/workspace/tools).

A minimal triage pattern:

1. **Start**: optional inputs such as which mailbox to scan.
2. **Tool**: `list_inbox`, or `jmap_request` with `ops_file: "list_inbox.json"`.
3. **LLM**: summarize the messages and extract follow-ups.
4. **If/Else**: route urgent items one way, the rest another.
5. **Tool**: `reply` or `send_mail` where a response is due.
6. **End**.

Dify's lesson on plugins in workflows:
[Enhance workflows with plugins](https://docs.dify.ai/en/learn/tutorials/workflow-101/lesson-07).

## Inbox checks after `register`

In Dify, whether the inbox is read unattended is not a `register` input; the
tool takes only `username`. Decide it with the operator. If the inbox should be
watched, schedule a full agent turn once a day (`0 9 * * *`) that runs
`list_inbox` and reports what arrived, not a bare `jmap_request` on a timer.
If your runtime has no scheduler of its own, ask the operator to run the check
from a host that has one. `help` with topic `cron` has the prompt to use.

## Related

<LinkRows :items="[
  { title: 'Raw JMAP requests', desc: 'The method shapes behind jmap_request', link: '/jmap' },
  { title: 'n8n', desc: 'Community node, proof-of-work path', link: '/n8n' },
  { title: 'LangChain', desc: 'Tools for JS and Python agents', link: '/langchain' },
  { title: 'Zapier', desc: 'OAuth connection for a person-owned inbox', link: '/zapier' },
  { title: 'Hosted MCP server', desc: 'One URL for chat hosts', link: '/mcp-remote' },
]" />
