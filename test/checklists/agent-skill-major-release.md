# Major release QA — `@atomicmail/agent-skill`

CLI / AgentSkill entrypoint `atomicmail`. Derived from `docs/SKILL.md`, `docs/skill-install.md`, `docs/getting-started.md`, and shipped `atomicmail help` / CLI behavior. Where static docs lag the npm artifact (for example `--attachment` and `send_mail_blob_attachment.json`), still run those paths and file doc drift under §6.

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

- [ ] **Path A (documented):** `send_mail_attachment.json` with full `--vars` including base64 attachment fields (`docs/SKILL.md`).
- [ ] **Path B (RFC 8620 file upload):** `atomicmail jmap_request --ops-file send_mail_blob_attachment.json --attachment /path/to/file --vars '{"TO":"sasha@atomicmail.ai",...}'` (verify against `atomicmail jmap_request --help` on the release build).
- [ ] Confirm attachment arrives correctly at the recipient.

## 5. Read inbox messages (including attachments and validity)

- [ ] `atomicmail jmap_request --ops-file list_inbox.json`.
- [ ] Follow with `Email/get` / `Blob/get` or RFC 8620 download via expanded URLs (same logical steps as the MCP checklist; build `--ops` or a small local JSON file with `$BLOB_ID` in `--vars` if needed).
- [ ] Validate downloaded attachment bytes against the source file or a checksum.

## 6. Verify docs / `help` match what you did

- [ ] `atomicmail help` and `atomicmail help --topic readme` (`docs/SKILL.md`).
- [ ] Compare behavior and flags (`--auth-url`, `--api-url`, `--credentials-dir`, `--vars`, `--attachment`, `--attachment-path-base`, `--dry-run`) to `docs/skill-install.md` / `docs/SKILL.md`; file issues if static docs omit shipped flags or presets.

## 7. Extra examples (help, tokens, edge cases)

- [ ] **`help` usage:** `atomicmail help --topic jmap_cheatsheet` (and any other topics you ship).
- [ ] **Auto-renewal:** run multiple `jmap_request` invocations back-to-back; confirm no manual JWT handling (`docs/SKILL.md` security note: do not log tokens).
- [ ] **`--dry-run`:** run `jmap_request --dry-run` **without** `--attachment` and confirm resolved JSON only; confirm `--dry-run` **with** `--attachment` fails fast (incompatible: would upload blobs).
- [ ] **Relative attachment paths:** `--attachment-path-base` + relative `--attachment` paths.
- [ ] **Preset shadowing:** same test as MCP using a file in `--credentials-dir` named like a bundled preset (`docs/skill-install.md`).
