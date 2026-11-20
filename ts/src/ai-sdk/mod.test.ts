import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { generateText, isStepCount } from "ai";
import { MockLanguageModelV4 } from "ai/test";

import {
  ATOMIC_MAIL_ENDPOINT,
  AtomicMailError,
  atomicMailTools,
} from "./mod.ts";

const API_KEY = "am_test_key_1234567890";

interface Call {
  url: string;
  headers: Record<string, string>;
  body: {
    method: string;
    id: number;
    params: { name: string; arguments: Record<string, unknown> };
  };
  signal?: AbortSignal | null;
}

function fakeFetch(
  respond: (call: Call) => Response | Promise<Response>,
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn =
    (async (input: string | URL | Request, init?: RequestInit) => {
      const call: Call = {
        url: String(input),
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(String(init?.body)),
        signal: init?.signal,
      };
      calls.push(call);
      return await respond(call);
    }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function toolAnswer(result: Record<string, unknown>): Response {
  return json({ jsonrpc: "2.0", id: 1, result });
}

function structured(content: Record<string, unknown>): Response {
  return toolAnswer({
    content: [{ type: "text", text: JSON.stringify(content) }],
    structuredContent: content,
  });
}

const SEND_ANSWER = JSON.stringify({
  methodResponses: [
    ["Email/set", { created: { draft: { id: "M1", threadId: "T1" } } }, "c0"],
    ["EmailSubmission/set", { created: { sub: { id: "S1" } } }, "c1"],
  ],
});

// deno-lint-ignore no-explicit-any
const run = (tool: any, input: unknown): Promise<any> =>
  tool.execute(input, { toolCallId: "call-1", messages: [] });

const MESSAGES = [{
  id: "M1",
  from: "anna@example.com",
  to: "agent@atomicmail.ai",
  subject: "Hello",
  preview: "Hi there",
  receivedAt: "2026-11-20T10:00:00Z",
}];

Deno.test("ai-sdk: five tools with descriptions and input schemas", () => {
  const tools = atomicMailTools({ apiKey: API_KEY });
  assertEquals(Object.keys(tools), [
    "readInbox",
    "searchMessages",
    "readMessage",
    "sendEmail",
    "replyToMessage",
  ]);
  for (const entry of Object.values(tools)) {
    assert(typeof entry.description === "string" && entry.description);
    assert(entry.inputSchema);
    assert(typeof entry.execute === "function");
  }
});

Deno.test("ai-sdk: readInbox sends the key as a bearer and returns messages", async () => {
  const { fetch, calls } = fakeFetch(() => structured({ messages: MESSAGES }));
  const { readInbox } = atomicMailTools({ apiKey: API_KEY, fetch });

  const result = await run(readInbox, {});

  assertEquals(result, { messages: MESSAGES });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, ATOMIC_MAIL_ENDPOINT);
  assertEquals(calls[0].headers.authorization, `Bearer ${API_KEY}`);
  assertStringIncludes(calls[0].headers.accept, "application/json");
  assertStringIncludes(calls[0].headers.accept, "text/event-stream");
  assertEquals(calls[0].body.method, "tools/call");
  assertEquals(calls[0].body.params, {
    name: "read_inbox",
    arguments: { limit: 10 },
  });
});

Deno.test("ai-sdk: searchMessages passes the query and the limit", async () => {
  const { fetch, calls } = fakeFetch(() => structured({ messages: [] }));
  const { searchMessages } = atomicMailTools({ apiKey: API_KEY, fetch });

  const result = await run(searchMessages, { query: "invoice", limit: 3 });

  assertEquals(result, { messages: [] });
  assertEquals(calls[0].body.params, {
    name: "search_messages",
    arguments: { query: "invoice", limit: 3 },
  });
});

Deno.test("ai-sdk: an answer without a message list is an error", async () => {
  const { fetch } = fakeFetch(() => structured({ note: "nothing" }));
  const { readInbox } = atomicMailTools({ apiKey: API_KEY, fetch });

  await assertRejects(
    () => run(readInbox, {}),
    AtomicMailError,
    "without a message list",
  );
});

Deno.test("ai-sdk: readMessage returns the message as the server sent it", async () => {
  const message = { id: "M1", subject: "Hello", body: "<<untrusted>>Hi" };
  const { fetch, calls } = fakeFetch(() => structured(message));
  const { readMessage } = atomicMailTools({ apiKey: API_KEY, fetch });

  assertEquals(await run(readMessage, { messageId: "M1" }), message);
  assertEquals(calls[0].body.params, {
    name: "read_message",
    arguments: { message_id: "M1" },
  });
});

Deno.test("ai-sdk: sendEmail maps the fields and returns the stored ids", async () => {
  const { fetch, calls } = fakeFetch(() =>
    toolAnswer({ content: [{ type: "text", text: SEND_ANSWER }] })
  );
  const { sendEmail } = atomicMailTools({ apiKey: API_KEY, fetch });

  const result = await run(sendEmail, {
    to: ["anna@example.com", "bob@example.com"],
    subject: "Hello",
    body: "Hi",
    cc: [],
    htmlBody: "<p>Hi</p>",
    fromName: "Anna from Acme",
    replyTo: ["team@example.com"],
  });

  assertEquals(result, { sent: true, messageId: "M1", threadId: "T1" });
  assertEquals(calls[0].body.params, {
    name: "send_email",
    arguments: {
      to: ["anna@example.com", "bob@example.com"],
      subject: "Hello",
      body: "Hi",
      html_body: "<p>Hi</p>",
      from_name: "Anna from Acme",
      reply_to: ["team@example.com"],
    },
  });
});

Deno.test("ai-sdk: a send answer in an unknown shape still reports sent", async () => {
  const { fetch } = fakeFetch(() =>
    toolAnswer({ content: [{ type: "text", text: "Sent." }] })
  );
  const { sendEmail } = atomicMailTools({ apiKey: API_KEY, fetch });

  assertEquals(
    await run(sendEmail, { to: ["a@example.com"], subject: "s", body: "b" }),
    { sent: true },
  );
});

Deno.test("ai-sdk: replyToMessage replies by message id", async () => {
  const { fetch, calls } = fakeFetch(() =>
    toolAnswer({ content: [{ type: "text", text: SEND_ANSWER }] })
  );
  const { replyToMessage } = atomicMailTools({ apiKey: API_KEY, fetch });

  const result = await run(replyToMessage, { messageId: "M0", body: "Thanks" });

  assertEquals(result, { sent: true, messageId: "M1", threadId: "T1" });
  assertEquals(calls[0].body.params, {
    name: "reply_to_message",
    arguments: { message_id: "M0", body: "Thanks" },
  });
});

Deno.test("ai-sdk: a missing key makes no request", async () => {
  const saved = Deno.env.get("ATOMIC_MAIL_API_KEY");
  Deno.env.delete("ATOMIC_MAIL_API_KEY");
  try {
    const { fetch, calls } = fakeFetch(() => structured({ messages: [] }));
    const { readInbox } = atomicMailTools({ fetch });

    await assertRejects(
      () => run(readInbox, {}),
      AtomicMailError,
      "ATOMIC_MAIL_API_KEY",
    );
    assertEquals(calls.length, 0);
  } finally {
    if (saved !== undefined) Deno.env.set("ATOMIC_MAIL_API_KEY", saved);
  }
});

Deno.test("ai-sdk: the key is read from the environment at call time", async () => {
  const saved = Deno.env.get("ATOMIC_MAIL_API_KEY");
  const { fetch, calls } = fakeFetch(() => structured({ messages: [] }));
  const { readInbox } = atomicMailTools({ fetch });
  Deno.env.set("ATOMIC_MAIL_API_KEY", "am_env_key");
  try {
    await run(readInbox, {});
    assertEquals(calls[0].headers.authorization, "Bearer am_env_key");
  } finally {
    if (saved === undefined) Deno.env.delete("ATOMIC_MAIL_API_KEY");
    else Deno.env.set("ATOMIC_MAIL_API_KEY", saved);
  }
});

Deno.test("ai-sdk: a rejected key and a rate limit have clear messages", async () => {
  const rejected = fakeFetch(() => json({ error: "invalid_token" }, 401));
  const error = await assertRejects(
    () =>
      run(
        atomicMailTools({ apiKey: API_KEY, fetch: rejected.fetch }).readInbox,
        {},
      ),
    AtomicMailError,
    "rejected the API key",
  );
  assertEquals(error.status, 401);

  const limited = fakeFetch(() => json({ error: "slow down" }, 429));
  await assertRejects(
    () =>
      run(
        atomicMailTools({ apiKey: API_KEY, fetch: limited.fetch }).readInbox,
        {},
      ),
    AtomicMailError,
    "rate limit",
  );
});

Deno.test("ai-sdk: another status keeps the server message without the key", async () => {
  const { fetch } = fakeFetch(() =>
    json({ error: { message: `bad gateway for ${API_KEY}` } }, 502)
  );
  const error = await assertRejects(
    () => run(atomicMailTools({ apiKey: API_KEY, fetch }).readInbox, {}),
    AtomicMailError,
    "Atomic Mail API error (502): bad gateway for ***",
  );
  assert(!error.message.includes(API_KEY));
});

Deno.test("ai-sdk: a refused tool call is thrown with the server text", async () => {
  const { fetch } = fakeFetch(() =>
    toolAnswer({
      isError: true,
      content: [{ type: "text", text: "Message not found." }],
    })
  );
  await assertRejects(
    () =>
      run(atomicMailTools({ apiKey: API_KEY, fetch }).readMessage, {
        messageId: "x",
      }),
    AtomicMailError,
    "Message not found.",
  );
});

Deno.test("ai-sdk: protocol errors, non-JSON and a missing result are errors", async () => {
  const protocol = fakeFetch(() =>
    json({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32602, message: "Invalid arguments" },
    })
  );
  await assertRejects(
    () =>
      run(
        atomicMailTools({ apiKey: API_KEY, fetch: protocol.fetch }).readInbox,
        {},
      ),
    AtomicMailError,
    "refused the request: Invalid arguments",
  );

  const html = fakeFetch(() => new Response("<html>bad gateway</html>"));
  await assertRejects(
    () =>
      run(
        atomicMailTools({ apiKey: API_KEY, fetch: html.fetch }).readInbox,
        {},
      ),
    AtomicMailError,
    "not JSON",
  );

  const empty = fakeFetch(() => json({ jsonrpc: "2.0", id: 1 }));
  await assertRejects(
    () =>
      run(
        atomicMailTools({ apiKey: API_KEY, fetch: empty.fetch }).readInbox,
        {},
      ),
    AtomicMailError,
    "without a result",
  );
});

