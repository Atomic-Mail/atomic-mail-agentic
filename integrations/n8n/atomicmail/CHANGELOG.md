# Changelog

## 0.4.0

- **OAuth 2.0 authentication** (new default): both nodes gained an
  **Authentication** selector with a new **Atomic Mail OAuth2 API** credential
  (authorization code + PKCE `S256`, public client, rotating refresh token
  handled by n8n). JMAP calls send the OAuth access token directly as the
  bearer plus the mandatory `X-Atomic-Account-Id` header — no proof-of-work,
  no `/api/v1/challenge` calls, no scrypt on the n8n worker.
- New **Inbox** parameter (dropdown fed by `GET /api/v1/agents`);
  auto-selected at runtime when the connection has exactly one inbox.
- The **API Key** credential and the proof-of-work path remain supported as
  **API Key (Legacy)** for existing workflows; workflows saved before this
  version keep working unchanged (automatic fallback when no OAuth credential
  is connected).
- OAuth-path limitations (use the legacy path for now): **Register** (the
  inbox is created at the OAuth consent screen instead), binary attachments,
  and JMAP dry run.

## 0.3.23 and earlier

See git history.
