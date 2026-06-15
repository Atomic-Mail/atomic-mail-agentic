# Dify Integration

## Documentation layers

The Atomic Mail Dify plugin uses dual-layer docs:

- Human-facing localized descriptions in plugin/provider/tool YAML for workflow
  developers configuring nodes manually in the Dify UI.
- Short English LLM-facing hints (`description.llm`, `llm_description`) for
  agent tool selection and next-step nudges.
- Full runtime operational docs served by the `help` tool (topics like `cron`,
  `presets`, and `troubleshooting`).

## Prerequisites

Dify plugin development requires Python 3.12.

- Installed version on this machine: `Python 3.12.13`
- Installation method: Homebrew formula `python@3.12`
- Installed binary path: `/opt/homebrew/bin/python3.12`

### Installation command used

```bash
brew install python@3.12
```

### Verification commands

```bash
python3.12 --version
python3.12 -m pip --version
```

Expected output from this setup:

- `Python 3.12.13`
- `pip 26.1.2 from /opt/homebrew/lib/python3.12/site-packages/pip (python 3.12)`

### Optional project test verification

From `py/`, tests were validated with a Python 3.12 virtual environment:

```bash
python3.12 -m venv .venv312
.venv312/bin/python -m pip install pytest
.venv312/bin/python -m pytest
```

Result: `71 passed`.

## Dify CLI

Dify plugin scaffolding requires the `dify` CLI.

- Installed version on this machine: `v0.6.1`
- Installation method: Homebrew tap + formula `langgenius/dify`
- Installed via:

```bash
brew tap langgenius/dify
brew trust langgenius/dify
brew install dify
```

### Verification commands

```bash
dify version
dify plugin --help
```

Expected checks from this setup:

- `dify version` reports `v0.6.1`
- `dify plugin --help` lists plugin commands including `init` and `package`

## Distribution

Distribution is manual:

- On each GitHub release, `.github/workflows/publish-dify-plugin.yml` builds and
  attaches `atomicmail-<version>.difypkg` to the release artifacts.
- Marketplace publication is operator-driven; download the release artifact and
  open/update the `langgenius/dify-plugins` PR manually.

## Scaffold

The initial Dify tool plugin scaffold was created at
`integrations/dify/atomicmail/` using non-interactive init.

Created top-level files and directories:

- `manifest.yaml`
- `main.py`
- `requirements.txt`
- `.env.example`
- `provider/`
- `tools/`
- `_assets/`

### Start the scaffold locally

From the plugin directory, run the template entrypoint with Python 3.12:

```bash
cd integrations/dify/atomicmail
python3.12 -m main
```

## Phase 0 verification

Verification date: 2026-06-15

- Python version: `Python 3.12.13` (`/opt/homebrew/bin/python3.12`)
- Dify CLI version: `v0.6.1`
- Python SDK tests (`py/`): `71 passed`
- Plugin scaffold start/import:
  - `python3.12 -c "import main"` succeeds from `integrations/dify/atomicmail`
  - `python3.12 -m main` starts and emits plugin install + heartbeat events
  - No `ImportError` observed during startup/import verification

### Reproduce Phase 0 verification

```bash
# 1) Verify Python and Dify CLI versions
python3.12 --version
dify version

# 2) Verify py/ tests under Python 3.12
python3.12 -m venv py/.venv312
py/.venv312/bin/python -m pip install --upgrade pip pytest
py/.venv312/bin/python -m pytest py

# 3) Verify plugin scaffold import/start under Python 3.12
python3.12 -m venv integrations/dify/atomicmail/.venv312
integrations/dify/atomicmail/.venv312/bin/python -m pip install --upgrade pip
integrations/dify/atomicmail/.venv312/bin/python -m pip install -r integrations/dify/atomicmail/requirements.txt
cd integrations/dify/atomicmail
.venv312/bin/python3.12 -c "import main"
.venv312/bin/python3.12 -m main

# 4) Optional cleanup of temporary virtualenvs
cd /Users/sashavtyurin/Documents/projects/agentic-clients
rm -rf py/.venv312 integrations/dify/atomicmail/.venv312
```

## Phase 1 — project layout and build pipeline

Phase 1 adds vendoring for `shared/` and the Python SDK into the Dify plugin.

### Plugin layout additions

`integrations/dify/atomicmail/` now includes:

- `utils/__init__.py` (placeholder package for future integration utilities)
- `vendor/` (generated build output, ignored in git)
  - `vendor/shared/` (copied from repo-level `shared/`)
  - `vendor/atomicmail/` (copied from `py/src/atomicmail/`)

