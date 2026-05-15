# Major release QA — `@atomicmail/mcp`

Stdio MCP server for chat-based agents. Derived from `docs/mcp.md`, `docs/getting-started.md`, and shipped `help` / tool behavior. Where static docs lag the npm artifact (for example `attachments` + `send_mail_blob_attachment.json`), still run those paths and file doc drift under §7.

**Prereqs:** Clean or disposable MCP host; shell access to create a temp directory.

**Per tester (do once at the start of the run — do not use `~/.atomicmail/`):**

- [ ] Create a dedicated credential directory for this run only, for example `CRED_DIR="$(mktemp -d)/atomicmail-mcp-qa"` and `mkdir -p "$CRED_DIR"`.
- [ ] Set `ATOMIC_MAIL_CREDENTIALS_DIR` to that path for **every** MCP tool call in this checklist (host `env` in MCP config, or export in the shell that spawns the host). Do not point at your personal/default credentials dir.
- [ ] Pick a random suffix (for example `RAND="$RANDOM"` or `date +%s`) and register username **`mcp-qa-<random-num>`** → mailbox **`mcp-qa-<random-num>@atomicmail.ai`**.
- [ ] For all outbound mail in this run, set **`SUBJECT`** to **`MCP QA TEST - <case name>`** (replace `<case name>` with the checklist step, e.g. `simple send`, `attachment path A`).

## 1. Install the client

- [ ] Configure the MCP host as in `docs/mcp.md` / `docs/getting-started.md`: `npx` with args `-y`, `@atomicmail/mcp` (pin or verify the **intended major** version in config if you version-gate releases).
- [ ] Set host `env` `ATOMIC_MAIL_CREDENTIALS_DIR` to your temp `CRED_DIR` (plus any other vars from `docs/mcp.md` you need: `ATOMIC_MAIL_AUTH_URL`, `ATOMIC_MAIL_API_URL`, etc.).
- [ ] Restart the host and confirm the `atomicmail` server starts without spawn errors.

## 2. Register a new account

- [ ] Call tool `register` with username **`mcp-qa-<random-num>`** (same suffix as above; PoW path per “Typical MCP workflow” in `docs/mcp.md`). Confirm the inbox is **`mcp-qa-<random-num>@atomicmail.ai`**.
- [ ] Confirm success response and that under **`$CRED_DIR`** (not `~/.atomicmail/`) you have `credentials.json`, `session.jwt`, and `capability.jwt` with mode `0600` (as documented).
- [ ] Call `register` again with the **same** username and confirm idempotent behavior (per tool table in `docs/mcp.md`).
- [ ] Call `register` with a **different** username and confirm it fails with guidance to back up credentials before creating a new account.
- [ ] Call `register` with that different username plus `forced: true` and confirm credentials are replaced and the new inbox is returned.

## 3. Send a simple email to `sasha@atomicmail.ai`

- [ ] Call `jmap_request` with `ops_file`: `send_mail.json` and `vars`: `TO` = `sasha@atomicmail.ai`, `SUBJECT` = **`MCP QA TEST - simple send`**, plus `BODY` (per “Presets and placeholders” in `docs/mcp.md`).
- [ ] Confirm HTTP success and JMAP `EmailSubmission/set` created a submission (inspect `methodResponses` or use your normal smoke assertion).
- [ ] Confirm the message is visible to the recipient (or your capture sink, for example Mailhog).

## 4. Send an email with an attachment to the same address

- [ ] **Path A (in-band `Blob/upload`):** `send_mail_attachment.json` with `vars` including `TO` = `sasha@atomicmail.ai`, `SUBJECT` = **`MCP QA TEST - attachment path A`**, `ATTACHMENT_BASE64`, `ATTACHMENT_TYPE`, `ATTACHMENT_NAME` (small payload). Confirm send succeeds; if `Blob/upload` returns `size: 0` for non-empty data, record as server/proxy defect (see troubleshooting in shipped `help`).
- [ ] **Path B (RFC 8620, recommended for large files):** `jmap_request` with `ops_file` `send_mail_blob_attachment.json`, `vars` for `TO` = `sasha@atomicmail.ai`, `SUBJECT` = **`MCP QA TEST - attachment path B`**, `BODY`, and tool input `attachments`: `[{ "path": "<local file>" }]` (and optional `filename` / `content_type`). Confirm upload + send succeeds.
- [ ] Confirm recipient receives the attachment with expected name and bytes.

