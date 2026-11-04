import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";

import {
  fetchForwardContext,
  forwardContextResolvers,
  forwardFilename,
  forwardSubject,
} from "./forward-context.ts";

const answer = (list: unknown[]) => () =>
  Promise.resolve({
    ok: true,
    status: 200,
    bodyText: JSON.stringify({
      methodResponses: [["Email/get", { list }, "fg0"]],
    }),
  });

const ORIGINAL = {
  blobId: "G1",
  from: [{ email: "anna@x.com", name: "Anna" }],
  to: [{ email: "me@atomicmail.ai", name: null }],
  cc: null,
  subject: "Invoice",
  sentAt: "2026-11-04T10:00:00Z",
  textBody: [{ partId: "1", type: "text/plain" }],
  bodyValues: { "1": { value: "Line one\r\nLine two" } },
};

Deno.test("forwardSubject: one Fwd: prefix, no folded lines", () => {
  assertEquals(forwardSubject("Hi"), "Fwd: Hi");
  assertEquals(forwardSubject("FW: Hi"), "FW: Hi");
  assertEquals(forwardSubject("fwd: Hi"), "fwd: Hi");
  assertEquals(forwardSubject("a\r\nBcc: x@y.com"), "Fwd: a Bcc: x@y.com");
  assertEquals(forwardSubject(null), "Fwd:");
});

Deno.test("forwardFilename: safe, bounded, never empty", () => {
  assertEquals(forwardFilename("Invoice 12"), "Invoice 12.eml");
  assertEquals(forwardFilename('a/b\\c:"d"\r\n<e>'), "a b c d e.eml");
  assertEquals(forwardFilename(""), "message.eml");
  assertEquals(forwardFilename(null), "message.eml");
  assertEquals(forwardFilename("x".repeat(300)).length, 104);
});

Deno.test("fetchForwardContext: subject, quoted block, original's blob", async () => {
  const ctx = await fetchForwardContext(answer([ORIGINAL]), "acc", "m1");
  assertEquals(ctx.subject, "Fwd: Invoice");
  assertEquals(ctx.blobId, "G1");
  assertEquals(ctx.name, "Invoice.eml");
  assertEquals(
    ctx.text,
    [
      "---------- Forwarded message ---------",
      "From: Anna <anna@x.com>",
      "Date: 2026-11-04T10:00:00Z",
      "Subject: Invoice",
      "To: me@atomicmail.ai",
      "",
      "Line one",
      "Line two",
    ].join("\n"),
  );
});

Deno.test("fetchForwardContext: HTML-only original and a cut body", async () => {
  const ctx = await fetchForwardContext(
    answer([{
      ...ORIGINAL,
      cc: [{ email: "c@x.com" }],
      textBody: [{ partId: "1", type: "text/html" }],
      bodyValues: {
        "1": { value: "<p>Only <b>HTML</b></p>", isTruncated: true },
      },
    }]),
    "acc",
    "m1",
  );
  assertStringIncludes(ctx.text, "Cc: c@x.com");
  assertStringIncludes(ctx.text, "Only HTML");
  assertStringIncludes(ctx.text, "the full message is attached");
});

Deno.test("fetchForwardContext: asks for the right properties", async () => {
  let seen: Record<string, unknown> = {};
  await fetchForwardContext(
    (envelope) => {
      seen = envelope.methodCalls[0][1];
      return answer([ORIGINAL])();
    },
    "acc",
    "m1",
  );
  assertEquals(seen.accountId, "acc");
  assertEquals(seen.ids, ["m1"]);
  assertEquals(seen.fetchTextBodyValues, true);
  assertEquals((seen.properties as string[]).includes("blobId"), true);
});

Deno.test("fetchForwardContext: clear errors", async () => {
  await assertRejects(
    () => fetchForwardContext(answer([ORIGINAL]), "acc", undefined),
    Error,
    "need MAIL_ID",
  );
  await assertRejects(
    () => fetchForwardContext(answer([]), "acc", "m1"),
    Error,
    "not found",
  );
  await assertRejects(
    () =>
      fetchForwardContext(answer([{ ...ORIGINAL, blobId: null }]), "acc", "m1"),
    Error,
    "no blobId",
  );
  await assertRejects(
    () =>
      fetchForwardContext(
        () => Promise.resolve({ ok: false, status: 500, bodyText: "boom" }),
        "acc",
        "m1",
      ),
    Error,
    "HTTP 500",
  );
  await assertRejects(
    () =>
      fetchForwardContext(
        () =>
          Promise.resolve({
            ok: true,
            status: 200,
            bodyText: JSON.stringify({
              methodResponses: [["error", { type: "serverFail" }, "fg0"]],
            }),
          }),
        "acc",
        "m1",
      ),
    Error,
    "serverFail",
  );
});

Deno.test("forwardContextResolvers: one lookup however many placeholders", async () => {
  let loads = 0;
  const resolvers = forwardContextResolvers(() => {
    loads += 1;
    return Promise.resolve({
      subject: "s",
      text: "t",
      blobId: "b",
      name: "n",
    });
  });
  assertEquals(await resolvers.FORWARD_SUBJECT(), "s");
  assertEquals(await resolvers.FORWARD_TEXT(), "t");
  assertEquals(await resolvers.FORWARD_BLOB_ID(), "b");
  assertEquals(await resolvers.FORWARD_NAME(), "n");
  assertEquals(loads, 1);
});
