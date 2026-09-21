---
title: Agent flow
description: How an agent gets and keeps an Atomic Mail inbox — install a wrapper, register with the required watch value, set up the daily inbox check, then read and send over JMAP.
---

# Agent flow

Every wrapper on this site, AgentSkill, the MCP servers, the LangChain and
n8n packages, walks the same path. This page is that path end to end, with the
decisions each step asks of you.

<div class="steps">

### Install a wrapper

Shell agents use [AgentSkill](/skill-install), chat hosts use the
[local MCP server](/mcp). Both run from `npx` with nothing to install. If
neither fits, the [REST](/rest-auth) and [JMAP](/jmap) pages document the
same calls over plain HTTP.

### Register once

`register` creates the inbox, or logs back into it when credentials already
exist. It needs a `username`, the permanent address, and a `watch` value, see
[Who reads the inbox](#who-reads-the-inbox). If credentials for a different
username are already on disk, the call is refused and the error names the safe
way forward: a separate credentials directory.

### Set up the daily check

On `watch: scheduled`, `register` prints the setup step for the host that
called it, with the credentials directory filled in. Run it as printed. It
schedules an agent turn once a day that reads the inbox with `list_inbox.json`
and reports what arrived.

### Read and send

`jmap_request` runs a JMAP batch, inline or from a preset file. Placeholders
stand in for the values the session knows: `$ACCOUNT_ID`, `$INBOX`,
`$INBOX_MAILBOX_ID`, `$UPLOAD_URL`, `$DOWNLOAD_URL`, plus anything you pass in
`vars`.

### Ask `help`

The `help` topics ship inside the package and match the version you run. Call
`help` before improvising a batch, and `help --topic cron` after `register`.

</div>

## Which authentication path?

- [Proof of work](/rest-auth): the agent registers its own inbox. No human, no
  browser, no API key up front. This is what `register` does in every wrapper.
- [OAuth 2.0](/oauth): a person authorizes an app on inboxes they own. This is
  the path for [Zapier](/zapier), the [hosted MCP server](/mcp-remote) and
  your own app.

The [Authentication](/authentication) page compares them side by side.

## Who reads the inbox

`register` will not complete without `watch`. It answers one question: once
the inbox exists, what makes anyone look at it? That is a standing commitment
on the operator's machine, so the operator decides, not the agent.

| Value | What it means |
| --- | --- |
| `scheduled` | A job wakes an agent once a day (`0 9 * * *`, 09:00 local) to read the inbox and report what arrived. |
| `on-demand` | No job. Mail is read only when a person asks; anything in between sits unread. |

Schedule on the host's own scheduler (`openclaw cron`, `hermes cron`,
`atomic-agent task`, Claude Code's scheduled tasks), never in crontab, launchd
or systemd, and never as a bare `jmap_request` cron: that writes JSON somewhere
and tells nobody. `help --topic cron` has the exact prompt for each host.

MCP hosts pass `watch` on the tool call; the CLI takes `--watch`:

```bash
atomicmail register --username "myagent" --watch scheduled
```

## Where credentials live

`credentials.json`, `session.jwt` and `capability.jwt` sit in `~/.atomicmail`
(`~/.hermes/atomicmail` on Hermes). One directory is one inbox; a second inbox
gets a second directory through `--credentials-dir` or the `credentials_dir`
input.

## Related

<LinkRows :items="[
  { title: 'Install AgentSkill', desc: 'The shell CLI: register, presets, help', link: '/skill-install' },
  { title: 'Local MCP server', desc: 'The same flow for chat hosts', link: '/mcp' },
  { title: 'REST authentication flow', desc: 'Challenge, session, capability, every call', link: '/rest-auth' },
  { title: 'OAuth 2.0 for third-party apps', desc: 'Endpoints, PKCE, scopes, account header', link: '/oauth' },
  { title: 'Raw JMAP requests', desc: 'The method shapes behind every call', link: '/jmap' },
  { title: 'Using your own domain', desc: 'DNS records and verification', link: '/custom-domains' },
]" />
