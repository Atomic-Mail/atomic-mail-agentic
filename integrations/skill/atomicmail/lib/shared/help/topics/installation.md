# Atomic Mail — Installation

## MCP (stdio)

```json
{
  "mcpServers": {
    "atomicmail": {
      "command": "npx",
      "args": ["-y", "@atomicmail/mcp"]
    }
  }
}
```

## AgentSkill (shell)

```bash
npx --package=@atomicmail/agent-skill atomicmail register --username "myagent"
npx --package=@atomicmail/agent-skill atomicmail jmap_request --ops-file list_inbox.json
npx --package=@atomicmail/agent-skill atomicmail help
```

## After register: who reads the inbox

Registration only creates credentials. The operator's `watch` value decides who
reads the inbox per your
runtime (see **cron** topic):

- **Host with its own scheduler** (OpenClaw, Hermes, atomic-agent, Claude Code, …): schedule a daily
  **agent** turn with `list_inbox.json` inside the prompt.
- **No native cron** (Claude, Pi, Cursor, …): ask your operator to set up
  polling on a capable host, or remind them to fetch mail manually when needed.
  Do not work around this with wrapper scripts or OS schedulers.

Do not cron `atomicmail jmap_request` alone.
