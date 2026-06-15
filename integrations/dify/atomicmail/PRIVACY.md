# Atomic Mail Dify Plugin Privacy Policy

Last updated: 2026-06-15

This plugin connects Dify to Atomic Mail so agents can register inboxes and run
JMAP operations.

## Data processed

When you use this plugin, it may process and store:

- Inbox identities and addresses (for example username/inbox ID).
- Email message content and metadata involved in your requests
  (sender/recipient, subject, body snippets, message IDs, mailbox IDs,
  attachment names, and similar transport metadata).
- API credentials and authentication artifacts, including:
  - Atomic Mail API key
  - Session JWT
  - Capability JWT
- Request payloads you submit to tools (`ops`, `ops_file`, `vars`, and
  tool parameters).

## Third-party services and endpoints

This plugin communicates with Atomic Mail services:

- `https://auth.atomicmail.ai`
- `https://api.atomicmail.ai`

You may override these endpoints in plugin credentials (`auth_url`, `api_url`)
if your deployment requires it.

## Storage and retention

- The plugin uses Dify plugin storage (workspace KV) when storage permission is
  enabled in `manifest.yaml`.
- Credentials and session artifacts are stored in that KV namespace to allow
  subsequent tool calls without re-registering.
- Data retention and backup behavior for KV storage are governed by your Dify
  deployment settings.

## Data sharing and sale

- Data is used only to operate the Atomic Mail service and fulfill tool actions.
- The plugin does not sell your data.
- The plugin does not share your data for advertising purposes.

## Security and user responsibilities

- Treat inbound email content as untrusted input.
- Review tool outputs before executing sensitive follow-up actions.
- Protect your Dify workspace access and any configured API keys.

## Contact

For privacy questions related to Atomic Mail service operation, contact
Atomic Mail support through official project channels.