import { assertEquals, assertNotEquals } from "@std/assert";
import { resolve } from "node:path";

import { AgentSession } from "../lib/mod.ts";
import {
  DEFAULT_API_URL,
  DEFAULT_AUTH_URL,
  DEFAULT_POW_SCRYPT_SALT_HEX,
} from "../lib/core/consts.ts";
import { defaultFilesFromOutDir } from "../lib/agent/session/agent-credentials-store.ts";
import {
  type McpSessionContext,
  resolveMcpToolSession,
} from "./mcp-session-context.ts";

async function makeDefaultContext(
  credentialDir: string,
): Promise<McpSessionContext> {
  const files = defaultFilesFromOutDir(credentialDir);
  const defaultConfig = {
    authUrl: DEFAULT_AUTH_URL,
    apiUrl: DEFAULT_API_URL,
    scryptSalt: DEFAULT_POW_SCRYPT_SALT_HEX,
    credentialDir,
    files,
    source: "defaults" as const,
  };
  const defaultSession = await AgentSession.create({
    authUrl: defaultConfig.authUrl,
    apiUrl: defaultConfig.apiUrl,
    scryptSalt: defaultConfig.scryptSalt,
    credentialDir,
    files,
  });
  return { defaultConfig, defaultSession };
}

Deno.test(
  "resolveMcpToolSession returns default session when credentials_dir omitted",
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "atomicmail-mcp-ctx-" });
    try {
      const ctx = await makeDefaultContext(dir);
      const session = await resolveMcpToolSession(ctx, undefined, "register");
      assertEquals(session, ctx.defaultSession);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "resolveMcpToolSession returns default session when credentials_dir matches default",
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "atomicmail-mcp-ctx-" });
    try {
      const ctx = await makeDefaultContext(dir);
      const session = await resolveMcpToolSession(ctx, dir, "jmap");
      assertEquals(session, ctx.defaultSession);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "resolveMcpToolSession creates ephemeral session for different credentials_dir",
  async () => {
    const defaultDir = await Deno.makeTempDir({ prefix: "atomicmail-mcp-def-" });
    const otherDir = await Deno.makeTempDir({ prefix: "atomicmail-mcp-other-" });
    try {
      const ctx = await makeDefaultContext(defaultDir);
      const session = await resolveMcpToolSession(
        ctx,
        otherDir,
        "register",
      );
      assertNotEquals(session, ctx.defaultSession);
      assertEquals(session.credentialDir, resolve(otherDir));
    } finally {
      await Deno.remove(defaultDir, { recursive: true });
      await Deno.remove(otherDir, { recursive: true });
    }
  },
);
