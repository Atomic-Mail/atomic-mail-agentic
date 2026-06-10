# Contributing to Atomic Mail Agentic

Thank you for your interest in contributing. Issues and pull requests are
welcome at
[github.com/Atomic-Mail/agentic-clients](https://github.com/Atomic-Mail/agentic-clients).

## What to contribute

- Bug fixes in the MCP server, AgentSkill CLI, or shared library under
  `ts/src/lib/`
- Documentation improvements in `docs/` or embedded `help` content under
  `ts/src/lib/agent/jmap/help-content/`
- JMAP presets, examples, and clearer error messages for agents
- Tests that lock in behavior you are changing or adding

Please open an issue first for large features or API changes so we can align on
scope before you invest heavily in a PR.

## Development setup

**Prerequisites**

- [Deno](https://deno.land/) 2.7+
- [Node.js](https://nodejs.org/) 20+ (for docs site and npm publish smoke
  checks)

```bash
git clone https://github.com/Atomic-Mail/agentic-clients.git
cd agentic-clients
```

Source code lives in `ts/`. Documentation site source is in `docs/` (VitePress).

```bash
# Preview docs locally
npm install
npm run docs:dev
```

## Running tests

All automated tests are Deno tests alongside the code they cover (`*.test.ts`
under `ts/src/`).

```bash
cd ts
deno test --allow-read --allow-env --allow-write
```

**New features and bug fixes should include tests.** Prefer unit tests with
mocked HTTP (see `ts/src/lib/agent/auth/agent-auth-http.test.ts`) over live
calls to `atomicmail.ai` unless the change is integration-only.

Run the full suite before opening a PR:

```bash
cd ts && deno test --allow-read --allow-env --allow-write
```

## Code conventions

- Match existing style in the file you edit (2-space indent, 80-column line
  width — see `ts/deno.json`).
- Format: `deno fmt` from `ts/`.
- Lint: `deno lint` from `ts/`.
- Keep changes focused. Separate unrelated fixes into different PRs when
  possible.
- Shared logic belongs in `ts/src/lib/`; MCP tools in `ts/src/mcp/`, AgentSkill
  CLI in `ts/src/skill/`.
- User-facing docs: update `docs/` when behavior changes; npm READMEs are
  generated from `docs/mcp.md` and `docs/skill-install.md` at publish time.
- Embedded agent docs: update `help` topics under
  `ts/src/lib/agent/jmap/help-content/` when CLI/MCP behavior changes.

## Building npm packages (maintainers)

```bash
cd ts
deno run -A build_mcp_npm.ts <version>    # -> ts/mcp_npm/
deno run -A build_skill_npm.ts <version>  # -> ts/skill_npm/
```

Omit `<version>` to use `ts/src/mcp/version.ts`. Manual QA checklists for
releases live in `test/checklists/`.

## Pull request checklist

- [ ] Tests pass (`deno test --allow-read --allow-env --allow-write` from `ts/`)
- [ ] New or changed behavior has test coverage
- [ ] `deno fmt` and `deno lint` are clean for touched files
- [ ] Docs and/or `help` content updated if user-visible behavior changed
- [ ] PR description explains **why** and how you verified the change

## Security

Do not commit credentials, API keys, or contents of `~/.atomicmail/`. If you
find a security issue, please report it privately rather than opening a public
issue with exploit details.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE) used by this project.