Deno.test("ai-sdk: a stream is read event by event", async () => {
  const notice = {
    jsonrpc: "2.0",
    method: "notifications/message",
    params: { level: "info", data: "working" },
  };
  const answer = {
    jsonrpc: "2.0",
    id: 1,
    result: { structuredContent: { messages: MESSAGES } },
  };
  const stream = (text: string) =>
    new Response(text, { headers: { "content-type": "text/event-stream" } });

  const both = fakeFetch(() =>
    stream(
      `event: message\ndata: ${JSON.stringify(notice)}\n\n` +
        `event: message\r\ndata: ${JSON.stringify(answer)}\r\n\r\n`,
    )
  );
  assertEquals(
    await run(
      atomicMailTools({ apiKey: API_KEY, fetch: both.fetch }).readInbox,
      {},
    ),
    { messages: MESSAGES },
  );

  const onlyNotice = fakeFetch(() =>
    stream(`data: ${JSON.stringify(notice)}\n\n`)
  );
  await assertRejects(
    () =>
      run(
        atomicMailTools({ apiKey: API_KEY, fetch: onlyNotice.fetch }).readInbox,
        {},
      ),
    AtomicMailError,
    "without an answer",
  );
});

Deno.test("ai-sdk: a timeout and a network failure are reported", async () => {
  const slow = fakeFetch((call) =>
    new Promise<Response>((_, reject) => {
      call.signal?.addEventListener("abort", () => reject(call.signal?.reason));
    })
  );
  await assertRejects(
    () =>
      run(
        atomicMailTools({ apiKey: API_KEY, fetch: slow.fetch, timeout: 20 })
          .readInbox,
        {},
      ),
    AtomicMailError,
    "did not answer in 0.02 seconds",
  );

  const down = fakeFetch(() => {
    throw new TypeError(`connect failed with ${API_KEY}`);
  });
  const error = await assertRejects(
    () =>
      run(
        atomicMailTools({ apiKey: API_KEY, fetch: down.fetch }).readInbox,
        {},
      ),
    AtomicMailError,
    "Could not reach Atomic Mail",
  );
  assert(!error.message.includes(API_KEY));
});

