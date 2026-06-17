// AtomicMail MCP server — stdio, PoW auth, JMAP (register / jmap_request / help).
//
// CONFIGURATION: credentials.json + session.jwt + capability.jwt in the
// credential directory (default ~/.atomicmail/, override ATOMIC_MAIL_CREDENTIALS_DIR),
// merged with ATOMIC_MAIL_AUTH_URL / ATOMIC_MAIL_API_URL / ATOMIC_MAIL_API_KEY.

import process from "node:process";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PostHog } from "posthog-node";

import { AgentSession, resolveAgentConfigFromEnv } from "../lib/mod.ts";
import { postRegisterCronReminder } from "../lib/agent/jmap/help-content/cron.ts";
import type { McpSessionContext } from "./mcp-session-context.ts";
import { registerHelpTool } from "./tools/help.ts";
import { registerJmapTool } from "./tools/jmap.ts";
import { registerRegisterTool } from "./tools/register.ts";
import { ATOMICMAIL_MCP_VERSION } from "./version.ts";

const VERSION = ATOMICMAIL_MCP_VERSION;

const INSTRUCTIONS = `\
Atomic Mail MCP — programmable inbox for AI agents.

WORKFLOW
  1. Call register with a desired username (5–21 characters; PoW signup; credentials on disk).
  2. After register, arrange hourly inbox polling per your runtime (help topic "cron"): native cron hosts schedule an AGENT turn with list_inbox.json in the prompt; no-native-cron hosts ask the operator or remind manual fetch — do NOT work around with OS crontab or cross-platform scheduling. Do NOT cron atomicmail jmap_request alone.
  3. Call jmap_request with JMAP method calls (inline ops JSON or ops_file preset).
     $VAR_NAME tokens: $ACCOUNT_ID / $INBOX (full mailbox) / $INBOX_MAILBOX_ID from session;
     pass others in vars. Optional attachments: local paths → RFC 8620 upload →
     $ATTACHMENT_0_BLOB_ID, … in the same standard JMAP batch (see send_mail_blob_attachment.json).
  4. Call help early and often — even when you think you know JMAP. Topics:
     presets (before non-trivial jmap_request), cron (after register),
     jmap_cheatsheet, troubleshooting, …; topic readme returns this package README.
     Prefer help over guessing; it matches this package version.

${postRegisterCronReminder}

CREDENTIAL DIRECTORY
  Default ~/.atomicmail/ (override ATOMIC_MAIL_CREDENTIALS_DIR). Same files as
  the @atomicmail/agent-skill CLI: credentials.json, session.jwt, capability.jwt.
  Optional credentials_dir on register and jmap_request selects a different directory
  per call (multi-account / multi-agent). See help topic multi_account.

ENVIRONMENT
  ATOMIC_MAIL_CREDENTIALS_DIR  credential directory
  ATOMIC_MAIL_AUTH_URL         auth-service base URL (default: https://auth.atomicmail.ai)
  ATOMIC_MAIL_API_URL          JMAP / API base URL (default: https://api.atomicmail.ai)
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

  const ph = new PostHog("phc_DkRYHp34KrcvkAA9ckuHdjDRJqurFPsjZdrPFwEWrQeJ", {
    host: "https://eu.posthog.com",
    flushAt: 1,
    flushInterval: 0,
  });

  const server = new McpServer(
    { name: "atomicmail", version: VERSION },
    { instructions: INSTRUCTIONS },
  );

  server.server.oninitialized = async () => {
    const clientInfo = server.server.getClientVersion();
    await ph.captureImmediate({
      distinctId: clientInfo?.name ?? "unknown",
      event: "mcp_session_started",
      properties: {
        client_name: clientInfo?.name ?? "unknown",
      },
    });
  };

  const mcpCtx: McpSessionContext = {
    defaultConfig: config,
    defaultSession: session,
  };

  registerRegisterTool(server, mcpCtx);
  registerJmapTool(server, mcpCtx);
  registerHelpTool(server);

  const cleanup = async () => {
    session.destroy();
    await ph.shutdown();
  };

  process.on("SIGINT", () => {
    cleanup().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    cleanup().finally(() => process.exit(0));
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Atomic Mail MCP: server running on stdio");
}

main().catch((err) => {
  console.error("Atomic Mail MCP: fatal error:", err);
  process.exit(1);
});
