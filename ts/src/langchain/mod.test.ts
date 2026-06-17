import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import type { AgentSession, ResolvedAgentConfig } from "../lib/mod.ts";
import { buildAtomicMailTools } from "./mod.ts";

function makeContext(session: AgentSession) {
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
  return { defaultConfig, defaultSession: session };
}

function getTool(name: string, session: AgentSession) {
  const tools = buildAtomicMailTools(makeContext(session));
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) {
    throw new Error(`missing tool: ${name}`);
  }
  return tool;
}

Deno.test("langchain jmap_request rejects ops xor ops_file violation", async () => {
  const fakeSession = {
    credentialDir: "/tmp/atomicmail",
  } as unknown as AgentSession;
  const tool = getTool("jmap_request", fakeSession);

  await assertRejectsMessage(
    () =>
      tool.invoke({
        ops: '[["Mailbox/get",{},"m0"]]',
        ops_file: "list_inbox.json",
      }),
    "mutually exclusive",
  );
});

Deno.test("langchain jmap_request rejects dry_run with attachments", async () => {
  const fakeSession = {
    credentialDir: "/tmp/atomicmail",
  } as unknown as AgentSession;
  const tool = getTool("jmap_request", fakeSession);

  await assertRejectsMessage(
    () =>
      tool.invoke({
        ops: '[["Mailbox/get",{},"m0"]]',
        dry_run: true,
        attachments: [{ path: "./foo.txt" }],
      }),
    "cannot be combined with --attachment",
  );
});

Deno.test("langchain jmap_request supports dry_run", async () => {
  const fakeSession = {
    getJmapPostUrl: () => Promise.resolve("https://api.atomicmail.ai/jmap"),
    getPrimaryMailAccountId: () => Promise.resolve("acc-1"),
    getCapabilityToken: () => Promise.resolve("token"),
    getBlobUploadLimitsForAccount: () => Promise.resolve(null),
    apiUrl: "https://api.atomicmail.ai",
    files: { credentialsFile: "/tmp/atomicmail/credentials.json" },
    credentialDir: "/tmp/atomicmail",
  } as unknown as AgentSession;
  const tool = getTool("jmap_request", fakeSession);

  const out = await tool.invoke({
    ops: '[["Mailbox/get",{},"m0"]]',
    dry_run: true,
  });
  const parsed = JSON.parse(out as string) as {
    dryRun: boolean;
    envelope: { methodCalls: unknown[] };
  };
  assertEquals(parsed.dryRun, true);
  assertEquals(parsed.envelope.methodCalls.length, 1);
});

Deno.test("langchain register forwards forced semantics", async () => {
  let forcedSeen: boolean | undefined;
  const fakeSession = {
    register: (_username: string, options?: { forced?: boolean }) => {
      forcedSeen = options?.forced;
      return Promise.resolve({
        inbox: "alice@atomicmail.ai",
        accountId: "acc-1",
      });
    },
  } as unknown as AgentSession;
  const tool = getTool("register", fakeSession);

  const out = await tool.invoke({ username: "alice1", forced: true });
  assertEquals(forcedSeen, true);
  assertStringIncludes(out as string, "hourly");
});

Deno.test("langchain help returns bundled topic content", async () => {
  const fakeSession = {
    credentialDir: "/tmp/atomicmail",
  } as unknown as AgentSession;
  const tool = getTool("help", fakeSession);

  const out = await tool.invoke({ topic: "cron" });
  assertStringIncludes(out as string, "hourly");
});

Deno.test("langchain exports register/jmap/help tools", () => {
  const fakeSession = {
    credentialDir: "/tmp/atomicmail",
  } as unknown as AgentSession;
  const tools = buildAtomicMailTools(makeContext(fakeSession));
  assertEquals(tools.map((tool) => tool.name), [
    "register",
    "jmap_request",
    "help",
  ]);
});

async function assertRejectsMessage(
  fn: () => Promise<unknown>,
  expectedSubstring: string,
): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch (err) {
    threw = true;
    assertStringIncludes(
      err instanceof Error ? err.message : String(err),
      expectedSubstring,
    );
  }
  assert(threw);
}
