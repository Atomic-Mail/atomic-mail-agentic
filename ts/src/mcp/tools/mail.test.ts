import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  answerReply,
  fakeSession,
  installFakeJmap,
  type JmapEnvelopeSeen,
  SENT_RESPONSE,
} from "../../lib/agent/mail/fake-jmap.ts";
import type { AgentSession, ResolvedAgentConfig } from "../../lib/mod.ts";
import type { McpSessionContext } from "../mcp-session-context.ts";
import { registerMailTools } from "./mail.ts";

function context(): McpSessionContext {
  const defaultConfig: ResolvedAgentConfig = {
    authUrl: "https://auth.example",
    apiUrl: "https://api.example",
    scryptSalt: "salt",
    credentialDir: "/tmp/atomicmail-test",
    files: {
      credentialsFile: "/tmp/atomicmail-test/credentials.json",
      sessionFile: "/tmp/atomicmail-test/session.jwt",
      capabilityFile: "/tmp/atomicmail-test/capability.jwt",
    },
    source: "defaults",
    utm: {},
  };
  return {
    defaultConfig,
    defaultSession: fakeSession() as unknown as AgentSession,
  };
}

/**
 * A real client and server over an in-memory transport, so the SDK checks every
 * argument against the input schema and every result against the output schema.
 */
