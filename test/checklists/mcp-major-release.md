# Major release QA — `@atomicmail/mcp`

Stdio MCP server for chat-based agents. Derived from `docs/mcp.md`, `docs/getting-started.md`, and shipped `help` / tool behavior. Where static docs lag the npm artifact (for example `attachments` + `send_mail_blob_attachment.json`), still run those paths and file doc drift under §6.

**Prereqs:** Clean or disposable MCP host; optional isolated `ATOMIC_MAIL_CREDENTIALS_DIR` for the test run.

## 1. Install the client

- [ ] Configure the MCP host as in `docs/mcp.md` / `docs/getting-started.md`: `npx` with args `-y`, `@atomicmail/mcp` (pin or verify the **intended major** version in config if you version-gate releases).
- [ ] Restart the host and confirm the `atomicmail` server starts without spawn errors.
- [ ] (Optional) Set `env` from `docs/mcp.md` (`ATOMIC_MAIL_AUTH_URL`, `ATOMIC_MAIL_API_URL`, `ATOMIC_MAIL_CREDENTIALS_DIR`, etc.) and confirm the server still starts.

## 2. Register a new account

- [ ] Call tool `register` with a **new** username (PoW path per “Typical MCP workflow” in `docs/mcp.md`).
- [ ] Confirm success response and that under the credentials directory you have `credentials.json`, `session.jwt`, and `capability.jwt` with mode `0600` (as documented).
- [ ] Call `register` again with the **same** username and confirm idempotent behavior (per tool table in `docs/mcp.md`).

## 3. Send a simple email to `sasha@atomicmail.ai`

- [ ] Call `jmap_request` with `ops_file`: `send_mail.json` and `vars`: `TO` = `sasha@atomicmail.ai`, plus `SUBJECT` and `BODY` (per “Presets and placeholders” in `docs/mcp.md`).
- [ ] Confirm HTTP success and JMAP `EmailSubmission/set` created a submission (inspect `methodResponses` or use your normal smoke assertion).
- [ ] Confirm the message is visible to the recipient (or your capture sink, for example Mailhog).

## 4. Send an email with an attachment to the same address

- [ ] **Path A (in-band `Blob/upload`):** `send_mail_attachment.json` with `vars` including `ATTACHMENT_BASE64`, `ATTACHMENT_TYPE`, `ATTACHMENT_NAME` (small payload). Confirm send succeeds; if `Blob/upload` returns `size: 0` for non-empty data, record as server/proxy defect (see troubleshooting in shipped `help`).
- [ ] **Path B (RFC 8620, recommended for large files):** `jmap_request` with `ops_file` `send_mail_blob_attachment.json`, `vars` for `TO` / `SUBJECT` / `BODY`, and tool input `attachments`: `[{ "path": "<local file>" }]` (and optional `filename` / `content_type`). Confirm upload + send succeeds.
- [ ] Confirm recipient receives the attachment with expected name and bytes.

## 5. Read inbox messages (including attachments and validity)

- [ ] `jmap_request` with `ops_file`: `list_inbox.json` (no extra `vars` per `docs/mcp.md`).
- [ ] Pick a message that should include an attachment; run a follow-up `jmap_request` with `Email/get` (properties including attachment metadata / `bodyStructure` as needed).
- [ ] Retrieve bytes: either **`Blob/get`** with `urn:ietf:params:jmap:blob` and minimal `properties` as in `docs/jmap.md`, **or** expand `$DOWNLOAD_URL` and `GET` with bearer capability JWT (RFC 8620 out-of-band path in `docs/jmap.md`).
- [ ] Base64-decode or compare downloaded bytes to a known fixture (checksum or byte equality).

## 6. Verify docs / `help` match what you did

- [ ] Call `help` (default topic) and confirm sections still describe `register`, `jmap_request`, presets, placeholders, attachments, and env vars consistently with `docs/mcp.md`.
- [ ] Call `help` with `topic: "readme"` and skim the published README for the same major version.
- [ ] Log any mismatch (for example missing `send_mail_blob_attachment.json` or `attachments` in static docs) as a **doc drift** issue to fix before or immediately after release.

## 7. Extra examples (help, tokens, edge cases)

- [ ] **`help` usage:** invoke `help` with at least one secondary topic (for example `jmap_cheatsheet` or `troubleshooting` if available) and confirm output is non-empty and accurate.
- [ ] **Session / capability token renewal:** run several `jmap_request` calls in a row (or one long run); per `docs/mcp.md` credential lifecycle, confirm repeated JMAP calls succeed without manual token handling. Optionally note `session.jwt` / `capability.jwt` mtime updates across calls.
- [ ] **Extended `using`:** send or read flows that require `urn:ietf:params:jmap:submission` and/or `urn:ietf:params:jmap:blob` (as in `docs/mcp.md` “Default `using`” note) and confirm behavior matches docs when `ops` is a bare `methodCalls` array vs full envelope.
- [ ] **Preset resolution:** place a deliberately wrong `list_inbox.json` in the credentials directory and confirm you get the documented “preset shadowing” failure mode; remove it and confirm bundled preset works again.
- [ ] **`vars` overrides:** set `INBOX` / `ACCOUNT_ID` in `vars` only if you have a reason to test overrides; confirm resolution order matches shipped `help` topic **`presets`** (`vars` first).
