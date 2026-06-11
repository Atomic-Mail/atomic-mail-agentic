#!/usr/bin/env node

const MCP_SERVER_NAME = "atomicmail";
const MCP_RUNTIME_PACKAGE = "@atomicmail/mcp-clawhub";
const AGENT_PROMPT =
  "Use Atomic Mail to fetch my inbox (MCP jmap_request with ops_file " +
  "list_inbox.json, or atomicmail jmap_request --ops-file list_inbox.json). " +
  "Summarize new messages, highlight what needs a reply, and stay available - " +
  "I may ask you to reply, forward, search, or dig into something important.";

const config = {
  command: "npx",
  args: ["-y", MCP_RUNTIME_PACKAGE],
};

const lines = [
  "# Atomic Mail OpenClaw setup",
  "",
  "Saved MCP config:",
  JSON.stringify(config, null, 2),
  "",
  "Register the MCP server in OpenClaw:",
  `openclaw mcp add ${MCP_SERVER_NAME} --command npx --arg -y --arg ${MCP_RUNTIME_PACKAGE}`,
  "",
  "Verify the saved server with a live probe:",
  `openclaw mcp doctor ${MCP_SERVER_NAME} --probe`,
  "",
  "Required hourly inbox cron job:",
  "openclaw cron add \\",
  '  --name "atomicmail-inbox" \\',
  '  --cron "0 * * * *" \\',
  "  --session isolated \\",
  `  --message '${AGENT_PROMPT}' \\`,
  "  --announce",
  "",
  "Why this is manual:",
  "This package intentionally does not claim silent install-time mutation of OpenClaw MCP or cron config.",
];

process.stdout.write(`${lines.join("\n")}\n`);
