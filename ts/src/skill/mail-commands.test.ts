import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";

import {
  answerReply,
  fakeSession,
  installFakeJmap,
  type JmapEnvelopeSeen,
  SENT_RESPONSE,
} from "../lib/agent/mail/fake-jmap.ts";
import { MailError } from "../lib/mod.ts";
import {
  CliUsageError,
  isMailCommand,
  MAIL_COMMANDS,
  MAIL_HELP,
  type MailCommand,
  runMailCommand,
} from "./mail-commands.ts";

async function run(
  cmd: MailCommand,
  argv: string[],
  answer: (batch: JmapEnvelopeSeen) => unknown = () => SENT_RESPONSE,
) {
  const fake = installFakeJmap(answer);
  const dirs: (string | undefined)[] = [];
  try {
    const out = await runMailCommand(cmd, argv, (dir) => {
      dirs.push(dir);
      return Promise.resolve(fakeSession());
    });
    return { out, fake, dirs };
  } finally {
    fake.restore();
  }
}

const LIST_RESPONSE = {
  methodResponses: [
    ["Email/query", { ids: ["e1"] }, "q0"],
    [
      "Email/get",
      { list: [{ id: "e1", subject: "Hello", keywords: {} }] },
      "g0",
    ],
  ],
};

Deno.test("isMailCommand: names the same as the MCP tools", () => {
  assertEquals([...MAIL_COMMANDS].sort(), [
    "list_agents",
    "read_inbox",
    "read_message",
    "reply_to_message",
    "search_messages",
    "send_email",
  ]);
  assertEquals(isMailCommand("send_email"), true);
  assertEquals(isMailCommand("jmap_request"), false);
});

Deno.test("--help on every command, without loading a session", async () => {
  for (const cmd of MAIL_COMMANDS) {
    const { out, dirs } = await run(cmd, ["--help"]);
    assertEquals(out, MAIL_HELP);
    assertEquals(dirs, []);
  }
});

Deno.test("read_inbox: --limit and --credentials-dir", async () => {
  const { out, fake, dirs } = await run(
    "read_inbox",
    ["--limit", "5", "--credentials-dir", "/x"],
    () => LIST_RESPONSE,
  );
  assertEquals(dirs, ["/x"]);
  assertEquals(fake.batches[0].methodCalls[0][1].limit, 5);
  assertEquals(JSON.parse(out).messages[0].id, "e1");
});

Deno.test("search_messages: --query", async () => {
  const { fake } = await run(
    "search_messages",
    ["--query", "invoice"],
    () => LIST_RESPONSE,
  );
  assertEquals(fake.batches[0].methodCalls[0][1].filter, { text: "invoice" });
});

Deno.test("read_message: --message-id", async () => {
  const { out, fake } = await run(
    "read_message",
    ["--message-id", "e1"],
    () => LIST_RESPONSE,
  );
  assertEquals(fake.batches[0].methodCalls[0][1].ids, ["e1"]);
  assertEquals(JSON.parse(out).id, "e1");
});

Deno.test("send_email: every flag reaches the draft", async () => {
  const { out, fake } = await run("send_email", [
    "--to",
    "a@x.com,b@x.com",
    "--to",
    "Carol <c@x.com>",
    "--cc",
    "d@x.com",
    "--bcc",
    "e@x.com",
    "--subject",
    "Hi",
    "--body",
    "Hello",
    "--html-body",
    "<p>Hello</p>",
    "--from-name",
    "Anna",
    "--reply-to",
    "help@x.com",
  ]);
  assertEquals(JSON.parse(out).to, ["a@x.com", "b@x.com", "c@x.com"]);
  const d1 = fake.batches[0].methodCalls[0][1].create.d1;
  assertEquals(d1.to, [
    { email: "a@x.com" },
    { email: "b@x.com" },
    { email: "c@x.com", name: "Carol" },
  ]);
  assertEquals(d1.cc, [{ email: "d@x.com" }]);
  assertEquals(d1.bcc, [{ email: "e@x.com" }]);
  assertEquals(d1.from[0].name, "Anna");
  assertEquals(d1.replyTo, [{ email: "help@x.com" }]);
  assertEquals(d1.bodyValues.b.value, "Hello");
  assertEquals(d1.bodyValues.h.value, "<p>Hello</p>");
});