### Build command

Run from repo root:

```bash
cd ts
deno run -A build_dify_wrapper.ts
```

Optional release stamping:

```bash
cd ts
deno run -A build_dify_wrapper.ts 0.1.0
```

When a version argument is provided, the script stamps:

- `integrations/dify/atomicmail/manifest.yaml` top-level `version`
- `integrations/dify/atomicmail/manifest.yaml` `meta.version`

The script always:

- Rebuilds `integrations/dify/atomicmail/vendor/`
- Regenerates `integrations/dify/atomicmail/requirements.txt` with
  `dify_plugin>=0.5.0,<0.7.0`

### Runtime wiring

`integrations/dify/atomicmail/main.py` bootstraps vendored runtime paths before
plugin startup:

- Inserts `vendor/` into `sys.path` so `import atomicmail` resolves to vendored
  SDK code.
- Sets `ATOMIC_MAIL_SHARED_DIR` to `vendor/shared` (unless already set), so
  `atomicmail.shared_assets.shared_dir()` resolves vendored shared assets.

### Pre-run requirement

Before local run/package steps, build vendor assets first:

```bash
cd ts && deno run -A build_dify_wrapper.ts
```

Then run plugin setup/start as usual from `integrations/dify/atomicmail/`.

## Phase 1 verification

Verification date: 2026-06-15

- Build script run:
  - `cd ts && deno run -A build_dify_wrapper.ts` succeeds.
- Vendored file checks:
  - `integrations/dify/atomicmail/vendor/shared/presets/list_inbox.json` exists.
  - `integrations/dify/atomicmail/vendor/shared/help/topics/*.md` exists
    (multiple topics present).
  - `integrations/dify/atomicmail/vendor/atomicmail/__init__.py` exists.
- Python import + shared asset assertion (plugin directory with bootstrap-equivalent
  `sys.path`/`ATOMIC_MAIL_SHARED_DIR` setup):
  - `from atomicmail import register, jmap_request, help` succeeds.
  - `from atomicmail.shared_assets import shared_dir` succeeds.
  - `(shared_dir() / "presets/list_inbox.json").exists()` is `True`.
- Help smoke test:
  - `help(topic="presets")` returns non-empty text (`len == 269`).
- Plugin startup smoke:
  - Python 3.12 venv created in `integrations/dify/atomicmail/.venv312`.
  - `pip install -r requirements.txt` succeeds with `dify_plugin 0.6.2`.
  - `python -m main` starts briefly under venv with no `ImportError` /
    `ModuleNotFoundError`.

## Phase 2 — KV-backed credentials and tool split

Phase 2 moves Dify integration off temp-dir credential bridging and onto the
new `CredentialStore` abstraction:

- SDK entrypoints now support `store`:
  - `register(..., store=None)`
  - `jmap_request(..., store=None)`
- New SDK helper:
  - `create_agent_session(...)` for store-backed or filesystem-backed sessions
- Dify KV store implementation:
  - `utils/dify_kv_store.py` provides `DifyKvCredentialStore`
  - Keys:
    - `account:{account_id}:credentials.json`
    - `account:{account_id}:session.jwt`
    - `account:{account_id}:capability.jwt`
- Dify session wiring:
  - `utils/session_factory.py` builds sessions from runtime credentials +
    `self.session.storage`
- Provider credentials + validation:
  - `provider/atomicmail.yaml` now defines `credentials_schema`
    (`api_key`, `auth_url`, `api_url`)
  - `provider/atomicmail.py` validates by API-key login and persists artifacts
    into KV (`default` account namespace)
- Stub tool replaced with provider-parity tools:
  - `tools/register.*`
  - `tools/help.*`
  - `tools/list_inbox.*`
  - `tools/jmap_request.*`

## Phase 2 verification

Verification date: 2026-06-15

- SDK tests:
  - `cd py && .venv312/bin/python -m pytest`
  - Result: `80 passed`
- Vendor rebuild:
  - `npm run build:dify` succeeds and refreshes
    `integrations/dify/atomicmail/vendor/`
- Dify store unit tests:
  - `.venv312/bin/python -m pytest integrations/dify/atomicmail/tests`
  - Result: `3 passed`
- Plugin import/start smoke (`integrations/dify/atomicmail`):
  - `.venv312/bin/python -c "import main"` succeeds
  - `.venv312/bin/python -m main` starts and emits install + heartbeat events

