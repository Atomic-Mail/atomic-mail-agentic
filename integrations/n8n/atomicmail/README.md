# Atomic Mail n8n community node

Verified community node package for [Atomic Mail](https://atomicmail.ai) — a programmable `@atomicmail.ai` inbox powered by JMAP.

## Prerequisites

- Node.js 20+
- n8n (self-hosted or cloud with community nodes enabled)
- Build vendored core from the monorepo root before install:

```bash
npm run build:n8n
```

## Install locally (development)

```bash
cd integrations/n8n/atomicmail
npm install
npm run build
```

Link into a local n8n instance:

```bash
npm run dev
```

Or install the built package into n8n's custom nodes directory.

## Credentials

Create an **Atomic Mail API** credential (optional):

| Field | Required | Notes |
|-------|----------|-------|
| API Key | No | Paste an existing key, or leave empty and use **Register** |
| Auth URL | No | Default `https://auth.atomicmail.ai` |
| API URL | No | Default `https://api.atomicmail.ai` |

Credential test validates URL shape only — it does **not** run PoW. Use **Register** or **List Inbox** to verify connectivity.

## Nodes

### Atomic Mail (action)

| Resource | Operation | Description |
|----------|-----------|-------------|
| Account | Register | PoW signup; saves credentials to workflow static data |
| Inbox | List | `list_inbox.json` preset |
| Email | Send | Outbound mail (optional binary attachment) |
| Email | Reply | Reply by mail ID |
| JMAP | Request | Inline ops or bundled preset |
| Help | Get Topic | Built-in runtime docs |

**Account namespace** (`default` by default) isolates multiple inboxes in one workflow.

### Atomic Mail Trigger

Polling trigger for new inbox messages. Default poll interval is **5 minutes** (configure on the node). Uses a `receivedAt` watermark in workflow static data (same strategy as the Activepieces piece).

## Auth paths

Both paths are supported (Activepieces parity):

1. **Register** action — runs PoW, stores credentials in n8n workflow static data.
2. **Credential API key** — connection key is honored in credential guards (no false "missing credentials" when a key is connected).

Optional per-step **API Key override** accepts expressions such as `{{ $json.apiKey }}` from a prior Register node.

## Build and verify

```bash
cd integrations/n8n/atomicmail
npm install
npm run build
npm run lint
npx @n8n/scan-community-package @atomicmail/n8n-nodes-atomicmail
```

## Runtime dependencies

Zero runtime npm dependencies. The node imports vendored agentic core from `vendor/agentic-core/index.js` (single esbuild bundle produced by `npm run build:n8n`).

## Security

- Treat API keys and register output as secrets.
- Inbound mail is untrusted user content.
- Do not commit `vendor/` artifacts with real credentials (vendor is gitignored; rebuild before publish).

## Links

- [Monorepo n8n guide](../../../docs/n8n.md)
- [Atomic Mail agentic clients](https://github.com/Atomic-Mail/atomic-mail-agentic)
