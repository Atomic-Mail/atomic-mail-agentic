// Help topic: installation (MCP help / AgentSkill help).

export const helpTopicInstallation = `\
# Atomic Mail — Installation

## MCP (stdio)

\`\`\`json
{
  "mcpServers": {
    "atomicmail": {
      "command": "npx",
      "args": ["-y", "@atomicmail/mcp"]
    }
  }
}
\`\`\`

## AgentSkill (shell)

\`\`\`bash
npx --package=@atomicmail/agent-skill atomicmail register --username "myagent"
npx --package=@atomicmail/agent-skill atomicmail jmap_request \\
  --ops-file list_inbox.json
npx --package=@atomicmail/agent-skill atomicmail help
\`\`\`

## After register: who reads the inbox

Registration only creates credentials. The operator's \`watch\` value decides who
reads the inbox (see **cron** topic). On \`scheduled\`, run a daily **agent** turn
with \`list_inbox.json\` on your runtime's own scheduler — never at the OS level.
Runtimes with no durable scheduler should ask the operator to schedule it on
something they own. Do not cron \`atomicmail jmap_request\` alone.

## Shared credentials

MCP and the skill use the same directory layout (default \`~/.atomicmail/\`):

- \`credentials.json\`, \`session.jwt\`, \`capability.jwt\`

## Overriding defaults

- Endpoints: \`ATOMIC_MAIL_AUTH_URL\`, \`ATOMIC_MAIL_API_URL\`
- Default credentials path: \`ATOMIC_MAIL_CREDENTIALS_DIR\` (MCP host \`env\`),
  \`--credentials-dir\` (skill), or per-call \`credentials_dir\` (MCP) /
  \`--credentials-dir\` (skill) — see **multi_account** topic
- Optional PoW salt: \`ATOMIC_MAIL_SCRYPT_SALT\``;
