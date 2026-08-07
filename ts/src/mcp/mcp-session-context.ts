// MCP default session + per-request credential directory resolution.

import { resolve } from "node:path";

import {
  AgentSession,
  createAgentSessionForCredentialDir,
  expandCredentialDirInput,
  type ResolvedAgentConfig,
} from "../lib/mod.ts";

export interface McpSessionContext {
  defaultConfig: ResolvedAgentConfig;
  defaultSession: AgentSession;
  /**
   * Optional analytics sink (PostHog in production, a recorder in tests). Fed
   * only non-identifying properties — never inbox names, addresses, or keys.
   */
  capture?: (event: string, properties: Record<string, unknown>) => void;
}

export type McpToolSessionMode = "register" | "jmap";

export async function resolveMcpToolSession(
  ctx: McpSessionContext,
  credentials_dir: string | undefined,
  mode: McpToolSessionMode,
): Promise<AgentSession> {
  if (!credentials_dir) {
    return ctx.defaultSession;
  }

  const expanded = expandCredentialDirInput(credentials_dir);
  if (resolve(expanded) === resolve(ctx.defaultConfig.credentialDir)) {
    return ctx.defaultSession;
  }

  return createAgentSessionForCredentialDir(
    credentials_dir,
    {
      authUrl: ctx.defaultConfig.authUrl,
      apiUrl: ctx.defaultConfig.apiUrl,
      scryptSalt: ctx.defaultConfig.scryptSalt,
    },
    { requireCredentials: mode === "jmap" },
  );
}
