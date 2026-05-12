# Atomic Mail Agentic

This repository contains agentic mail MCP and AgentSkill. It also contains an
extensive set of documentation for MCP, AgentSkill, and direct REST/JMAP usage.

## Docs

- VitePress docs root: `docs/`
- Getting started: `docs/getting-started.md`
- MCP docs (also npm README source): `docs/mcp.md`
- AgentSkill docs (also npm README source): `docs/skill-install.md`
- AgentSkill spec (also npm SKILL source): `docs/SKILL.md`
- Direct API docs: [`docs/rest-auth.md`](docs/rest-auth.md), [`docs/jmap.md`](docs/jmap.md)

## Documentation vs published packages

Embedded **`help`** text and bundled presets ship with the npm package. Other
published documentation may describe newer behavior before a release; when in
doubt, trust the **`help`** output and presets from the same `npx` version you
are running.

## Building and publishing packages to npm

- install `deno 2.7+`
- `cd ts`
- `deno run -A build_mcp_npm.ts <version>`
- `cd mcp_npm`
- `npm publish`

(same for the AgentSkill)
