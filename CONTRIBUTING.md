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

## Branching and pull requests

Open pull requests against the **`develop`** branch (the default integration
branch). `main` is reserved for stable releases.

```bash
git checkout develop
git pull origin develop
git checkout -b your-feature-branch
# ... make changes, commit ...
git push -u origin your-feature-branch
```

Then open a PR targeting **`develop`**, not `main`.

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
deno run -A build_all_npm.ts <version>    # default + all channel variants
deno run -A build_clawhub_skill.ts <version>  # -> integrations_dist/clawhub/atomicmail/
deno run -A build_hermes_skill.ts <version>   # -> integrations_dist/hermes/atomicmail/
```

`build_clawhub_skill.ts` and `build_hermes_skill.ts` require `skill_npm/` (run
`build_skill_npm.ts` or `build_all_npm.ts` first). CI publishes the built skill
via `.github/workflows/publish-clawhub-skill.yml` on GitHub release using
explicit semver (`clawhub skill publish --version <release>`), matching the git
tag.

Local ClawHub publish (maintainers, after building):

```bash
cd ts
deno run -A build_skill_npm.ts <version>
deno run -A build_clawhub_skill.ts <version>
clawhub skill publish ../integrations_dist/clawhub/atomicmail \
  --slug atomicmail \
  --name "Atomic Mail" \
  --version <version> \
  --owner atomicmail \
  --changelog "Release <version>"
```

### Hermes skill (maintainers)

Build output: `integrations_dist/hermes/atomicmail/` (gitignored). Published
copies land in `integrations/hermes/atomicmail/` for the in-repo tap (committed
to git — bootstrap once, then updated by CI).

CI workflow: `.github/workflows/publish-hermes-skill.yml` (on GitHub release,
push to `main`/`develop` when Hermes skill sources change, or `workflow_dispatch`).

Dry-run locally (build + verify only — same as CI `dry_run: true`):

```bash
cd ts
deno run -A build_skill_npm.ts <version>
deno run -A build_hermes_skill.ts <version>
deno test --allow-read --allow-env --allow-write --allow-run hermes_skill_build.test.ts
```

First CI run: trigger **Publish Hermes skill** manually with `dry_run: true` to
validate build and verify jobs before enabling real publishes.

No extra secrets are required — the workflow uses the default `GITHUB_TOKEN`
(`contents: write`) to commit the built skill to `integrations/hermes/atomicmail/`.

After publish, users can install from the in-repo tap:

```bash
hermes skills install Atomic-Mail/atomic-mail-agentic/integrations/hermes/atomicmail
```

The Hermes build ships a `.skillignore` and omits TypeScript declaration/source-map
artifacts so `hermes skills install` passes Hermes's community security scanner
(PoW registration, JWT parsing, and cron help docs otherwise trigger false positives).

GitHub Packages (`@atomic-mail/*` on `npm.pkg.github.com`):

```bash
cd ts
deno run -A build_github_packages_npm.ts <version>  # -> ts/mcp_npm_gpr/, ts/skill_npm_gpr/
deno run -A publish_github_packages_npm.ts          # publish built GPR dirs
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
