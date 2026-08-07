import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import type { AgentSession, ResolvedAgentConfig } from "../../lib/mod.ts";
import type { McpSessionContext } from "../mcp-session-context.ts";
import { registerRegisterTool } from "./register.ts";

interface ZodLike {
  safeParse: (
    value: unknown,
  ) => { success: boolean; error?: { issues: { message: string }[] } };
}

type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<{ content: [{ type: "text"; text: string }]; isError?: true }>;

interface CapturedTool {
  name: string;
  config: { inputSchema: ZodLike };
  handler: ToolHandler;
}

function makeCapturedRegisterTool(ctx: McpSessionContext): CapturedTool {
  let captured: CapturedTool | null = null;
  const fakeServer = {
    registerTool(
      name: string,
      config: { inputSchema: ZodLike },
      handler: ToolHandler,
    ) {
      captured = { name, config, handler };
    },
  };

  registerRegisterTool(
    fakeServer as unknown as import("@modelcontextprotocol/sdk/server/mcp").McpServer,
    ctx,
  );

  if (!captured) {
    throw new Error("registerRegisterTool did not register a tool.");
  }
  return captured;
}

function makeContextWithSession(session: AgentSession): McpSessionContext {
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
    utm: {},
  };
  return { defaultConfig, defaultSession: session };
}

function fakeRegisterSession(): AgentSession {
  return {
    register: (_username: string, _opts: unknown) =>
      Promise.resolve({
        inbox: "alice@atomicmail.ai",
        accountId: "acc-1",
        apiKey: "key-1",
      }),
  } as unknown as AgentSession;
}

Deno.test("register schema rejects a missing watch with the shared error", () => {
  const tool = makeCapturedRegisterTool(
    makeContextWithSession(fakeRegisterSession()),
  );
  assertEquals(tool.name, "register");

  const parsed = tool.config.inputSchema.safeParse({ username: "alice5" });
  assert(!parsed.success);
  const message = parsed.error!.issues[0].message;
  // Opens with the requirement, defers meanings to help topic cron, and does not
  // explain the values (which is what lets an agent decide from the text).
  assert(message.startsWith("register requires 'watch'"));
  assertStringIncludes(message, "help topic cron");
  assert(!message.includes("recurring job"));
  assert(!message.includes("once a day"));
});

Deno.test("register schema rejects an invalid watch value", () => {
  const tool = makeCapturedRegisterTool(
    makeContextWithSession(fakeRegisterSession()),
  );
  const parsed = tool.config.inputSchema.safeParse({
    username: "alice5",
    watch: "weekly",
  });
  assert(!parsed.success);
  assertStringIncludes(
    parsed.error!.issues[0].message,
    "register requires 'watch'",
  );
});

Deno.test("register schema accepts scheduled and on-demand", () => {
  const tool = makeCapturedRegisterTool(
    makeContextWithSession(fakeRegisterSession()),
  );
  assert(
    tool.config.inputSchema.safeParse({
      username: "alice5",
      watch: "on-demand",
    })
      .success,
  );
  assert(
    tool.config.inputSchema.safeParse({
      username: "alice5",
      watch: "scheduled",
    })
      .success,
  );
  // `none` is no longer a valid value.
  assert(
    !tool.config.inputSchema.safeParse({ username: "alice5", watch: "none" })
      .success,
  );
});

Deno.test("register handler appends the setup block only on scheduled", async () => {
  const tool = makeCapturedRegisterTool(
    makeContextWithSession(fakeRegisterSession()),
  );

  const onDemand = await tool.handler({
    username: "alice5",
    watch: "on-demand",
  });
  assertEquals(onDemand.isError, undefined);
  assertStringIncludes(onDemand.content[0].text, "alice@atomicmail.ai");
  assert(!onDemand.content[0].text.includes('watch="scheduled"'));

  const scheduled = await tool.handler({
    username: "alice5",
    watch: "scheduled",
  });
  assertEquals(scheduled.isError, undefined);
  assertStringIncludes(scheduled.content[0].text, "alice@atomicmail.ai");
  // Detection depends on the host; assert the branch-independent anchor here and
  // exercise host detection in watch-schedule.test.ts.
  assertStringIncludes(scheduled.content[0].text, 'watch="scheduled"');
});

Deno.test("register handler never forwards watch into session.register", async () => {
  let capturedOpts: Record<string, unknown> | undefined;
  const session = {
    register: (_username: string, opts: Record<string, unknown>) => {
      capturedOpts = opts;
      return Promise.resolve({
        inbox: "alice@atomicmail.ai",
        accountId: "acc-1",
        apiKey: "key-1",
      });
    },
  } as unknown as AgentSession;

  const tool = makeCapturedRegisterTool(makeContextWithSession(session));
  await tool.handler({ username: "alice5", watch: "scheduled" });

  assert(capturedOpts !== undefined);
  assert(!("watch" in capturedOpts!));
});

Deno.test("register emits a telemetry event with no inbox identifiers", async () => {
  const events: { event: string; properties: Record<string, unknown> }[] = [];
  const ctx = makeContextWithSession(fakeRegisterSession());
  ctx.capture = (event, properties) => events.push({ event, properties });

  const tool = makeCapturedRegisterTool(ctx);
  await tool.handler({ username: "alice5", watch: "on-demand" });

  assertEquals(events.length, 1);
  assertEquals(events[0].event, "register");
  const props = events[0].properties;
  // Carries exactly the three measurement fields.
  assertEquals(props.watch, "on-demand");
  assert("runtime_detected" in props);
  assert(typeof props.runtime === "string");
  // and no inbox name, address, or key (the fake session returns these).
  const serialized = JSON.stringify(props);
  assert(!serialized.includes("alice@atomicmail.ai"));
  assert(!serialized.includes("key-1"));
  assert(!serialized.includes("acc-1"));
});
