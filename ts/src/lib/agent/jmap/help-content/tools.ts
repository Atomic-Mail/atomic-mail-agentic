// Help topic: tools (MCP help / AgentSkill help). Mirrors
// shared/help/topics/tools.md (the runtime source); this is the fallback.

export const helpTopicTools = `\
# Tool / CLI reference

## register

- MCP: \`{ "username": string, "watch": string, "credentials_dir"?: string }\`
- Skill: \`register --username NAME --watch VALUE [--credentials-dir DIR]\`, or
  \`register --api-key KEY --watch VALUE\` to sign back in to an existing inbox.
- \`watch\` is your operator's decision; run \`register\` without it to see the
  accepted values (help topic \`cron\`).

## jmap_request

- MCP: one of \`ops\` or \`ops_file\`, optional \`vars\`, optional \`attachments\`.
- Skill: one of \`--ops\` or \`--ops-file\`, optional \`--vars\`, \`--attachment\`.

## Calendar

- MCP: \`send_invite\`, \`update_invite\`, \`cancel_invite\`, \`list_invites\`,
  \`respond_to_invite\` (same names and arguments as the hosted MCP server).
- Skill: \`calendar send|update|cancel|list|respond [flags]\`; run
  \`calendar --help\`.
- Details: help topic \`calendar\`.

## help

- MCP: \`{ "topic"?: string }\`
- Skill: \`help [--topic TOPIC]\`
`;