Deno.test("send_email: bodies and attachments from files", async () => {
  const dir = await Deno.makeTempDir({ prefix: "atomicmail-cli-" });
  try {
    await Deno.writeTextFile(`${dir}/mail.html`, "<p>From a <b>file</b></p>");
    await Deno.writeTextFile(`${dir}/note.txt`, "attached");
    const { fake } = await run("send_email", [
      "--to",
      "a@x.com",
      "--subject",
      "Hi",
      "--html-body-file",
      `${dir}/mail.html`,
      "--attachment",
      "note.txt",
      "--attachment-path-base",
      dir,
    ]);
    const d1 = fake.batches[0].methodCalls[0][1].create.d1;
    assertEquals(d1.bodyValues.h.value, "<p>From a <b>file</b></p>");
    assertEquals(d1.bodyValues.b.value, "From a file");
    assertEquals(d1.attachments[0].name, "note.txt");
    assertEquals(new TextDecoder().decode(fake.uploads[0].bytes), "attached");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("reply_to_message: looks up, then replies", async () => {
  const { out, fake } = await run(
    "reply_to_message",
    ["--message-id", "m1", "--body", "Thanks", "--from-name", "Bob"],
    answerReply(),
  );
  assertEquals(JSON.parse(out).subject, "Re: Inbox Setup");
  assertEquals(fake.batches.length, 2);
  assertEquals(fake.batches[1].methodCalls[0][1].create.d1.from[0].name, "Bob");
});

Deno.test("list_agents: prints the inbox", async () => {
  const { out } = await run("list_agents", []);
  assertEquals(JSON.parse(out).agents[0].email, "alice@atomicmail.ai");
});

Deno.test("--agent-id: another inbox's id is refused", async () => {
  await assertRejects(
    () => run("read_inbox", ["--agent-id", "bob"], () => LIST_RESPONSE),
    MailError,
    "cannot act as agent_id",
  );
});

Deno.test("usage errors stop before any session or request", async () => {
  const cases: [MailCommand, string[], string][] = [
    ["read_inbox", ["--limit", "99"], "--limit"],
    ["read_inbox", ["--limit", "abc"], "--limit"],
    ["read_inbox", ["--to", "a@x.com"], "--to"],
    ["read_message", [], "--message-id"],
    ["search_messages", [], "--query"],
    ["send_email", ["--subject", "s", "--body", "b"], "--to"],
    ["send_email", ["--to", "a@x.com", "--body", "b"], "--subject"],
    ["reply_to_message", ["--body", "b"], "--message-id"],
    ["list_agents", ["--agent-id", "x"], "--agent-id"],
    ["read_inbox", ["stray"], "stray"],
    [
      "send_email",
      ["--to", "a@x.com", "--subject", "s", "--body", "b", "--body-file", "f"],
      "not both",
    ],
    [
      "send_email",
      ["--to", "a@x.com", "--subject", "s", "--html-body-file", "/no/such"],
      "--html-body-file",
    ],
  ];
  for (const [cmd, argv, expected] of cases) {
    const fake = installFakeJmap(() => SENT_RESPONSE);
    let sessions = 0;
    try {
      const err = await assertRejects(
        () =>
          runMailCommand(cmd, argv, () => {
            sessions += 1;
            return Promise.resolve(fakeSession());
          }),
        CliUsageError,
      );
      assertStringIncludes(err.message, expected);
      assertEquals(sessions, 0);
      assertEquals(fake.batches.length, 0);
    } finally {
      fake.restore();
    }
  }
});