## Phase 3 — send/reply tools, attachments bridge, invocation tests

Phase 3 completes the remaining Dify tool surface and test coverage:

- New tools:
  - `tools/send_mail.*` for preset-based outbound mail
  - `tools/reply.*` for replying by `mail_id`
- New Dify files bridge:
  - `utils/attachment_bridge.py` converts Dify `files` input into
    `jmap_request(..., attachments=[...])` payloads by writing uploaded blobs into
    temporary files and cleaning them up after invocation.
- Provider wiring:
  - `provider/atomicmail.yaml` now includes `tools/send_mail.yaml` and
    `tools/reply.yaml`.
- Tool invocation tests:
  - `integrations/dify/atomicmail/tests/test_attachment_bridge.py`
  - `integrations/dify/atomicmail/tests/test_tool_invoke.py`
  - Coverage includes var mapping, attachment path bridging + cleanup, account
    namespace store usage, input validation behavior, and error-path text messages.

## Phase 3 verification

Verification date: 2026-06-15

- Wrapper rebuild:
  - `npm run build:dify` not required for this phase because no `py/` SDK sources
    were modified.
- Full Python tests:
  - `cd py && .venv312/bin/python -m pytest`
  - Result: `90 passed`
- Dify plugin tests only:
  - `.venv312/bin/python -m pytest integrations/dify/atomicmail/tests`
  - Result: `13 passed`
- Plugin import smoke:
  - `cd integrations/dify/atomicmail && .venv312/bin/python -c "import main"`
  - Result: import succeeds and plugin install log is emitted.

## Phase 4 — release polish, i18n, docs, packaging, remote debug

Phase 4 focuses on release readiness and marketplace quality:

- Manifest/provider polish:
  - `integrations/dify/atomicmail/manifest.yaml`
    - Human-friendly localized label (`Atomic Mail`).
    - Localized descriptions for `en_US`, `zh_Hans`, `pt_BR`, `ja_JP`.
    - Runtime memory set to `67108864` (64 MB).
  - `integrations/dify/atomicmail/provider/atomicmail.yaml`
    - Localized provider identity label/description.
    - Localized credential labels/placeholders where user-facing.
- Tool i18n polish (all 6 tools):
  - `register`, `help`, `list_inbox`, `jmap_request`, `send_mail`, `reply`
  - Human-friendly localized labels instead of snake_case labels.
  - Localized `description.human`, parameter labels, and
    `human_description` fields for `zh_Hans`, `pt_BR`, and `ja_JP`.
  - LLM-facing text (`description.llm`, `llm_description`) kept in English.
- Privacy policy:
  - Replaced stub `integrations/dify/atomicmail/PRIVACY.md` with a
    marketplace-ready policy covering processed data, endpoints, KV storage,
    data sharing limits, and user safety responsibilities.
- Marketplace README:
  - Replaced `integrations/dify/atomicmail/README.md` with install/build,
    credentials, tool catalog, required hourly inbox polling guidance,
    multi-account notes, security, remote debug workflow, E2E checklist,
    and packaging commands.
- Remote debug helper file:
  - Expanded `.env.example` comments with clear field meaning and handling.

## Phase 4 verification

Verification date: 2026-06-15

- Build and vendor refresh:
  - `cd /Users/sashavtyurin/Documents/projects/agentic-clients`
  - `npm run build:dify`
- Dify plugin packaging:
  - `dify plugin package integrations/dify/atomicmail`
  - Expected output: `.difypkg` artifact in
    `integrations/dify/atomicmail/`.
- Regression test run (plugin tests):
  - `.venv312/bin/python -m pytest integrations/dify/atomicmail/tests`
  - Expectation: all tests pass (13 tests).
- Optional full Python SDK regression:
  - `cd py && .venv312/bin/python -m pytest`

### Reproduce Phase 4 verification

```bash
cd /Users/sashavtyurin/Documents/projects/agentic-clients

# 1) Build Dify wrapper/vendor payload
npm run build:dify

# 2) Package plugin for install/distribution
dify plugin package integrations/dify/atomicmail

# 3) Plugin tests (regression)
.venv312/bin/python -m pytest integrations/dify/atomicmail/tests

# 4) Optional full Python SDK tests
cd py
.venv312/bin/python -m pytest
```

## Phase 5 - remote debugging against Dify cloud

Phase 5 configures and validates remote debug runtime wiring for the Dify plugin:

