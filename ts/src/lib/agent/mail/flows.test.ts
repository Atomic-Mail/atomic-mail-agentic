import {
  assertEquals,
  assertObjectMatch,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";

import {
  answerReply,
  fakeSession,
  installFakeJmap,
  type JmapEnvelopeSeen,
  SENT_RESPONSE,
} from "./fake-jmap.ts";
import {
  assertAgentId,
  listAgents,
  MailError,
  mailRunnerForSession,
  readInbox,
  readMessage,
  replyToMessage,
  searchMessages,
  sendEmail,
} from "./runner.ts";

async function withFake<T>(
  answer: (batch: JmapEnvelopeSeen) => unknown,
  fn: (
    runner: Awaited<ReturnType<typeof mailRunnerForSession>>,
    fake: ReturnType<typeof installFakeJmap>,
  ) => Promise<T>,
): Promise<T> {
  const fake = installFakeJmap(answer);
  try {
    return await fn(await mailRunnerForSession(fakeSession()), fake);
  } finally {
    fake.restore();
  }
}

const LIST_RESPONSE = {
  methodResponses: [
    ["Email/query", { ids: ["e1"] }, "q0"],
    ["Email/get", {
      list: [{
        id: "e1",
        threadId: "t1",
        subject: "Hello",
        preview: "hi",
        from: [{ email: "s@x.com", name: null }],
        to: [{ email: "alice@atomicmail.ai", name: null }],
        receivedAt: "2026-01-01T00:00:00Z",
        keywords: {},
      }],
    }, "g0"],
  ],
};

Deno.test("readInbox: inbox filter, default limit, clean rows", () =>
  withFake(() => LIST_RESPONSE, async (runner, fake) => {
    const { messages } = await readInbox(runner);
    assertEquals(fake.batches[0].methodCalls[0][1].filter, {
      inMailbox: "mb-inbox",
    });
    assertEquals(fake.batches[0].methodCalls[0][1].limit, 25);
    assertEquals(messages.length, 1);
    assertObjectMatch(messages[0], { id: "e1", unread: true });
  }));

Deno.test("readInbox: a limit out of range never reaches the server", () =>
  withFake(() => LIST_RESPONSE, async (runner, fake) => {
    for (const limit of [0, 51, 1.5]) {
      await assertRejects(() => readInbox(runner, { limit }), MailError);
    }
    assertEquals(fake.batches.length, 0);
  }));

Deno.test("readInbox: an HTTP failure is a MailError with the status", () =>
  withFake(() => ({ status: 429 }), async (runner) => {
    const err = await assertRejects(() => readInbox(runner), MailError);
    assertStringIncludes(err.message, "HTTP 429");
  }));

Deno.test("searchMessages: the query goes through vars", () =>
  withFake(() => LIST_RESPONSE, async (runner, fake) => {
    await searchMessages(runner, { query: 'in"voice $INBOX', limit: 3 });
    const [, args] = fake.batches[0].methodCalls[0];
    assertEquals(args.filter, { text: 'in"voice $INBOX' });
    assertEquals(args.limit, 3);
  }));

Deno.test("readMessage: untrusted wrapper; unknown id is a MailError", async () => {
  await withFake(() => ({
    methodResponses: [["Email/get", {
      list: [{
        id: "e1",
        textBody: [{ partId: "1", type: "text/plain" }],
        bodyValues: { "1": { value: "text" } },
      }],
    }, "g0"]],
  }), async (runner) => {
    const doc = await readMessage(runner, { messageId: "e1" });
    assertStringIncludes(doc.body, "UNTRUSTED");
    assertStringIncludes(doc.body, "text");
  });
  await withFake(
    () => ({ methodResponses: [["Email/get", { list: [] }, "g0"]] }),
    async (runner) => {
      const err = await assertRejects(
        () => readMessage(runner, { messageId: "zz" }),
        MailError,
      );
      assertStringIncludes(err.message, "not found");
    },
  );
});

Deno.test("sendEmail: batch filed in Sent, result names what was sent", () =>
  withFake(() => SENT_RESPONSE, async (runner, fake) => {
    const out = await sendEmail(runner, {
      to: "Anna <Anna@x.com>, b@x.com",
      cc: ["c@x.com"],
      subject: "Hi",
      body: "Hello",
    });
    assertEquals(out, {
      sent: true,
      id: "M-sent",
      threadId: "T-sent",
      to: ["anna@x.com", "b@x.com"],
      subject: "Hi",
    });
    const [set, submission] = fake.batches[0].methodCalls;
    const d1 = set[1].create.d1;
    assertEquals(d1.mailboxIds, { "mb-sent": true });
    assertEquals(d1.from, [{ email: "alice@atomicmail.ai" }]);
    assertEquals(d1.to, [
      { email: "anna@x.com", name: "Anna" },
      { email: "b@x.com" },
    ]);
    assertEquals(d1.cc, [{ email: "c@x.com" }]);
    assertEquals(d1.subject, "Hi");
    assertEquals(d1.bodyValues.b.value, "Hello");
    assertEquals(submission[1].create.s1.envelope.rcptTo, [
      { email: "anna@x.com" },
      { email: "b@x.com" },
      { email: "c@x.com" },
    ]);
  }));

Deno.test("sendEmail: HTML, From name and Reply-To reach the draft", () =>
  withFake(() => SENT_RESPONSE, async (runner, fake) => {
    await sendEmail(runner, {
      to: "a@x.com",
      subject: "Hi",
      html_body: "<p>Hello <b>you</b></p>",
      from_name: "Anna from Acme",
      reply_to: "Help <help@x.com>",
    });
    const d1 = fake.batches[0].methodCalls[0][1].create.d1;
    assertEquals(d1.from, [{
      email: "alice@atomicmail.ai",
      name: "Anna from Acme",
    }]);
    assertEquals(d1.replyTo, [{ email: "help@x.com", name: "Help" }]);
    assertEquals(d1.htmlBody, [{ partId: "h", type: "text/html" }]);
    assertEquals(d1.bodyValues.h.value, "<p>Hello <b>you</b></p>");
    // Never HTML-only: the text part is derived.
    assertEquals(d1.textBody, [{ partId: "b", type: "text/plain" }]);
    assertEquals(d1.bodyValues.b.value, "Hello you");
  }));

Deno.test("sendEmail: bad input is refused before anything is sent", () =>
  withFake(() => SENT_RESPONSE, async (runner, fake) => {
    const bad = [
      { to: [], subject: "s", body: "b" },
      { to: "nope", subject: "s", body: "b" },
      { to: "a@x.com", cc: "nope", subject: "s", body: "b" },
      { to: "a@x.com", subject: "s" },
      { to: "a@x.com", subject: "s", body: "b", from_name: "ceo@bank.com" },
      { to: "a@x.com", subject: "s", body: "b", reply_to: "nope" },
    ];
    for (const input of bad) {
      await assertRejects(() => sendEmail(runner, input), MailError);
    }
    assertEquals(fake.batches.length, 0);
  }));

Deno.test("sendEmail: a JMAP rejection is an error, not a success", () =>
  withFake(() => ({
    methodResponses: [["Email/set", {
      notCreated: { d1: { type: "forbiddenFrom", description: "no" } },
    }, "c0"]],
  }), async (runner) => {
    const err = await assertRejects(
      () => sendEmail(runner, { to: "a@x.com", subject: "s", body: "b" }),
      MailError,
    );
    assertStringIncludes(err.message, "forbiddenFrom");
  }));

Deno.test("sendEmail: base64 and path attachments are uploaded first", async () => {
  const dir = await Deno.makeTempDir({ prefix: "atomicmail-mail-" });
  try {
    await Deno.writeTextFile(`${dir}/note.txt`, "from disk");
    await withFake(() => SENT_RESPONSE, async (runner, fake) => {
      await sendEmail(runner, {
        to: "a@x.com",
        subject: "s",
        body: "b",
        attachments: [
          { path: `${dir}/note.txt` },
          { dataBase64: btoa("inline"), filename: "a.pdf" },
        ],
      });
      assertEquals(
        fake.uploads.map((u) => new TextDecoder().decode(u.bytes)),
        ["from disk", "inline"],
      );
      assertEquals(fake.uploads[1].type, "application/pdf");
      assertEquals(fake.batches[0].methodCalls[0][1].create.d1.attachments, [
        {
          blobId: "blob1",
          type: "text/plain",
          name: "note.txt",
          charset: "utf-8", // the client's RFC 8621 rule for text/* blobs
        },
        { blobId: "blob2", type: "application/pdf", name: "a.pdf" },
      ]);
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("sendEmail: an attachment needs one source and a name", () =>
  withFake(() => SENT_RESPONSE, async (runner, fake) => {
    const send = (attachment: Record<string, string>) =>
      sendEmail(runner, {
        to: "a@x.com",
        subject: "s",
        body: "b",
        attachments: [attachment],
      });
    await assertRejects(() => send({}), Error, "exactly one");
    await assertRejects(
      () => send({ path: "/x", dataBase64: "QQ==" }),
      Error,
      "exactly one",
    );
    await assertRejects(
      () => send({ dataBase64: "QQ==" }),
      Error,
      "needs a filename",
    );
    await assertRejects(
      () => send({ dataBase64: "@@@", filename: "a.bin" }),
      Error,
      "not valid base64",
    );
    assertEquals(fake.uploads.length, 0);
    assertEquals(fake.batches.length, 0);
  }));

Deno.test("replyToMessage: lookup, then a threaded send with concrete headers", () =>
  withFake(answerReply(), async (runner, fake) => {
    const out = await replyToMessage(runner, {
      messageId: "m1",
      body: "Thanks!",
    });
    assertEquals(out, {
      sent: true,
      id: "M-sent",
      threadId: "T-sent",
      to: ["mate@getmate.ai"],
      subject: "Re: Inbox Setup",
    });
    assertEquals(fake.batches.length, 2);
    assertEquals(fake.batches[0].methodCalls[0][0], "Email/get");
    assertEquals(fake.batches[0].methodCalls[0][1].ids, ["m1"]);
    const [set, submission] = fake.batches[1].methodCalls;
    const d1 = set[1].create.d1;
    // No nested result references: the server refuses those.
    assertEquals(Object.keys(d1).some((k) => k.startsWith("#")), false);
    assertEquals(d1.to, [{ email: "mate@getmate.ai", name: "Mate" }]);
    assertEquals(d1.subject, "Re: Inbox Setup");
    assertEquals(d1.inReplyTo, ["orig-1@getmate.ai"]);
    assertEquals(d1.references, ["root-0@getmate.ai", "orig-1@getmate.ai"]);
    assertEquals(d1.mailboxIds, { "mb-sent": true });
    assertEquals(submission[1].create.s1.envelope.rcptTo, [
      { email: "mate@getmate.ai" },
    ]);
  }));

Deno.test("replyToMessage: HTML, From name and Reply-To reach the draft", () =>
  withFake(answerReply(), async (runner, fake) => {
    await replyToMessage(runner, {
      messageId: "m1",
      html_body: "<p>Thanks <i>a lot</i></p>",
      from_name: "Bob",
      reply_to: "help@x.com",
    });
    const d1 = fake.batches[1].methodCalls[0][1].create.d1;
    assertEquals(d1.from, [{ email: "alice@atomicmail.ai", name: "Bob" }]);
    assertEquals(d1.replyTo, [{ email: "help@x.com" }]);
    assertEquals(d1.bodyValues.h.value, "<p>Thanks <i>a lot</i></p>");
    assertEquals(d1.bodyValues.b.value, "Thanks a lot");
  }));

Deno.test("replyToMessage: bad input stops before the lookup", () =>
  withFake(answerReply(), async (runner, fake) => {
    await assertRejects(
      () => replyToMessage(runner, { messageId: "m1" }),
      MailError,
    );
    assertEquals(fake.batches.length, 0);
  }));

Deno.test("replyToMessage: unknown id and rejected send are MailErrors", async () => {
  await withFake(
    () => ({ methodResponses: [["Email/get", { list: [] }, "g0"]] }),
    async (runner, fake) => {
      await assertRejects(
        () => replyToMessage(runner, { messageId: "zz", body: "b" }),
        MailError,
        "not found",
      );
      assertEquals(fake.batches.length, 1);
    },
  );
  await withFake(
    (batch) =>
      batch.methodCalls[0][0] === "Email/get" ? answerReply()(batch) : {
        methodResponses: [[
          "EmailSubmission/set",
          { notCreated: { s1: { type: "forbiddenToSend" } } },
          "c1",
        ]],
      },
    async (runner) => {
      await assertRejects(
        () => replyToMessage(runner, { messageId: "m1", body: "b" }),
        MailError,
        "forbiddenToSend",
      );
    },
  );
});

Deno.test("listAgents: the one inbox these credentials hold", async () => {
  const runner = await mailRunnerForSession(fakeSession());
  assertEquals(listAgents(runner), {
    agents: [{
      accountId: "alice",
      inboxId: "alice",
      email: "alice@atomicmail.ai",
    }],
  });
});

Deno.test("assertAgentId: own inbox passes in any form, others are refused", async () => {
  const runner = await mailRunnerForSession(fakeSession());
  for (const id of [undefined, "", "alice", "ALICE@atomicmail.ai"]) {
    assertAgentId(runner, id);
  }
  assertThrows(
    () => assertAgentId(runner, "bob"),
    MailError,
    "cannot act as agent_id 'bob'",
  );
});
