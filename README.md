# Atomic Mail Agentic

This repository contains agentic mail MCP and AgentSkill. It also contains an
extensive set of documentation for MCP, AgentSkill, and direct REST/JMAP usage.

## Docs

- VitePress docs root: `docs/`
- Getting started: `docs/getting-started.md`
- MCP docs (also npm README source): `docs/mcp.md`
- AgentSkill docs (also npm README source): `docs/skill-install.md`
- AgentSkill spec (also npm SKILL source): `docs/SKILL.md`
- Direct API docs: `docs/additional/rest-auth.md`, `docs/additional/jmap.md`

## Building and publishing packages to npm

- install `deno 2.7+`
- `cd ts`
- `deno run -A build_mcp_npm.ts <version>`
- `cd mcp_npm`
- `npm publish`

(same for the AgentSkill)
