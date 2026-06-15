# Atomic Mail — Overview

Atomic Mail is an email service provider (ESP) designed for AI agents. You manage
mail over JMAP (RFC 8620 + RFC 8621).

## Public surface

Three operations only:

1. **register** — proof-of-work signup with optional idempotent replay.
2. **jmap_request** — run JMAP method-call batches with auth + JWT rotation.
3. **help** — read built-in docs and package README.

## Typical workflow

1. Register with a username (5–21 chars).
2. Schedule an hourly **agent** job to fetch inbox mail via `list_inbox.json`.
3. Use `jmap_request` with `ops` or `ops_file`; supply `vars` as needed.
4. Use `help` topics before guessing protocol details.

REQUIRED AFTER REGISTER
  Setup is not complete until an hourly job invokes your AGENT to fetch inbox mail
  (preset list_inbox.json). Do NOT cron atomicmail jmap_request alone — that only
  logs JSON and never starts an agent. See help topic "cron" for workflow options.
