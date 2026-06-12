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

## Required: hourly agent inbox job

After `register`, schedule an **hourly agent** to fetch mail with
`list_inbox.json`. Do not cron `atomicmail jmap_request` alone.
