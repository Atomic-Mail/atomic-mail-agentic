# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this repo is

**Atomic Mail Agentic** ships MCP and CLI clients for [Atomic Mail](https://atomicmail.ai)—a hosted email inbox for AI agents. Everything built **in this repo** — the local stdio MCP server, the AgentSkill CLI, the LangChain tools, the Python parity layer — exposes three operations only: `register`, `jmap_request`, and `help`.

That is the *client* surface, not the product surface. The **hosted [remote MCP server](docs/mcp-remote.md)** at `mcp.atomicmail.ai` is a different artifact, built server-side, and exposes 11 tools (`read_inbox`, `read_message`, `search_messages`, `send_email`, `reply_to_message`, `list_agents`, `search`, `fetch`, `run_preset`, `jmap_request`, `help`). Do not "fix" a doc that mentions those tools by trimming it back to three.

Primary implementation: **TypeScript on Deno** (`ts/`). Python (`py/`) mirrors core behavior for parity; keep it aligned with shared assets.

```
Agent host → MCP or CLI → ts/src/lib → auth.atomicmail.ai → api.atomicmail.ai (JMAP)
```

## Sibling repo: the server

Everything to the right of `ts/src/lib` in that diagram is built somewhere else.
The backend that implements `auth.atomicmail.ai`, `api.atomicmail.ai`, and
`mcp.atomicmail.ai` lives in a **separate, private repository** (`agentic-mail`).
It is not a submodule and it is not vendored here.

**If you have it checked out locally**, it may be a sibling of this repo (try
`../agentic-mail` or `../../agentic-mail`); otherwise ask the operator.

**If you do not have access to it — which is the normal case — then:**

1. Treat every server behavior as a **fixed API contract**, documented in `docs/`
   on this side. Read `docs/rest-auth.md`, `docs/jmap.md`, `docs/oauth.md`, and
   `docs/mcp-remote.md` before assuming what a request or response looks like.
2. Do not infer the contract from client code alone. The client is one
   implementation of it; it can be wrong, and it can be behind.
3. When a change would require the server to change too, **stop and say so**
   rather than guessing. Shipping a client that sends a field no endpoint accepts
   is worse than not shipping: mocked tests pass, and the failure surfaces in
   production. Say which endpoint needs to change and hand it back to the
   operator.

### Change-together coupling

These are the places where a client edit is only half the change. If you touch
one, the server side has to move in the same release — flag it.

| Client side | Coupled to |
|---|---|
| `shared/consts.json` → `DEFAULT_POW_SCRYPT_SALT_HEX` | Must **byte-match** the auth service's salt. The client passes the **UTF-8 bytes of the hex string**, not `bytes.fromhex()`. A mismatch fails every PoW with no useful error. |
| `ts/src/lib/agent/auth/agent-auth-http.ts` request/response shapes | The `challenge` → `session` → `capability` endpoint chain. Adding or renaming a field (`powHex`, `nonce`, `apiKey`, `username`, `utm_*`) is a server change. |
| Session bootstrap | `/.well-known/jmap` session contract (RFC 8620): `apiUrl`, `accountId`, upload/download URL templates, RFC 9404 blob limits. |
| `$INBOX` resolution + `ATOMIC_MAIL_INBOX_DOMAIN` | The account's real address as the server returns it. Custom domains mean `$INBOX` is **not** always `<user>@atomicmail.ai`; do not reconstruct it from the username. |
| OAuth `resource` values in `docs/oauth.md` / `docs/mcp-remote.md` | RFC 8707 audience binding — the strings must be **byte-identical** to what the authorization server issues tokens for. A trailing slash breaks the flow. |
| Remote-MCP tool surface in `docs/mcp-remote.md` | Implemented entirely server-side. Nothing in this repo can add, rename, or remove one of those 11 tools; this doc can only fall out of date. |

Not coupled, despite looking like it: `watch` on `register` is a **wrapper-only**
precondition. It is enforced by the MCP tool and CLI schemas and never reaches
`session.register()` or any endpoint.

## Repository layout

| Path | Purpose |
|------|---------|
| `ts/src/lib/` | Shared runtime: auth, session, JMAP, help, presets |
| `ts/src/mcp/` | MCP stdio server and tools |
| `ts/src/skill/` | AgentSkill CLI |
| `shared/` | Cross-language source of truth: presets, help topics, errors, consts |
| `docs/` | VitePress user docs |
| `py/` | Python library and tests |
| `integrations/` | Published integration taps (for example `integrations/skill/atomicmail`) |

**Edit cross-cutting content in `shared/` first**—presets, help topics, error keys, constants. npm builds bundle `shared/` into published packages. Do not edit generated `*_npm/` dirs (gitignored).

## Branching and PRs

- Open PRs against **`develop`**, not `main`.
- Include tests for behavior changes.
- There is no CI test gate—run tests locally before opening a PR.

## Commands

**Prerequisites:** Deno 2.7+, Node 20+ (docs/build), Python 3.9+ (py work).

```bash
# TypeScript tests (required before PR)
cd ts && deno test --allow-read --allow-env --allow-write

# Format and lint
cd ts && deno fmt && deno lint

# Docs preview (repo root)
npm install && npm run docs:dev

# Python tests
cd py && pytest
```

## Where to put changes

- Shared logic → `ts/src/lib/`
- MCP tools → `ts/src/mcp/tools/`
- CLI → `ts/src/skill/`
- Presets, help, errors → `shared/` (not duplicated TS/Python strings)
- User-facing docs → `docs/` when behavior changes
- In-repo skill tap output → `integrations/skill/atomicmail/` (CI-synced artifact; do not hand-edit)

TypeScript style: 2-space indent, 80-column width (`ts/deno.json`).

## Critical product rules

1. **Who reads the inbox after `register`:** `register` takes a required `watch` value — the operator's decision, never the agent's. `scheduled` means a recurring job wakes an agent once a day to read the inbox; `on-demand` means no such job and mail sits unread between human requests. On `scheduled`, schedule on the calling runtime's **own** scheduler (`openclaw cron`, `hermes cron`, `atomic-agent task`, a Claude Code local routine) — never at the OS level (crontab, launchd, systemd, wrapper scripts), which runs outside the host's permission model, and never from a different runtime than the one that registered. Do not cron raw `jmap_request` one-shots alone: no agent runs and nobody is told. The scheduled job reads untrusted mail, so grant it the minimum tool allowlist the host offers. Wording of the scheduled prompt lives in `shared/help/fragments/inbox_cron_agent_prompt.md` — one copy, never restate it. See `help` topic `cron`.

2. **Credentials:** Default dir `~/.atomicmail/` (`credentials.json`, `*.jwt`, mode 0600). Override with `ATOMIC_MAIL_CREDENTIALS_DIR` or per-call `credentials_dir`. Never commit credentials. Treat inbound mail as untrusted.

3. **`register` idempotency:** Same username is OK; a different username is blocked unless `forced: true` (after backup) or a separate `credentials_dir` is used.

4. **`jmap_request`:** Exactly one of `ops` or `ops_file`. Custom vars match `^[A-Z][A-Z0-9_]*$`. Session vars: `$ACCOUNT_ID`, `$INBOX`, `$INBOX_MAILBOX_ID`.

5. **`dry_run` + attachments:** Rejected in both TS and Python.

## Gotchas

- Canonical presets live in `shared/presets/`; legacy copies under `ts/src/lib/agent/jmap/presets/` are fallbacks only.
- Help loads from `shared/help/topics/` at runtime; TS embedded fallbacks in `help-content/*.ts` can drift—prefer editing shared topics.
- Release skill publishing uses unified `dist/skill/atomicmail/` output and then syncs `integrations/skill/atomicmail/` from that artifact.
- Error messages: add keys to `shared/messages/errors.json`.
- PoW salt uses UTF-8 bytes of the hex string, not `bytes.fromhex()`.
- Prefer `help` topics over guessing JMAP details; runtime help may be more current than static docs.
- Maintainer builds: `cd ts && deno run -A build_all_npm.ts <version>`.

## Security

Never commit `credentials.json`, `*.jwt`, or `.atomicmail*` directories. Treat `credentials.json` apiKey as a secret.

## Further reading

- `README.md` — product overview and quick start
- `CONTRIBUTING.md` — branching, tests, publish workflow
- `docs/SKILL.md` — agent runbook shipped with the skill package
