# n8n integration

Atomic Mail ships a verified community node at `integrations/n8n/atomicmail/`.

## Quick start

From the repository root:

```bash
npm run build:n8n
cd integrations/n8n/atomicmail
npm install
npm run build
npm run dev
```

Open n8n at `http://localhost:5678`, add **Atomic Mail** or **Atomic Mail Trigger**, and configure credentials or run **Register**.

## Package

| Item | Value |
|------|-------|
| npm name | `@atomicmail/n8n-nodes-atomicmail` |
| Path | `integrations/n8n/atomicmail/` |
| Core vendor | `vendor/agentic-core/` (from `ts/build_n8n_wrapper.ts`) |
| Runtime deps | none |

## Operations (parity with Activepieces piece)

- **Register** — PoW signup, persists credentials in workflow static data
- **Help** — runtime docs (`overview`, `presets`, `cron`, …)
- **List Inbox** — inbox listing preset
- **Send Email** / **Reply** — outbound mail presets
- **JMAP Request** — inline ops or bundled preset
- **New Email trigger** — polling (~5 min default) with `receivedAt` watermark

## Verification before publish

```bash
cd integrations/n8n/atomicmail
npm run build
npm run lint
npx @n8n/scan-community-package @atomicmail/n8n-nodes-atomicmail
```

## Further reading

- [Package README](./atomicmail/README.md)
- [User guide](../../docs/n8n.md)
