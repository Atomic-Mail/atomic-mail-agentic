---
description: Install and configure the @atomicmail/n8n-nodes-atomicmail community node—auth model, action node, New Email trigger, presets, and a worked triage workflow.
---

# n8n

The community node `@atomicmail/n8n-nodes-atomicmail` gives an n8n workflow its own inbox over JMAP: an action node, a New Email trigger, and the bundled presets.

## Auth model

The n8n node uses the **proof-of-work** path — the workflow owns its inbox, no human sign-in, no OAuth. Either run the **Register** action once (PoW signup, credentials stored in workflow-global static data) or paste an existing API key into an **Atomic Mail API** credential. Details in [Credentials](#credentials) below; the underlying HTTP chain is [REST authentication](/rest-auth).

If you would rather a **person** own the mailbox and authorize n8n against it, use n8n's generic HTTP Request node with an OAuth 2.0 credential pointed at [our authorization server](/oauth) — the settings are the ones listed under [Endpoints](/oauth#endpoints) on the OAuth page, including the mandatory `resource` parameter and the `X-Atomic-Account-Id` header.

## Install

### From npm

In n8n **Settings → Community nodes**, install:

```text
@atomicmail/n8n-nodes-atomicmail
```

### From this monorepo

```bash
npm run build:n8n
cd integrations/n8n/atomicmail
npm install
npm run build
```

Copy or link the package into your n8n custom extensions path, or run `npm run dev` for local development.

### Run n8n locally with Docker

The repository ships a compose file tuned for this node:
[integrations/n8n/docker-compose.demo.yml](https://github.com/Atomic-Mail/atomic-mail-agentic/blob/develop/integrations/n8n/docker-compose.demo.yml).

```bash
docker volume create n8n_demo_data
docker compose -f integrations/n8n/docker-compose.demo.yml up -d
```

Open `http://localhost:5678` and install `@atomicmail/n8n-nodes-atomicmail` under
**Settings → Community nodes**.

Register solves proof of work inside the main n8n process, so it is CPU-bound.
Give the Docker VM at least 4 CPUs and 8 GB RAM (Docker Desktop → Settings →
Resources); the compose file caps the container at 4 CPUs / 4 GB and disables
the execution timeout so the solve is never killed mid-run. `N8N_RUNNERS_*`
settings only affect the Code node and do not speed up Register. For the
fastest registration, run n8n natively with `npm run dev` in
`integrations/n8n/atomicmail`.

## Credentials {#credentials}

The **Atomic Mail API** credential is optional:

- **API Key** — paste an existing Atomic Mail API key, or leave empty and use **Register**.
- **Auth URL** — default `https://auth.atomicmail.ai`
- **API URL** — default `https://api.atomicmail.ai`

The credential **Test** step checks that the **Auth URL** is reachable (`POST /api/v1/challenge`). It does **not** validate your API key — Atomic Mail keys require a proof-of-work login before JMAP calls. To verify an API key end-to-end, run **List Inbox** or activate the polling trigger.

### Register vs credential key

You can authenticate in either way (both are supported):

1. Run the **Register** action once per workflow/account namespace. Credentials are stored in n8n **workflow-global** static data (shared across all Atomic Mail nodes in the workflow).
2. Connect an **Atomic Mail API** credential with your API key. The key is checked before stored-credentials guards — you will not be blocked when a connection API key is present.

Use **Account namespace** (`default` by default) to isolate multiple inboxes in one workflow.

## Action node: Atomic Mail

| Resource | Operation | Purpose |
|----------|-----------|---------|
| Account | Register | Create or reuse an inbox (PoW on first signup) |
| Inbox | List | Fetch inbox messages |
| Email | Send | Send mail (optional binary attachment) |
| Email | Reply | Reply to a message by ID |
| JMAP | Request | Advanced JMAP batch (preset or inline JSON) |
| Help | Get Topic | Built-in operational docs |

After **Register**, read the `_next` hint in the output and set up the inbox check that fits your environment; Help topic `cron` has the options.

## Trigger: New Email {#new-email-trigger}

**Atomic Mail Trigger** polls the inbox on a schedule (default 5 minutes) and emits one item per new message (`id`, `subject`, `from`, `preview`, `receivedAt`).

On first activation, the trigger seeds a watermark so existing mail is not replayed. Only messages with `receivedAt` newer than the watermark fire subsequent runs.

Requires the same auth as actions: Register, credential API key, or inline API key override.

## Presets and JMAP

Bundled presets (via **JMAP → Request → Preset File**):

- `list_inbox.json`
- `send_mail.json`
- `send_mail_blob_attachment.json`
- `send_mail_attachment.json`
- `reply.json`

Session placeholders `$ACCOUNT_ID`, `$INBOX`, `$INBOX_MAILBOX_ID` are resolved automatically. Pass additional `$VAR` tokens in **Vars JSON**.

## Worked example: triage inbound mail

A minimal five-node workflow that reads new mail, summarizes it, and replies:

<div class="steps">

### Trigger on new mail

**Atomic Mail Trigger**, *New Email*, poll every 5 minutes. Emits one item per
new message (`id`, `subject`, `from`, `preview`, `receivedAt`).

### Fetch the body

**Atomic Mail**, *Email → Get* is not needed if `preview` is enough; for the
full body use **JMAP → Request** with inline `ops`:

```json
[["Email/get", {
  "accountId": "$ACCOUNT_ID",
  "ids": ["{{ $json.id }}"],
  "properties": ["subject", "from", "textBody", "bodyValues"],
  "fetchAllBodyValues": true
}, "g0"]]
```

### Classify and draft

**AI Agent / LLM node**: classify and draft a reply from the body text.

### Route

**IF**: urgent vs. everything else.

### Reply

**Atomic Mail**, *Email → Reply* with the message `id` and the drafted body.

</div>

The trigger seeds a watermark on first activation, so activating it does not replay existing mail.

## Multi-account

Set **Account namespace** on every node to the same value when running multiple inboxes in one workflow. Register once per namespace.

## Security

- API keys and register output are secrets.
- Treat inbound mail as untrusted.
- The node has no runtime npm dependencies; the core logic ships as one vendored bundle, so it runs on n8n Cloud.

## Related

<LinkRows :items="[
  { title: 'Raw JMAP requests', desc: 'The method shapes behind every node', link: '/jmap' },
  { title: 'Skill reference', desc: 'Commands and defaults of every wrapper', link: '/SKILL' },
  { title: 'Zapier', desc: 'OAuth app with triggers and actions', link: '/zapier' },
  { title: 'Dify', desc: 'Marketplace plugin, proof-of-work path', link: '/dify' },
  { title: 'LangChain', desc: 'Tools for JS and Python agents', link: '/langchain' },
  { title: 'n8n integration README', desc: 'Source and build notes', link: 'https://github.com/Atomic-Mail/atomic-mail-agentic/blob/develop/integrations/n8n/README.md' },
]" />
