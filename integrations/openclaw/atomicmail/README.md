# Atomic Mail for OpenClaw

This package is a thin OpenClaw/ClawHub wrapper for the real Atomic Mail MCP
runtime: `@atomicmail/mcp-clawhub`.

## Intent

ClawHub publishes plugin/package artifacts rather than raw MCP registry entries.
This wrapper gives Atomic Mail a ClawHub-friendly package while leaving the
actual MCP server implementation in the existing npm runtime package.

## Setup

ClawHub/OpenClaw package identity lives here:
`@atomicmail/openclaw-atomicmail`.

The real MCP server remains:
`@atomicmail/mcp-clawhub`.

Print the exact OpenClaw setup commands:

```bash
npx --package=@atomicmail/openclaw-atomicmail atomicmail-openclaw-mcp-config
```

Register the MCP server explicitly:

```bash
openclaw mcp add atomicmail --command npx --arg -y --arg @atomicmail/mcp-clawhub
```

Probe the saved server before relying on it:

```bash
openclaw mcp doctor atomicmail --probe
```

After `register`, create the hourly inbox cron job (OpenClaw has native cron):

```bash
openclaw cron add \
  --name "atomicmail-inbox" \
  --cron "0 * * * *" \
  --session isolated \
  --message 'Use Atomic Mail to fetch my inbox (MCP jmap_request with ops_file list_inbox.json, or atomicmail jmap_request --ops-file list_inbox.json). Summarize new messages, highlight what needs a reply, and stay available - I may ask you to reply, forward, search, or dig into something important.' \
  --announce
```

## Why manual registration

During this task, the documented OpenClaw package metadata and ClawHub publish
commands were confirmed, but a stable documented plugin SDK hook for mutating
OpenClaw MCP server config from inside the plugin was not confirmed. The same
goes for a safe install-time cron mutation path. This wrapper therefore stays
intentionally honest: it advertises the intended MCP runtime and prints the
exact setup commands without pretending to automate unsupported steps.

## Release flow

This package is prepared by:

```bash
deno run -A ts/build_openclaw_wrapper.ts <version>
```

The GitHub Actions workflow `.github/workflows/publish-clawhub.yml` then:

1. resolves the release version,
2. builds and locally packs `integrations_dist/openclaw/atomicmail` for verification, and
3. calls ClawHub's official reusable package publishing workflow against the
   wrapper package path in this repo.
