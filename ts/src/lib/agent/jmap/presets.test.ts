// The bundled presets, run through the real substitution path with `dryRun`.

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";

import { readSharedText } from "../../core/shared-assets.ts";
import { fakeSession, installFakeJmap } from "../mail/fake-jmap.ts";
import {
  BUNDLED_OPS_PRESET_NAMES,
  readOpsFile,
  runJmapRequest,
} from "./agent-jmap.ts";

const PRESET_DIR = new URL("../../../../../shared/presets/", import.meta.url);

/** Resolve a bundled preset; only the placeholder lookups reach the fake. */
async function dryRun(
  preset: string,
  vars: Record<string, string>,
  answer: () => unknown = () => ({}),
  mailboxes?: Record<string, string>,
) {
  const fake = installFakeJmap(answer, mailboxes);
  try {
    const { bodyText } = await runJmapRequest({
      session: fakeSession(),
      opsJson: readSharedText(`presets/${preset}`),
      defaultUsing: [],
      sourceLabel: preset,
      vars,
      dryRun: true,
    });
    return JSON.parse(bodyText).envelope;
  } finally {
    fake.restore();
  }
}

Deno.test("BUNDLED_OPS_PRESET_NAMES lists every file in shared/presets", async () => {
  const onDisk: string[] = [];
  for await (const entry of Deno.readDir(PRESET_DIR)) onDisk.push(entry.name);
  assertEquals([...BUNDLED_OPS_PRESET_NAMES].sort(), onDisk.sort());
});

for (const name of BUNDLED_OPS_PRESET_NAMES) {
  Deno.test(`${name} is a full envelope that resolves by name`, async () => {
    const raw = await readOpsFile("/nonexistent-credentials-dir", name);
    const envelope = JSON.parse(raw);
    assertEquals(Array.isArray(envelope.using), true);
    assertEquals(Array.isArray(envelope.methodCalls), true);
    assertEquals(envelope.using.includes("urn:ietf:params:jmap:core"), true);
  });
}

Deno.test("search.json: full-text query with summaries", async () => {
  const env = await dryRun("search.json", { QUERY: 'in"voice' });
  assertEquals(env.methodCalls[0][1].filter, { text: 'in"voice' });
  assertEquals(env.methodCalls[1][1]["#ids"].resultOf, "q0");
  assertEquals(env.methodCalls[1][1].properties.includes("keywords"), true);
});

Deno.test("mark_read.json: sets $seen on the given message only", async () => {
  const env = await dryRun("mark_read.json", { MAIL_ID: "m1" });
  assertEquals(env.methodCalls[0][0], "Email/set");
  assertEquals(env.methodCalls[0][1].update, {
    m1: { "keywords/$seen": true },
  });
});

Deno.test("get_thread.json: thread, then its messages by reference", async () => {
  const env = await dryRun("get_thread.json", { THREAD_ID: "t1" });
  assertEquals(env.methodCalls[0][0], "Thread/get");
  assertEquals(env.methodCalls[0][1].ids, ["t1"]);
  assertEquals(env.methodCalls[1][1]["#ids"], {
    resultOf: "t0",
    name: "Thread/get",
    path: "/list/*/emailIds",
  });
  assertEquals(env.methodCalls[1][1].fetchTextBodyValues, true);
});

Deno.test("move.json: replaces the mailbox", async () => {
  const env = await dryRun("move.json", { MAIL_ID: "m1", MAILBOX_ID: "mb9" });
  assertEquals(env.methodCalls[0][1].update, {
    m1: { mailboxIds: { mb9: true } },
  });
});

Deno.test("label.json: adds a keyword, and keeps $seen-style names intact", async () => {
  const env = await dryRun("label.json", { MAIL_ID: "m1", LABEL: "urgent" });
  assertEquals(env.methodCalls[0][1].update, {
    m1: { "keywords/urgent": true },
  });
});

Deno.test("delete.json: moves to Trash, nothing is destroyed", async () => {
  const env = await dryRun("delete.json", { MAIL_ID: "m1" });
  assertEquals(env.methodCalls[0][1].update, {
    m1: { mailboxIds: { "mb-trash": true } },
  });
  assertEquals("destroy" in env.methodCalls[0][1], false);
});

Deno.test("delete.json: an inbox with no Trash is refused, not filed in the inbox", async () => {
  await assertRejects(
    () => dryRun("delete.json", { MAIL_ID: "m1" }, undefined, { inbox: "i" }),
    Error,
    'no mailbox with role "trash"',
  );
});

Deno.test("create_draft.json: stored in Drafts, with no submission", async () => {
  const env = await dryRun("create_draft.json", {
    TO: "a@x.com",
    SUBJECT: "s",
    BODY: "b",
  });
  assertEquals(env.methodCalls.length, 1);
  const d1 = env.methodCalls[0][1].create.d1;
  assertEquals(d1.mailboxIds, { "mb-drafts": true });
  assertEquals(d1.keywords, { $draft: true, $seen: true });
  assertEquals(d1.from, [{ email: "alice@atomicmail.ai" }]);
});

Deno.test("download_attachment.json: Blob/get with the blob capability", async () => {
  const env = await dryRun("download_attachment.json", { BLOB_ID: "G1" });
  assertEquals(env.using.includes("urn:ietf:params:jmap:blob"), true);
  assertEquals(env.methodCalls[0][0], "Blob/get");
  assertEquals(env.methodCalls[0][1].ids, ["G1"]);
  assertEquals(env.methodCalls[0][1].properties, ["data:asBase64", "size"]);
});

Deno.test("list_mailboxes.json: ids, names and roles", async () => {
  const env = await dryRun("list_mailboxes.json", {});
  assertEquals(env.methodCalls[0][0], "Mailbox/get");
  assertEquals(env.methodCalls[0][1].properties.includes("role"), true);
});

Deno.test("forward.json: fields come from the original, attached whole", async () => {
  const env = await dryRun(
    "forward.json",
    { MAIL_ID: "m1", TO: "boss@x.com", BODY: "FYI" },
    () => ({
      methodResponses: [["Email/get", {
        list: [{
          blobId: "G1",
          from: [{ email: "anna@x.com", name: "Anna" }],
          to: [{ email: "alice@atomicmail.ai" }],
          subject: 'Invoice "$INBOX"',
          receivedAt: "2026-11-04T10:00:00Z",
          textBody: [{ partId: "1", type: "text/plain" }],
          bodyValues: { "1": { value: "Pay $TO now" } },
        }],
      }, "fg0"]],
    }),
  );
  const d1 = env.methodCalls[0][1].create.d1;
  assertEquals(d1.subject, 'Fwd: Invoice "$INBOX"');
  assertEquals(d1.to, [{ email: "boss@x.com" }]);
  assertEquals(d1.attachments, [{
    blobId: "G1",
    type: "message/rfc822",
    name: "Invoice $INBOX.eml",
  }]);
  const text = d1.bodyValues.b.value as string;
  assertEquals(text.startsWith("FYI\n\n---------- Forwarded message"), true);
  // One pass: a token inside the original's text stays text.
  assertStringIncludes(text, "Pay $TO now");
  assertEquals(env.methodCalls[1][1].create.s1.envelope.rcptTo, [
    { email: "boss@x.com" },
  ]);
});

Deno.test("forward.json: needs MAIL_ID", async () => {
  await assertRejects(
    () => dryRun("forward.json", { TO: "a@x.com", BODY: "b" }),
    Error,
    "need MAIL_ID",
  );
});
