import { assertEquals } from "@std/assert";

import { readSharedText } from "../../core/shared-assets.ts";
import { fetchSentMailboxId, type JmapSessionPort } from "./agent-jmap.ts";

function fakePort(): JmapSessionPort {
  return {
    apiUrl: "https://api.example",
    getJmapPostUrl: () => Promise.resolve("https://api.example/jmap"),
    getPrimaryMailAccountId: () => Promise.resolve("acc-1"),
    getCapabilityToken: () => Promise.resolve("cap"),
    getBlobUploadLimitsForAccount: () => Promise.resolve(null),
  };
}

/** Stubs fetch with a Mailbox/query that returns `idsByRole[role]`. */
async function withMailboxes<T>(
  idsByRole: Record<string, string[]>,
  fn: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (_input, init) => {
    const envelope = JSON.parse(String(init?.body));
    const role = envelope.methodCalls[0][1].filter.role as string;
    const body = {
      methodResponses: [
        ["Mailbox/query", { ids: idsByRole[role] ?? [] }, "mq0"],
      ],
    };
    return Promise.resolve(new Response(JSON.stringify(body)));
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test("fetchSentMailboxId returns the role sent mailbox", async () => {
  const id = await withMailboxes(
    { inbox: ["mb-inbox"], sent: ["mb-sent"] },
    () => fetchSentMailboxId(fakePort()),
  );
  assertEquals(id, "mb-sent");
});

Deno.test("fetchSentMailboxId falls back to the inbox without Sent", async () => {
  const id = await withMailboxes(
    { inbox: ["mb-inbox"] },
    () => fetchSentMailboxId(fakePort()),
  );
  assertEquals(id, "mb-inbox");
});

for (
  const preset of [
    "send_mail.json",
    "send_mail_attachment.json",
    "send_mail_blob_attachment.json",
    "reply.json",
  ]
) {
  Deno.test(`${preset} files in Sent and clears $draft on success`, () => {
    const envelope = JSON.parse(readSharedText(`presets/${preset}`));
    const calls = Object.fromEntries(
      envelope.methodCalls.map((c: [string, unknown]) => [c[0], c[1]]),
    );
    const [email] = Object.values(calls["Email/set"].create) as {
      mailboxIds: Record<string, boolean>;
    }[];
    assertEquals(email.mailboxIds, { "$SENT_MAILBOX_ID": true });
    const submission = calls["EmailSubmission/set"];
    const [subId] = Object.keys(submission.create);
    assertEquals(submission.onSuccessUpdateEmail, {
      [`#${subId}`]: { "keywords/$draft": null, "keywords/$sent": true },
    });
  });
}
