# Major release QA — `@atomicmail/agent-skill`

CLI / AgentSkill entrypoint `atomicmail`. Derived from `docs/SKILL.md`, `docs/skill-install.md`, `docs/getting-started.md`, and shipped `atomicmail help` / CLI behavior. Where static docs lag the npm artifact (for example `--attachment` and `send_mail_blob_attachment.json`), still run those paths and file doc drift under §7.

**Prereqs:** Shell with network; same optional isolated `ATOMIC_MAIL_CREDENTIALS_DIR` or `--credentials-dir`.

## 1. Install the client

- [ ] Run `npx --package=@atomicmail/agent-skill atomicmail --help` (`docs/skill-install.md` / `docs/SKILL.md`) and confirm the binary resolves and prints usage for `register`, `jmap_request`, `help`.
- [ ] Confirm the resolved package version matches the **intended major** release.

## 2. Register a new account

- [ ] `atomicmail register --username "<new unique name>"` (`docs/SKILL.md` / `docs/skill-install.md`).
- [ ] Confirm JSON output includes inbox / account identifiers as documented.
- [ ] Confirm `credentials.json`, `session.jwt`, `capability.jwt` exist under the credentials dir with `0600`.
- [ ] (Optional) Repeat `register --api-key "..."` recovery path from `docs/SKILL.md` on a copy of credentials.

## 3. Send a simple email to `sasha@atomicmail.ai`

- [ ] `atomicmail jmap_request --ops-file send_mail.json --vars '{"TO":"sasha@atomicmail.ai","SUBJECT":"...","BODY":"..."}'` (`docs/SKILL.md`).
- [ ] Confirm exit code 0 and successful submission in the JMAP response body.

## 4. Send an email with an attachment to the same address

- [ ] **Path A (documented):** `send_mail_attachment.json` with full `--vars` including base64 attachment fields (`docs/SKILL.md` example; `Blob/upload` rules in shipped `help --topic jmap_cheatsheet`).
- [ ] **Path B (RFC 8620 file upload):** `atomicmail jmap_request --ops-file send_mail_blob_attachment.json --attachment /path/to/file --vars '{"TO":"sasha@atomicmail.ai",...}'` (verify against `atomicmail jmap_request --help` on the release build).
- [ ] Confirm attachment arrives correctly at the recipient.

## 5. Read inbox messages (including attachments and validity)

- [ ] `atomicmail jmap_request --ops-file list_inbox.json`.
- [ ] Follow with `Email/get` / `Blob/get` or RFC 8620 download via expanded URLs (same logical steps as the MCP checklist; build `--ops` or a small local JSON file with `$BLOB_ID` in `--vars` if needed).
- [ ] Validate downloaded attachment bytes against the source file or a checksum.

## 6. SMTP to the QA inbox, then fetch with the skill

Exercises **inbound SMTP** (no JMAP on the send path) into the **same** mailbox you registered for this run, then **read it back** over JMAP with `atomicmail`. Use when your stack exposes a plain SMTP listener (for example Haraka on `<QA_SMTP_HOST>:25` with no auth).

- [ ] From `register` / `credentials.json`, determine the full mailbox address for **RCPT TO** (typically `inboxId` + `@` + inbox domain for that deployment).
- [ ] Send via SMTP as if from another user (for example **curl**): `MAIL FROM` an unrelated address, `RCPT TO` that QA inbox, minimal RFC 5322 `DATA` (Subject + plain body). Confirm the MTA accepts the message (for example `250` / queued id in the SMTP transcript).
- [ ] `atomicmail jmap_request --ops-file list_inbox.json` (same `--credentials-dir` / env as the rest of the run) and confirm the new message appears (check **from**, **subject**, **preview**, or **receivedAt**).
- [ ] Follow with `Email/get` and, if needed, `Blob/get` on the text part **blobId** to confirm the body matches what you injected. Note any header normalization (for example restricted characters in **Subject**) as environment-specific behavior.

## 7. Verify docs / `help` match what you did

- [ ] `atomicmail help` and `atomicmail help --topic readme` (`docs/SKILL.md`).
- [ ] Compare behavior and flags (`--auth-url`, `--api-url`, `--credentials-dir`, `--vars`, `--attachment`, `--attachment-path-base`, `--dry-run`) to `docs/skill-install.md`, `docs/SKILL.md`, and `docs/mcp.md` (MCP parity); file issues if static docs omit shipped flags or presets.

## 8. Extra examples (help, tokens, edge cases)

- [ ] **`help` usage:** `atomicmail help --topic jmap_cheatsheet` (and any other topics you ship).
- [ ] **Auto-renewal:** run multiple `jmap_request` invocations back-to-back; confirm no manual JWT handling (`docs/SKILL.md` security note: do not log tokens).
- [ ] **`--dry-run`:** run `jmap_request --dry-run` **without** `--attachment` and confirm resolved JSON only; confirm `--dry-run` **with** `--attachment` fails fast (incompatible: would upload blobs).
- [ ] **Relative attachment paths:** `--attachment-path-base` + relative `--attachment` paths.
- [ ] **Preset shadowing:** same test as MCP using a file in `--credentials-dir` named like a bundled preset (`docs/mcp.md`).
