---
description: Run Atomic Mail agent inboxes on your own domain—dashboard verification, what changes for clients, $INBOX resolution, and the ATOMIC_MAIL_INBOX_DOMAIN override.
---

# Using your own domain

By default an inbox lives at `<name>@atomicmail.ai`. You can instead run agent
inboxes on a domain you control, so mail your agents send comes from
`support@yourcompany.com` rather than a shared provider domain.

Nothing about the client packages changes: the same `jmap_request` calls, the
same presets, the same JMAP method shapes. What changes is the address the
inbox answers to, and with it what `$INBOX` resolves to.

## Setting it up

Domain setup happens once, in [the dashboard](https://dashboard.atomicmail.ai),
under a human account. An agent cannot do it for itself: it needs DNS changes
on a domain you own, so there is no autonomous path the way there is for
proof-of-work signup on `@atomicmail.ai`.

<div class="steps">

### Add the domain

The dashboard gives you a `TXT` record proving you control it.

### Publish the DNS records

The ownership `TXT` record, plus the `MX` records that point inbound mail at
Atomic Mail. The dashboard shows the exact values; publish them at your DNS
provider.

### Verify

The dashboard re-checks DNS and reports each record as it lands. Propagation
is usually minutes, occasionally longer; verification is re-runnable, so a
not-yet-visible record is not a failure.

### Create inboxes on the domain

Once verified, new inboxes can be created on it. Each gets a full address
(`agent@yourcompany.com`) and an API key, both visible in the inbox's Connect
dialog.

</div>

Sending is signed for your domain, so recipients see a `From` that matches
the sending domain, which is what most receiving providers grade on.

## Connecting a client to a custom-domain inbox

The inbox already exists, so this is a login, not a signup. There is no
proof-of-work step and no username to choose.

**Local MCP or AgentSkill.** Log in with the inbox's API key:

```bash
atomicmail register --api-key "..." --watch scheduled
```

Or set it in the environment and let the client pick it up:

```json
{
  "mcpServers": {
    "atomicmail": {
      "command": "npx",
      "args": ["-y", "@atomicmail/mcp"],
      "env": { "ATOMIC_MAIL_API_KEY": "..." }
    }
  }
}
```

**Hosted MCP.** Connect over OAuth and pick the inbox, or send the same API
key as a bearer token for a one-step connect. See the
[hosted MCP server](/mcp-remote#one-step-connect-with-an-inbox-api-key).

**Raw HTTP.** Unchanged. The [REST auth](/rest-auth) chain and [JMAP](/jmap)
requests work as documented; to the API a custom-domain inbox is an ordinary
account.

## What `$INBOX` resolves to

`$INBOX` is the placeholder for the inbox's own address: in a `From` header,
in an `EmailSubmission/set` envelope, or when an agent mails itself.

It resolves to the account's real address. On a custom-domain inbox that
means `agent@yourcompany.com`, not `agent@atomicmail.ai`. The client reads it
from the JMAP session rather than reconstructing it from the stored username, so
this is automatic and needs no configuration.

That matters because the backend rejects a `From` that is not the inbox's real
address. If you hardcode `<name>@atomicmail.ai` in a preset or an ops file
instead of using `$INBOX`, a custom-domain inbox will fail submission with a
JMAP `forbiddenFrom` error. Use the placeholder.

Resolution order, most authoritative first:

1. A stored inbox id that already contains `@`, used verbatim.
2. The JMAP session's primary mail account id, when it is a real address whose
   local-part matches the stored inbox id. This is the normal case, and what
   makes custom domains work with no extra config.
3. The stored inbox id plus `ATOMIC_MAIL_INBOX_DOMAIN`.
4. The stored inbox id plus the default `atomicmail.ai`.

### `ATOMIC_MAIL_INBOX_DOMAIN`

The override for step 3: the domain appended to a bare inbox id when the
session cannot supply a full address. Set it when the client only ever sees a
local-part and you need self-addressing to land on your domain:

```bash
export ATOMIC_MAIL_INBOX_DOMAIN="yourcompany.com"
```

It is a fallback, not a forcing switch: a real address from the session wins
over it, and it is ignored entirely when the stored inbox id already carries a
domain. A leading `@` is tolerated (`@yourcompany.com` works). If mail is
already sending correctly you do not need this variable.

Available everywhere the other client env vars are: MCP `env` block,
AgentSkill shell environment, LangChain, and the Python layer.

## Related

<LinkRows :items="[
  { title: 'Agent flow', desc: 'The overall onboarding loop', link: '/getting-started' },
  { title: 'Hosted MCP server', desc: 'Hosted, OAuth or API-key connect', link: '/mcp-remote' },
  { title: 'Raw JMAP requests', desc: 'Placeholder substitution in context', link: '/jmap' },
  { title: 'REST authentication flow', desc: 'The HTTP chain behind API-key login', link: '/rest-auth' },
]" />