## 5. Read inbox messages (including attachments and validity)

- [ ] `jmap_request` with `ops_file`: `list_inbox.json` (no extra `vars` per `docs/mcp.md`).
- [ ] Pick a message that should include an attachment; run a follow-up `jmap_request` with `Email/get` (properties including attachment metadata / `bodyStructure` as needed).
- [ ] Retrieve bytes: either **`Blob/get`** with `urn:ietf:params:jmap:blob` and minimal `properties` as in `docs/jmap.md`, **or** expand `$DOWNLOAD_URL` and `GET` with bearer capability JWT (RFC 8620 out-of-band path in `docs/jmap.md`).
- [ ] Base64-decode or compare downloaded bytes to a known fixture (checksum or byte equality).

## 6. SMTP to the QA inbox, then fetch with MCP

Exercises **inbound SMTP** into the **same** mailbox the MCP server uses for this run, then **read it back** via the `jmap_request` tool. Use when your stack exposes a plain SMTP listener (for example `<QA_SMTP_HOST>:25` with no auth).

- [ ] From `register` output or `credentials.json` on the MCP host, determine the full mailbox address for **RCPT TO** (typically `inboxId` + `@` + inbox domain for that deployment).
- [ ] Send via SMTP as if from another user (for example **curl** on the MCP host): `MAIL FROM` an unrelated address, `RCPT TO` that QA inbox (`mcp-qa-<random-num>@atomicmail.ai`), minimal RFC 5322 `DATA` with **Subject:** **`MCP QA TEST - SMTP inbound`**. Confirm the MTA accepts the message (for example `250` / queued id in the SMTP transcript).
- [ ] Call `jmap_request` with `ops_file`: `list_inbox.json` and confirm the new message appears (check **from**, **subject**, **preview**, or **receivedAt** in `methodResponses`).
- [ ] Follow with a second `jmap_request` using `Email/get` (and `Blob/get` on the text **blobId** if **bodyValues** is empty) to confirm the body matches what you injected. Note any header normalization (for example restricted characters in **Subject**) as environment-specific behavior.

## 7. Verify docs / `help` match what you did

- [ ] Call `help` (default topic) and confirm sections still describe `register`, `jmap_request`, presets, placeholders, attachments, and env vars consistently with `docs/mcp.md`.
- [ ] Call `help` with `topic: "readme"` and skim the published README for the same major version.
- [ ] Log any mismatch (for example missing `send_mail_blob_attachment.json` or `attachments` in static docs) as a **doc drift** issue to fix before or immediately after release.

## 8. Extra examples (help, tokens, edge cases)

- [ ] **`help` usage:** invoke `help` with at least one secondary topic (for example `jmap_cheatsheet` or `troubleshooting` if available) and confirm output is non-empty and accurate.
- [ ] **Session / capability token renewal:** run several `jmap_request` calls in a row (or one long run); per `docs/mcp.md` credential lifecycle, confirm repeated JMAP calls succeed without manual token handling. Optionally note `session.jwt` / `capability.jwt` mtime updates across calls.
- [ ] **Extended `using`:** send or read flows that require `urn:ietf:params:jmap:submission` and/or `urn:ietf:params:jmap:blob` (as in `docs/mcp.md` “Default `using`” note) and confirm behavior matches docs when `ops` is a bare `methodCalls` array vs full envelope.
- [ ] **Preset resolution:** place a deliberately wrong `list_inbox.json` in **`$CRED_DIR`** and confirm you get the documented “preset shadowing” failure mode; remove it and confirm bundled preset works again.
- [ ] **`vars` overrides:** set `INBOX` / `ACCOUNT_ID` in `vars` only if you have a reason to test overrides; confirm resolution order matches shipped `help` topic **`presets`** (`vars` first).

## 9. Cleanup

- [ ] Stop or restart the MCP host (or remove `ATOMIC_MAIL_CREDENTIALS_DIR` from host `env`) so it no longer points at the QA credential directory.
- [ ] Delete the temp credential tree from this run, for example `rm -rf "$(dirname "$CRED_DIR")"` (removes the `mktemp -d` parent created in the setup block, including `$CRED_DIR` and all JWTs / `credentials.json`).
