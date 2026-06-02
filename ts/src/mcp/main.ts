// AtomicMail MCP server — stdio, PoW auth, JMAP (register / jmap_request / help).
//
// CONFIGURATION: credentials.json + session.jwt + capability.jwt in the
// credential directory (default ~/.atomicmail/, override ATOMIC_MAIL_CREDENTIALS_DIR),
// merged with ATOMIC_MAIL_AUTH_URL / ATOMIC_MAIL_API_URL / ATOMIC_MAIL_API_KEY.

import process from "node:process";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { AgentSession, resolveAgentConfigFromEnv } from "../lib/mod.ts";
import { registerHelpTool } from "./tools/help.ts";
import { registerJmapTool } from "./tools/jmap.ts";
import { registerRegisterTool } from "./tools/register.ts";
import { ATOMICMAIL_MCP_VERSION } from "./version.ts";

const VERSION = ATOMICMAIL_MCP_VERSION;

const INSTRUCTIONS = `\
Atomic Mail MCP — programmable inbox for AI agents.

WORKFLOW
  1. Call register with a desired username (5–21 characters; PoW signup; credentials on disk).
  2. Call jmap_request with JMAP method calls (inline ops JSON or ops_file preset).
     $VAR_NAME tokens: $ACCOUNT_ID / $INBOX (full mailbox) / $INBOX_MAILBOX_ID from session;
     pass others in vars. Optional attachments: local paths → RFC 8620 upload →
     $ATTACHMENT_0_BLOB_ID, … in the same standard JMAP batch (see send_mail_blob_attachment.json).
  3. Call help for documentation (topics presets, jmap_cheatsheet, troubleshooting, …);
     topic readme returns the npm package README.

CREDENTIAL DIRECTORY
  Default ~/.atomicmail/ (override ATOMIC_MAIL_CREDENTIALS_DIR). Same files as
  the @atomicmail/agent-skill CLI: credentials.json, session.jwt, capability.jwt.

ENVIRONMENT
  ATOMIC_MAIL_CREDENTIALS_DIR  credential directory
  ATOMIC_MAIL_AUTH_URL         auth-service base URL
  ATOMIC_MAIL_API_URL          JMAP / API base URL
  ATOMIC_MAIL_INBOX_DOMAIN     optional hostname when inboxId has no @ (default atomicmail.ai)
  ATOMIC_MAIL_SCRYPT_SALT      optional PoW salt override
  ATOMIC_MAIL_API_KEY          optional existing API key

SECURITY
  credentials.json contains your apiKey — treat it as a secret (mode 0600).`;

async function main(): Promise<void> {
  let config: Awaited<ReturnType<typeof resolveAgentConfigFromEnv>>;
  try {
    config = await resolveAgentConfigFromEnv();
  } catch (err) {
    console.error(
      "Atomic Mail MCP: configuration error:",
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  }

  console.error(
    `Atomic Mail MCP v${VERSION}: credential dir '${config.credentialDir}' ` +
      `(config source: ${config.source}).`,
  );
  if (config.apiKey) {
    console.error(
      `Atomic Mail MCP: API key configured${
        config.inboxId ? ` (inbox ${config.inboxId})` : ""
      }.`,
    );
  } else {
    console.error(
      "Atomic Mail MCP: no API key — call register to create an account.",
    );
  }

  const session = await AgentSession.create({
    authUrl: config.authUrl,
    apiUrl: config.apiUrl,
    scryptSalt: config.scryptSalt,
    apiKey: config.apiKey,
    inboxId: config.inboxId,
    credentialDir: config.credentialDir,
    files: config.files,
  });

  const server = new McpServer(
    { name: "atomicmail", version: VERSION },
    { instructions: INSTRUCTIONS },
  );

  registerRegisterTool(server, session);
  registerJmapTool(server, session);
  registerHelpTool(server);

  const cleanup = () => {
    session.destroy();
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Atomic Mail MCP: server running on stdio");
}

main().catch((err) => {
  console.error("Atomic Mail MCP: fatal error:", err);
  process.exit(1);
});