- Created local plugin runtime env file:
  - `integrations/dify/atomicmail/.env`
  - `INSTALL_METHOD=remote`
  - `REMOTE_INSTALL_URL=debug.dify.ai:5003`
  - `REMOTE_INSTALL_KEY=<provided-by-operator>`
- Confirmed secret handling:
  - `.env` is ignored by `integrations/dify/atomicmail/.gitignore`.
  - Remote install key is not written to committed docs.
- Rebuilt plugin wrapper payload before runtime testing:
  - `npm run build:dify`
- Revalidated plugin runtime dependencies in plugin venv:
  - `integrations/dify/atomicmail/.venv312/bin/python -m pip install -r requirements.txt`
- Started plugin runtime in remote mode:
  - `cd integrations/dify/atomicmail`
  - `.venv312/bin/python -m main`
- Verified remote debug gateway connectivity using the same Dify SDK TCP
  reader/writer class used by plugin runtime:
  - Host: `debug.dify.ai`
  - Port: `5003`
  - Connection state: `tcp_connected=True`

## Phase 5 verification

Verification date: 2026-06-15

- `.env` setup:
  - `integrations/dify/atomicmail/.env` exists with remote install mode and
    debug gateway URL.
  - `.env` remains gitignored.
- Build prerequisite:
  - `npm run build:dify` succeeds.
- Runtime start:
  - `python -m main` starts successfully and emits install log
    (`Installed tool: atomicmail`).
  - No startup crash or remote configuration exception observed.
- Remote connectivity:
  - Direct SDK-level remote debug socket launch to `debug.dify.ai:5003`
    succeeds (`tcp_connected=True`) using configured `.env` values.
- E2E debug checklist status:
  - Plugin runtime remote connection: **verified from local environment**.
  - Dify Agent/Workflow UI execution scenarios: **manual verification pending**
    (requires workspace interaction in Dify cloud UI).

### Manual operator steps (Dify UI)

1. Open Dify cloud workspace plugin debug view for Atomic Mail and confirm the
   runtime instance appears active (debug badge/online state).
2. Configure provider credentials:
   - Either set `api_key` in provider settings, or invoke `register` tool once.
3. Agent E2E:
   - In an Agent app, ask: `check my inbox`.
   - Confirm tool selection uses `list_inbox` and returns message summary.
4. Workflow E2E:
   - Add `send_mail` tool node with form inputs (`to`, `subject`, `text`).
   - Execute workflow and verify success response.
5. KV persistence:
   - Restart local plugin runtime (`python -m main`).
   - Re-run `list_inbox` for same `account_id`; verify it works without
     re-registering.

## Phase 5 E2E verification (executor path + operator UI)

Verification date: 2026-06-15

- Research outcome:
  - No Dify MCP server is available in this Cursor workspace for plugin-tool
    invocation.
  - Dify public docs route execution through app runtime (Workflow/Chatflow/
    Agent) and published app APIs; there is no separate documented public
    endpoint to invoke a plugin tool directly without an app.
  - Remote debug mode routes Dify cloud plugin invocations into the local
    `python -m main` process.
- Added live executor verification script:
  - `integrations/dify/atomicmail/scripts/live_invoke_verify.py`
  - Bootstraps vendored runtime the same way as `main.py`.
  - Uses `PluginRegistration` + `PluginExecutor` + `ToolInvokeRequest` to invoke
    Atomic Mail tools through the same Dify executor code path used in runtime.
  - Uses an in-memory KV store compatible with `DifyKvCredentialStore`.
  - Steps executed by script:
    1) `help` (`topic=presets`) -> non-empty text assertion
    2) `register` with unique disposable username (retry once on username/rate
       issues)
    3) `list_inbox` in same `account_id` namespace -> JSON response assertion
    4) `help` (`topic=cron`) -> non-empty text assertion
  - Script exits `0` only when all assertions pass.
- Added operator UI walkthrough:
  - `integrations/dify/atomicmail/GUIDE_UI.md`
  - Includes two explicit paths:
    - Path 1: blank Workflow quick tool test (`Start -> Tool -> End`)
    - Path 2: Agent app inbox check (`register`, `list_inbox`, `help`)
  - Includes concrete success checks in Dify UI and expected local terminal
    activity indicators.

### Commands executed

```bash
cd /Users/sashavtyurin/Documents/projects/agentic-clients
npm run build:dify
integrations/dify/atomicmail/.venv312/bin/python integrations/dify/atomicmail/scripts/live_invoke_verify.py
```

