import { assertEquals, assertRejects } from "@std/assert";

import { readSharedText } from "../../core/shared-assets.ts";
import { substituteVars } from "./agent-vars.ts";
import {
  fetchReplyContext,
  replyContextResolvers,
  replySubject,
} from "./reply-context.ts";

function postReturning(email: Record<string, unknown> | undefined) {
  const calls: unknown[] = [];
  const post = (envelope: unknown) => {
    calls.push(envelope);
    const body = {
      methodResponses: [["Email/get", { list: email ? [email] : [] }, "rg0"]],
    };
    return Promise.resolve({
      ok: true,
      status: 200,
      bodyText: JSON.stringify(body),
    });
  };
  return { post, calls };
}

const ORIGINAL = {
  from: [{ name: null, email: "alice@example.com" }],
  replyTo: null,
  subject: "Invoice 42",
  messageId: ["abc@example.com"],
};

Deno.test("replySubject adds a single Re: prefix", () => {
  assertEquals(replySubject("Invoice 42"), "Re: Invoice 42");
  assertEquals(replySubject("RE: Invoice 42"), "RE: Invoice 42");
  assertEquals(replySubject(null), "Re:");
});

Deno.test("fetchReplyContext uses From when Reply-To is null", async () => {
  const { post } = postReturning(ORIGINAL);
  assertEquals(await fetchReplyContext(post, "acc", "M1"), {
    to: "alice@example.com",
    subject: "Re: Invoice 42",
    messageId: "abc@example.com",
  });
});

Deno.test("fetchReplyContext prefers Reply-To over From", async () => {
  const { post } = postReturning({
    ...ORIGINAL,
    replyTo: [{ email: "billing@example.com" }],
  });
  assertEquals(
    (await fetchReplyContext(post, "acc", "M1")).to,
    "billing@example.com",
  );
});

Deno.test("fetchReplyContext errors without MAIL_ID or message", async () => {
  const { post } = postReturning(undefined);
  await assertRejects(() => fetchReplyContext(post, "acc", undefined));
  await assertRejects(() => fetchReplyContext(post, "acc", "missing"));
});

Deno.test("reply.json resolves with one Email/get and no nested refs", async () => {
  const raw = readSharedText("presets/reply.json");
  const { post, calls } = postReturning(ORIGINAL);
  const { text } = await substituteVars({
    raw,
    vars: {
      ACCOUNT_ID: "acc",
      INBOX: "me@atomicmail.ai",
      SENT_MAILBOX_ID: "mb-sent",
      MAIL_ID: "M1",
      BODY: "Thanks",
    },
    autoResolvers: replyContextResolvers(() =>
      fetchReplyContext(post, "acc", "M1")
    ),
  });
  assertEquals(calls.length, 1);
  const envelope = JSON.parse(text);
  const [, emailSet] = envelope.methodCalls[0];
  const draft = emailSet.create.d1;
  assertEquals(draft.to, [{ email: "alice@example.com" }]);
  assertEquals(draft.subject, "Re: Invoice 42");
  assertEquals(draft.inReplyTo, ["abc@example.com"]);
  assertEquals(draft.references, ["abc@example.com"]);
  assertEquals(Object.keys(draft).some((k) => k.startsWith("#")), false);
  const [, submission] = envelope.methodCalls[1];
  assertEquals(submission.create.s1.envelope.rcptTo, [{
    email: "alice@example.com",
  }]);
});
