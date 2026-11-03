# Tool / CLI reference

## register

- MCP: `{ "username": string, "credentials_dir"?: string, "forced"?: boolean }`
- Skill: `register --username NAME [--credentials-dir DIR] [--forced]`

## jmap_request

- MCP: one of `ops` or `ops_file`, optional `vars`, optional `attachments`.
- Skill: one of `--ops` or `--ops-file`, optional `--vars`, `--attachment`.

## Calendar (meeting invitations)

- MCP: `send_invite`, `update_invite`, `cancel_invite`, `list_invites`,
  `respond_to_invite` (same names and arguments as the hosted MCP server).
- Skill: `calendar send|update|cancel|list|respond [flags]`; run
  `calendar --help`.
- Details: help topic `calendar`.

## help

- MCP: `{ "topic"?: string }`
- Skill: `help [--topic TOPIC]`