### Live script result snapshot

- Registered inbox: `difytestz6i8wj`
- Storage namespace: `phase5-e2e`
- Step results:
  - PASS `help(presets)`
  - PASS `register(unique username)`
  - PASS `list_inbox(same account)`
  - PASS `help(cron)`
- Overall result: `PASS` (exit code `0`)

### Remote debug terminal status note

- Existing plugin process remains running in terminal 1 with active command
  `.venv312/bin/python -m main`.
- Log contains startup line `Installed tool: atomicmail`; no additional Dify UI
  invocation lines were captured during this CLI-side verification run.

## Phase 6 - automated tests

Phase 6 completes automated coverage for the Dify plugin and keeps SDK parity in CI:

- Plugin test suite expanded:
  - Added shared test bootstrap and fake storage in
    `integrations/dify/atomicmail/tests/conftest.py`.
  - Extended KV credential tests with multi-account keyspace isolation in
    `integrations/dify/atomicmail/tests/test_dify_kv_store.py`.
  - Expanded tool validation tests in
    `integrations/dify/atomicmail/tests/test_tool_invoke.py` for
    `ops`/`ops_file` types, `dry_run` type, and malformed `vars` JSON.
  - Added provider credential validation tests in
    `integrations/dify/atomicmail/tests/test_provider_validate.py` to verify:
    - API-key-optional path (no login attempt).
    - Login path with trimmed credentials and default account KV namespace.
    - Error wrapping into Dify credential validation error type.
- Live verification script extended:
  - `integrations/dify/atomicmail/scripts/live_invoke_verify.py` now covers:
    1) `help(presets)` from vendored shared assets
    2) `register` with retry
    3) `list_inbox` before send
    4) `send_mail` to registered inbox
    5) `list_inbox` after send
    6) `reply` when a message id is discoverable (skip gracefully otherwise)
    7) `help(cron)`
  - Added offline mode for CI/manual dry runs:
    - `--skip-network`, or
    - `ATOMIC_MAIL_LIVE_E2E=0`
- Added CI workflow:
  - `.github/workflows/test-dify-plugin.yml`
  - Triggers on changes in `integrations/dify/**`, `py/**`, `shared/**`,
    and `ts/build_dify_wrapper.ts`.
  - Runs `npm run build:dify`, plugin pytest, and `py/` parity pytest.

### Run tests locally

From repo root:

```bash
npm run build:dify
python3.12 -m pip install -r integrations/dify/atomicmail/requirements.txt
python3.12 -m pip install pytest
python3.12 -m pytest integrations/dify/atomicmail/tests
cd py && python3.12 -m pytest
```

If you prefer virtualenv isolation:

```bash
python3.12 -m venv integrations/dify/atomicmail/.venv312
integrations/dify/atomicmail/.venv312/bin/python -m pip install --upgrade pip
integrations/dify/atomicmail/.venv312/bin/python -m pip install -r integrations/dify/atomicmail/requirements.txt pytest
integrations/dify/atomicmail/.venv312/bin/python -m pytest integrations/dify/atomicmail/tests
cd py && ../integrations/dify/atomicmail/.venv312/bin/python -m pytest
```

### Optional live E2E verification

Live script requires network access and a real Atomic Mail registration flow:

```bash
integrations/dify/atomicmail/.venv312/bin/python integrations/dify/atomicmail/scripts/live_invoke_verify.py
```

Offline-only mode (no register/JMAP network calls):

```bash
integrations/dify/atomicmail/.venv312/bin/python integrations/dify/atomicmail/scripts/live_invoke_verify.py --skip-network
# or
ATOMIC_MAIL_LIVE_E2E=0 integrations/dify/atomicmail/.venv312/bin/python integrations/dify/atomicmail/scripts/live_invoke_verify.py
```

## Phase 6 verification

Verification date: 2026-06-15

- Build prerequisite:
  - `npm run build:dify`
- Plugin unit tests:
  - `integrations/dify/atomicmail/.venv312/bin/python -m pytest integrations/dify/atomicmail/tests`
- SDK parity tests:
  - `cd py && ../integrations/dify/atomicmail/.venv312/bin/python -m pytest`
- Optional live plugin runtime e2e:
  - `integrations/dify/atomicmail/.venv312/bin/python integrations/dify/atomicmail/scripts/live_invoke_verify.py`
  - Use `--skip-network` (or `ATOMIC_MAIL_LIVE_E2E=0`) when running offline.

