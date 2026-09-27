import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";

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

Deno.test("replySubject matches the hosted server rule", () => {
  assertEquals(replySubject("  re : Invoice 42"), "re : Invoice 42");
  assertEquals(replySubject(" Re:Invoice"), "Re:Invoice");
  assertEquals(replySubject("Invoice\r\n\r\n 42\n"), "Re: Invoice  42");
  assertEquals(replySubject("Line one\nLine two"), "Re: Line one Line two");
  assertEquals(replySubject("Regarding lunch"), "Re: Regarding lunch");
  assertEquals(replySubject(""), "Re:");
});

Deno.test("fetchReplyContext skips unusable addresses and trims", async () => {
  const { post } = postReturning({
    ...ORIGINAL,
    replyTo: [{ email: "  " }, { email: null }, { email: " b@example.com " }],
  });
  assertEquals(
    (await fetchReplyContext(post, "acc", "M1")).to,
    "b@example.com",
  );
});

Deno.test("fetchReplyContext scans all of From before Sender", async () => {
  const { post } = postReturning({
    ...ORIGINAL,
    replyTo: [{ email: "" }],
    from: [{ email: " " }, { email: "second@example.com" }],
    sender: [{ email: "sender@example.com" }],
  });
  assertEquals(
    (await fetchReplyContext(post, "acc", "M1")).to,
    "second@example.com",
  );
});

Deno.test("fetchReplyContext falls back to Sender and requests it", async () => {
  const { post, calls } = postReturning({
    ...ORIGINAL,
    from: [{ email: "" }],
    sender: [{ email: "list@example.com" }],
  });
  assertEquals(
    (await fetchReplyContext(post, "acc", "M1")).to,
    "list@example.com",
  );
  const [[, args]] = (calls[0] as {
    methodCalls: [string, { properties: string[] }, string][];
  }).methodCalls;
  assertEquals(args.properties.includes("sender"), true);
});

Deno.test("fetchReplyContext reports a JMAP error response", async () => {
  const post = () =>
    Promise.resolve({
      ok: true,
      status: 200,
      bodyText: JSON.stringify({
        methodResponses: [["error", { type: "accountNotFound" }, "rg0"]],
      }),
    });
  const err = await assertRejects(() => fetchReplyContext(post, "acc", "M1"));
  assertEquals(
    (err as Error).message,
    'Email/get for reply failed: {"type":"accountNotFound"}',
  );
});

Deno.test("fetchReplyContext without Message-ID points to send_mail", async () => {
  const { post } = postReturning({ ...ORIGINAL, messageId: null });
  const err = await assertRejects(() => fetchReplyContext(post, "acc", "M1"));
  assertStringIncludes(
    (err as Error).message,
    "; use send_mail.json with TO/SUBJECT instead.",
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