Deno.test("ai-sdk: generateText runs a tool and gives the model its result", async () => {
  const { fetch, calls } = fakeFetch(() => structured({ messages: MESSAGES }));
  const usage = {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  };
  let step = 0;
  // deno-lint-ignore no-explicit-any
  const prompts: any[] = [];
  const model = new MockLanguageModelV4({
    // deno-lint-ignore no-explicit-any
    doGenerate: (options: any) => {
      prompts.push(options.prompt);
      step++;
      return Promise.resolve(
        step === 1
          ? {
            content: [{
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "readInbox",
              input: JSON.stringify({ limit: 1 }),
            }],
            finishReason: { unified: "tool-calls", raw: undefined },
            usage,
            warnings: [],
          }
          : {
            content: [{ type: "text", text: "One new message from Anna." }],
            finishReason: { unified: "stop", raw: undefined },
            usage,
            warnings: [],
          },
        // deno-lint-ignore no-explicit-any
      ) as any;
    },
  });

  const { text, steps } = await generateText({
    model,
    prompt: "What is new in my inbox?",
    tools: atomicMailTools({ apiKey: API_KEY, fetch }),
    stopWhen: isStepCount(3),
  });

  assertEquals(text, "One new message from Anna.");
  assertEquals(steps.length, 2);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].body.params.arguments, { limit: 1 });
  assertStringIncludes(JSON.stringify(prompts[1]), "anna@example.com");
});

Deno.test("ai-sdk: toolApproval on the call holds a send for approval", async () => {
  const { fetch, calls } = fakeFetch(() =>
    toolAnswer({ content: [{ type: "text", text: SEND_ANSWER }] })
  );
  const model = new MockLanguageModelV4({
    doGenerate: () =>
      Promise.resolve({
        content: [{
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "sendEmail",
          input: JSON.stringify({
            to: ["anna@example.com"],
            subject: "Hello",
            body: "Hi",
          }),
        }],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
        // deno-lint-ignore no-explicit-any
      }) as any,
  });

  const result = await generateText({
    model,
    prompt: "Email Anna.",
    tools: atomicMailTools({ apiKey: API_KEY, fetch }),
    toolApproval: {
      sendEmail: "user-approval",
      replyToMessage: "user-approval",
    },
    stopWhen: isStepCount(3),
  });

  assertEquals(calls.length, 0);
  assert(
    result.content.some((part) => part.type === "tool-approval-request"),
  );
});
