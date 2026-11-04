// Test support: a stubbed fetch that answers like a JMAP server, plus a session
// to point the tools at it. Not exported from mod.ts, so it never ships.

import type { JmapSessionPort } from "../jmap/agent-jmap.ts";

export interface JmapEnvelopeSeen {
  using: string[];
  // deno-lint-ignore no-explicit-any
  methodCalls: [string, any, string][];
}

export interface FakeJmap {
  /** Every batch posted, without the role lookups. */
  batches: JmapEnvelopeSeen[];
  /** Every binary upload, as `{ type, bytes }`. */
  uploads: { type: string | null; bytes: Uint8Array }[];
  restore(): void;
}

export const FAKE_JMAP_URL = "https://api.example/jmap";
export const FAKE_UPLOAD_URL = "https://api.example/upload/{accountId}/";

const MAILBOX_IDS: Record<string, string> = {
  inbox: "mb-inbox",
  sent: "mb-sent",
  drafts: "mb-drafts",
  trash: "mb-trash",
};

const json = (value: unknown) => new Response(JSON.stringify(value));

/**
 * Stubs `globalThis.fetch`. Role lookups (`Mailbox/query`) are answered from
 * `mailboxes`; any other batch goes to `answer`, whose result is the response
 * body (`{ status }` in place of it gives an HTTP error).
 */
export function installFakeJmap(
  answer: (batch: JmapEnvelopeSeen) => unknown,
  mailboxes: Record<string, string> = MAILBOX_IDS,
): FakeJmap {
  const batches: JmapEnvelopeSeen[] = [];
  const uploads: FakeJmap["uploads"] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = String(input);
    if (url === FAKE_JMAP_URL) {
      const batch = JSON.parse(String(init?.body)) as JmapEnvelopeSeen;
      const [name, args, id] = batch.methodCalls[0];
      if (name === "Mailbox/query" && args.filter?.role) {
        const box = mailboxes[args.filter.role];
        return Promise.resolve(json({
          methodResponses: [["Mailbox/query", {
            ids: box ? [box] : [],
          }, id]],
        }));
      }
      batches.push(batch);
      const body = answer(batch) as { status?: number };
      return Promise.resolve(
        typeof body?.status === "number"
          ? new Response("refused", { status: body.status })
          : json(body),
      );
    }
    if (url.startsWith("https://api.example/upload/")) {
      const headers = new Headers(init?.headers);
      uploads.push({
        type: headers.get("Content-Type"),
        bytes: new Uint8Array(init?.body as ArrayBuffer),
      });
      return Promise.resolve(
        json({ blobId: `blob${uploads.length}`, size: 1 }),
      );
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  };
  return {
    batches,
    uploads,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/** A session for `<inboxId>@atomicmail.ai`, answering from the fake server. */
export function fakeSession(inboxId = "alice"): JmapSessionPort {
  return {
    apiUrl: "https://api.example",
    currentInboxId: inboxId,
    currentUploadUrl: FAKE_UPLOAD_URL,
    getJmapPostUrl: () => Promise.resolve(FAKE_JMAP_URL),
    getPrimaryMailAccountId: () => Promise.resolve(inboxId),
    getCapabilityToken: () => Promise.resolve("cap"),
    getBlobUploadLimitsForAccount: () => Promise.resolve(null),
  };
}

/** What a successful send answers. */
export const SENT_RESPONSE = {
  methodResponses: [
    ["Email/set", {
      created: { d1: { id: "M-sent", threadId: "T-sent" } },
      notCreated: null,
    }, "c0"],
    ["EmailSubmission/set", { created: { s1: { id: "S1" } } }, "c1"],
    ["Email/set", { created: null, updated: { "M-sent": null } }, "c1"],
  ],
};

/** The message reply_to_message looks up. */
export const ORIGINAL_MESSAGE = {
  id: "m1",
  threadId: "t1",
  from: [{ email: "mate@getmate.ai", name: "Mate" }],
  replyTo: null,
  subject: "Inbox Setup",
  messageId: ["orig-1@getmate.ai"],
  inReplyTo: null,
  references: ["root-0@getmate.ai"],
};

/** Answers the reply lookup with `original`, the send with a success. */
export function answerReply(
  original: Record<string, unknown> = ORIGINAL_MESSAGE,
) {
  return (batch: JmapEnvelopeSeen) =>
    batch.methodCalls[0][0] === "Email/get"
      ? { methodResponses: [["Email/get", { list: [original] }, "g0"]] }
      : SENT_RESPONSE;
}