async function withClient<T>(
  answer: (batch: JmapEnvelopeSeen) => unknown,
  fn: (
    client: Client,
    fake: ReturnType<typeof installFakeJmap>,
  ) => Promise<T>,
): Promise<T> {
  const fake = installFakeJmap(answer);
  const server = new McpServer({ name: "test", version: "0" });
  registerMailTools(server, context());
  const client = new Client({ name: "test-client", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    return await fn(client, fake);
  } finally {
    await client.close();
    await server.close();
    fake.restore();
  }
}

type ToolResult = {
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const call = async (
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
) => await client.callTool({ name, arguments: args }) as ToolResult;

const textOf = (r: ToolResult) => r.content[0].text;

type ToolInfo = {
  name: string;
  inputSchema: { properties?: Record<string, unknown> };
  outputSchema?: unknown;
  annotations?: Record<string, unknown>;
};

const listTools = async (client: Client) =>
  (await client.listTools()).tools as ToolInfo[];

const SUMMARY_RESPONSE = {
  methodResponses: [
    ["Email/query", { ids: ["e1"] }, "q0"],
    ["Email/get", {
      list: [{
        id: "e1",
        threadId: "t1",
        subject: "Hello",
        preview: "hi",
        // JMAP's explicit nulls: a schema rejecting them fails the whole call.
        from: [{ email: "s@x.com", name: null }],
        to: [{ email: "alice@atomicmail.ai", name: null }],
        receivedAt: "2026-01-01T00:00:00Z",
        keywords: {},
      }],
    }, "g0"],
  ],
};

Deno.test("tools/list: the hosted names and arguments, plus the new options", () =>
  withClient(() => ({}), async (client) => {
    const tools = await listTools(client);
    const args = (name: string) =>
      Object.keys(
        tools.find((t) => t.name === name)?.inputSchema.properties ?? {},
      ).sort();
    assertEquals(tools.map((t) => t.name).sort(), [
      "list_agents",
      "read_inbox",
      "read_message",
      "reply_to_message",
      "search_messages",
      "send_email",
    ]);
    assertEquals(args("read_inbox"), ["agent_id", "credentials_dir", "limit"]);
    assertEquals(args("read_message"), [
      "agent_id",
      "credentials_dir",
      "message_id",
    ]);
    assertEquals(args("search_messages"), [
      "agent_id",
      "credentials_dir",
      "limit",
      "query",
    ]);
    assertEquals(args("send_email"), [
      "agent_id",
      "attachments",
      "bcc",
      "body",
      "cc",
      "credentials_dir",
      "from_name",
      "html_body",
      "reply_to",
      "subject",
      "to",
    ]);
    assertEquals(args("reply_to_message"), [
      "agent_id",
      "attachments",
      "body",
      "credentials_dir",
      "from_name",
      "html_body",
      "message_id",
      "reply_to",
    ]);
    assertEquals(args("list_agents"), ["credentials_dir"]);
  }));

Deno.test("tools/list: reads are read-only, sends are open-world", () =>
  withClient(() => ({}), async (client) => {
    const tools = await listTools(client);
    for (const tool of tools) {
      const send = ["send_email", "reply_to_message"].includes(tool.name);
      assertEquals(tool.annotations?.readOnlyHint, !send, tool.name);
      assertEquals(tool.annotations?.openWorldHint, send, tool.name);
      assertEquals(tool.annotations?.destructiveHint, false, tool.name);
      assertEquals(typeof tool.outputSchema, send ? "undefined" : "object");
    }
  }));

Deno.test("read_inbox: structured rows pass output validation with null names", () =>
  withClient(() => SUMMARY_RESPONSE, async (client, fake) => {
    const r = await call(client, "read_inbox", { limit: 7 });
    assertEquals(r.isError, undefined);
    assertEquals(fake.batches[0].methodCalls[0][1].limit, 7);
    const { messages } = r.structuredContent as {
      messages: { id: string; unread: boolean }[];
    };
    assertEquals(messages[0].id, "e1");
    assertEquals(messages[0].unread, true);
    assertEquals(JSON.parse(textOf(r)), r.structuredContent);
  }));

Deno.test("search_messages: returns the same rows", () =>
  withClient(() => SUMMARY_RESPONSE, async (client, fake) => {
    const r = await call(client, "search_messages", { query: "invoice" });
    assertEquals(fake.batches[0].methodCalls[0][1].filter, { text: "invoice" });
    assertEquals(
      (r.structuredContent as { messages: unknown[] }).messages.length,
      1,
    );
  }));

Deno.test("read_message: a clean document, body wrapped as untrusted", () =>
  withClient(() => ({
    methodResponses: [["Email/get", {
      list: [{
        id: "e1",
        threadId: "t1",
        subject: null,
        from: [{ email: "s@x.com", name: null }],
        to: null,
        cc: null,
        replyTo: null,
        keywords: { $seen: true },
        textBody: [{ partId: "1", type: "text/html" }],
        bodyValues: { "1": { value: "<p>Hi <script>x</script>there</p>" } },
        attachments: [{
          name: null,
          type: "application/pdf",
          size: 3,
          blobId: "G1",
        }],
      }],
    }, "g0"]],
  }), async (client) => {
    const r = await call(client, "read_message", { message_id: "e1" });
    assertEquals(r.isError, undefined);
    const doc = r.structuredContent as {
      subject: string;
      unread: boolean;
      body: string;
      attachments: { blobId: string }[];
    };
    assertEquals(doc.subject, "(no subject)");
    assertEquals(doc.unread, false);
    assertEquals(doc.attachments[0].blobId, "G1");
    assertStringIncludes(doc.body, "BEGIN UNTRUSTED EMAIL BODY");
    assertStringIncludes(doc.body, "Hi there");
    assertEquals(doc.body.includes("<p>"), false);
  }));

Deno.test("read_message: an unknown id is a tool error, not a crash", () =>
  withClient(
    () => ({ methodResponses: [["Email/get", { list: [] }, "g0"]] }),
    async (client) => {
      const r = await call(client, "read_message", { message_id: "zz" });
      assertEquals(r.isError, true);
      assertStringIncludes(textOf(r), "not found");
    },
  ));

Deno.test("send_email: options and base64 attachments reach the batch", () =>
  withClient(() => SENT_RESPONSE, async (client, fake) => {
    const r = await call(client, "send_email", {
      to: ["a@x.com"],
      subject: "Hi",
      html_body: "<p>Hello</p>",
      from_name: "Anna",
      reply_to: "help@x.com",
      attachments: [{
        filename: "a.txt",
        content_type: "text/plain",
        data_base64: btoa("hello"),
      }],
    });
    assertEquals(r.isError, undefined);
    assertEquals(JSON.parse(textOf(r)), {
      sent: true,
      id: "M-sent",
      threadId: "T-sent",
      to: ["a@x.com"],
      subject: "Hi",
    });
    assertEquals(new TextDecoder().decode(fake.uploads[0].bytes), "hello");
    const d1 = fake.batches[0].methodCalls[0][1].create.d1;
    assertEquals(d1.from, [{ email: "alice@atomicmail.ai", name: "Anna" }]);
    assertEquals(d1.replyTo, [{ email: "help@x.com" }]);
    assertEquals(d1.bodyValues.h.value, "<p>Hello</p>");
    assertEquals(d1.attachments[0].name, "a.txt");
    assertEquals(
      fake.batches[0].using.includes("urn:ietf:params:jmap:submission"),
      true,
    );
  }));

Deno.test("send_email: a JMAP rejection surfaces as isError", () =>
  withClient(() => ({
    methodResponses: [["Email/set", {
      notCreated: { d1: { type: "tooManyRecipients" } },
    }, "c0"]],
  }), async (client) => {
    const r = await call(client, "send_email", {
      to: "a@x.com",
      subject: "Hi",
      body: "x",
    });
    assertEquals(r.isError, true);
    assertStringIncludes(textOf(r), "tooManyRecipients");
  }));

Deno.test("send_email: neither body nor html_body is refused", () =>
  withClient(() => SENT_RESPONSE, async (client, fake) => {
    const r = await call(client, "send_email", { to: "a@x.com", subject: "s" });
    assertEquals(r.isError, true);
    assertStringIncludes(textOf(r), "html_body");
    assertEquals(fake.batches.length, 0);
  }));

Deno.test("reply_to_message: threaded, with the new options", () =>
  withClient(answerReply(), async (client, fake) => {
    const r = await call(client, "reply_to_message", {
      message_id: "m1",
      body: "Thanks!",
      from_name: "Bob",
    });
    assertEquals(r.isError, undefined);
    const out = JSON.parse(textOf(r));
    assertEquals(out.to, ["mate@getmate.ai"]);
    assertEquals(out.subject, "Re: Inbox Setup");
    const d1 = fake.batches[1].methodCalls[0][1].create.d1;
    assertEquals(d1.inReplyTo, ["orig-1@getmate.ai"]);
    assertEquals(d1.from[0].name, "Bob");
  }));

Deno.test("list_agents: the inbox of this credential directory", () =>
  withClient(() => ({}), async (client) => {
    const r = await call(client, "list_agents");
    assertEquals(r.structuredContent, {
      agents: [{
        accountId: "alice",
        inboxId: "alice",
        email: "alice@atomicmail.ai",
      }],
    });
  }));

Deno.test("agent_id: this inbox passes, another is refused before any read", () =>
  withClient(() => SUMMARY_RESPONSE, async (client, fake) => {
    assert(!(await call(client, "read_inbox", { agent_id: "alice" })).isError);
    const before = fake.batches.length;
    const r = await call(client, "read_inbox", { agent_id: "bob" });
    assertEquals(r.isError, true);
    assertStringIncludes(textOf(r), "cannot act as agent_id 'bob'");
    assertEquals(fake.batches.length, before);
  }));
