import { assert, assertEquals } from "@std/assert";

import type { AgentSession, ResolvedAgentConfig } from "../../lib/mod.ts";
import type { McpSessionContext } from "../mcp-session-context.ts";
import { registerJmapTool } from "./jmap.ts";

type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<{ content: [{ type: "text"; text: string }]; isError?: true }>;

interface CapturedTool {
  name: string;
  config: { inputSchema: { safeParse: (value: unknown) => { success: boolean } } };
  handler: ToolHandler;
}

function makeCapturedJmapTool(ctx: McpSessionContext): CapturedTool {
  let captured: CapturedTool | null = null;
  const fakeServer = {
    registerTool(
      name: string,
      config: { inputSchema: { safeParse: (value: unknown) => { success: boolean } } },
      handler: ToolHandler,
    ) {
      captured = { name, config, handler };
    },
  };

  registerJmapTool(
    fakeServer as unknown as import("@modelcontextprotocol/sdk/server/mcp").McpServer,
    ctx,
  );

  if (!captured) {
    throw new Error("registerJmapTool did not register a tool.");
  }
  return captured;
}

function makeContextWithSession(
  session: AgentSession,
): McpSessionContext {
  const defaultConfig: ResolvedAgentConfig = {
    authUrl: "https://auth.atomicmail.ai",
    apiUrl: "https://api.atomicmail.ai",
    scryptSalt: "salt",
    credentialDir: "/tmp/atomicmail",
    files: {
      credentialsFile: "/tmp/atomicmail/credentials.json",
      sessionFile: "/tmp/atomicmail/session.jwt",
      capabilityFile: "/tmp/atomicmail/capability.jwt",
    },
    source: "defaults",
  };
  return {
    defaultConfig,
    defaultSession: session,
  };
}

Deno.test("registerJmapTool schema accepts dry_run boolean", () => {
  const fakeSession = {
    getJmapPostUrl: async () => "https://api.atomicmail.ai/jmap",
    getPrimaryMailAccountId: async () => "acc-1",
    getCapabilityToken: async () => "token",
    getBlobUploadLimitsForAccount: async () => null,
    apiUrl: "https://api.atomicmail.ai",
    files: { credentialsFile: "/tmp/atomicmail/credentials.json" },
  } as unknown as AgentSession;

  const tool = makeCapturedJmapTool(makeContextWithSession(fakeSession));
  assertEquals(tool.name, "jmap_request");

  const parsed = tool.config.inputSchema.safeParse({
    ops: "[]",
    dry_run: true,
  });
  assert(parsed.success);
});

Deno.test("registerJmapTool forwards dry_run into jmap execution", async () => {
  const fakeSession = {
    getJmapPostUrl: async () => "https://api.atomicmail.ai/jmap",
    getPrimaryMailAccountId: async () => "acc-1",
    getCapabilityToken: async () => "token",
    getBlobUploadLimitsForAccount: async () => null,
    apiUrl: "https://api.atomicmail.ai",
    files: { credentialsFile: "/tmp/atomicmail/credentials.json" },
  } as unknown as AgentSession;
  const tool = makeCapturedJmapTool(makeContextWithSession(fakeSession));

  const out = await tool.handler({
    ops: '[["Mailbox/get",{},"m0"]]',
    using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
    dry_run: true,
  });
  assertEquals(out.isError, undefined);
  const text = out.content[0].text;
  const parsed = JSON.parse(text) as {
    dryRun: boolean;
    envelope: { methodCalls: unknown[] };
  };
  assertEquals(parsed.dryRun, true);
  assertEquals(parsed.envelope.methodCalls.length, 1);
});
