---
description: Recommended onboarding flow for Atomic Mail—MCP or AgentSkill install, register, jmap_request, and links to HTTP docs.
---

# Getting Started

Atomic Mail gives agents a programmable inbox over JMAP. The recommended flow
is:

1. Install either MCP (chat agent hosts) or AgentSkill (shell-capable agents).
2. Run `register` once to create or recover an inbox. It takes a **required
   `watch` value** — see [Who reads the inbox](#who-reads-the-inbox-the-watch-value).
   If a different username is requested while credentials already exist,
   registration is refused; the error explains the safe way forward.
3. Use `jmap_request` for send/read flows.
4. Use `help` for built-in docs.

If wrappers are not usable in your environment, use the direct HTTP docs:
[`REST Auth`](/rest-auth) and [`Raw JMAP`](/jmap).

## Which authentication path?

Two exist, and they are for different situations:

- **[Proof of work](/rest-auth)** — an autonomous agent registers its **own**
  inbox. No human, no browser, no OAuth. This is what `register` does in every
  package on this site.
- **[OAuth 2.0](/oauth)** — a **human** authorizes an **application** to act on
  the inboxes they own. This is the path for Make, n8n via HTTP, Zapier, hosted
  connectors, and the [remote MCP server](/mcp-remote).

## Who reads the inbox — the `watch` value

`register` will not complete without `watch`. It is not a preference flag; it is
the answer to "once this inbox exists, what causes anyone to look at it?" — and
that is a standing commitment on the operator's machine, so **the operator
decides it, not the agent**. Ask; do not infer.

| Value | What it means |
| --- | --- |
| `scheduled` | A recurring job wakes an **agent** once a day (`0 9 * * *`, 09:00 local) to read the inbox and report what arrived. |
| `on-demand` | No such job. Mail is read only when a human asks, and anything arriving in between sits unread with nobody told. |

On `scheduled`, `register` prints the exact setup step for the runtime that
called it — with the credentials directory already filled in — and you run that.
Schedule on the **host's own scheduler** (`openclaw cron`, `hermes cron`,
`atomic-agent task`, Claude Code's `scheduled-tasks`), never at the OS level
(crontab, launchd, systemd), and never cron `jmap_request` on its own — that
writes JSON somewhere and tells nobody. Full detail: `help` topic `cron`.

MCP hosts pass it on the tool call; the CLI takes `--watch`:

```bash
atomicmail register --username "myagent" --watch on-demand
```

## Ideal agent flow

1. **Register**
   - Create account with PoW (`register --username <name> --watch <value>`) or
     recover via API key.
   - `watch` is required — see [above](#who-reads-the-inbox-the-watch-value).
   - Different username over existing credentials is refused; the error explains
     the safe path (a separate credential directory).
2. **Persist credentials**
   - `credentials.json`, `session.jwt`, `capability.jwt` under `~/.atomicmail`.
3. **Set up the daily inbox check (after register, on `watch: scheduled`)**
   - Native scheduler hosts: wake your **AI agent** once a day to fetch mail via
     `list_inbox.json` (OpenClaw, Hermes, atomic-agent, Claude Code).
   - No native scheduler: ask the operator to schedule it on a capable host, or
     remind manual fetch. Do not work around with OS schedulers or cross-platform
     scheduling. Do not cron `atomicmail jmap_request` alone. See
     [`SKILL.md`](/SKILL#inbox-checks-after-register),
     [`MCP`](/mcp#inbox-checks-after-register), or `help` topic `cron`.
4. **Execute JMAP**
   - Call `jmap_request` with inline `ops` or `ops_file`.
5. **Use placeholders**
   - Built-in: `$ACCOUNT_ID`, `$INBOX`, `$INBOX_MAILBOX_ID`, `$UPLOAD_URL`,
     `$DOWNLOAD_URL`
   - Custom: `$VAR_NAME` via `vars`/`--vars`.

## Install for chat-based agents (MCP)

Add to your MCP host configuration:

```json
{
   "mcpServers": {
      "atomicmail": {
         "command": "npx",
         "args": ["-y", "@atomicmail/mcp-gh-pages"]
      }
   }
}
```

Then call tools in this order: `register` -> `jmap_request` -> `help`. The
`register` call needs both a `username` and a `watch` value:

```json
{ "username": "myagent", "watch": "on-demand" }
```


Continue with full docs: [`MCP in-depth`](/mcp).

## Install for shell-capable agents (AgentSkill)

```bash
npx --package=@atomicmail/agent-skill-gh-pages atomicmail register --username "myagent" --watch on-demand
npx --package=@atomicmail/agent-skill-gh-pages atomicmail jmap_request --ops-file list_inbox.json
npx --package=@atomicmail/agent-skill-gh-pages atomicmail help
```

Continue with full docs: [`AgentSkill in-depth`](/skill-install) and
[`Skill spec`](/SKILL).

## Next sections

- [`Using your own domain`](/custom-domains)
- [`OAuth 2.0 for third-party apps`](/oauth)
- [`REST authentication (PoW)`](/rest-auth)
- [`Local MCP in-depth`](/mcp) · [`Remote MCP server`](/mcp-remote)
- [`AgentSkill in-depth`](/skill-install)
- Integrations: [`Make.com`](/make) · [`n8n`](/n8n) ·
  [`LangChain`](/langchain) · [`Dify`](/dify)
- [`Raw JMAP requests`](/jmap)
