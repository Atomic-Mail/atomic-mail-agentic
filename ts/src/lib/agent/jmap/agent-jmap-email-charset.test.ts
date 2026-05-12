import { assertEquals } from "@std/assert";

import type { JmapEnvelope } from "./agent-jmap.ts";
import { ensureTextCharsetOnEmailSetBlobParts } from "./agent-jmap-email-charset.ts";

Deno.test("ensureTextCharsetOnEmailSetBlobParts adds charset for text/* blob attachment", () => {
  const envelope: JmapEnvelope = {
    using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
    methodCalls: [
      [
        "Email/set",
        {
          accountId: "acc",
          create: {
            m1: {
              attachments: [
                {
                  blobId: "G1",
                  type: "text/plain",
                  name: "a.txt",
                },
              ],
            },
          },
        },
        "c0",
      ],
    ],
  };
  ensureTextCharsetOnEmailSetBlobParts(envelope);
  const call0 = envelope.methodCalls[0] as unknown[];
  const create = (call0[1] as Record<string, unknown>)["create"] as Record<
    string,
    unknown
  >;
  const email = create["m1"] as Record<string, unknown>;
  const atts = email["attachments"] as Record<string, unknown>[];
  assertEquals(atts[0]!["charset"], "utf-8");
});

Deno.test("ensureTextCharsetOnEmailSetBlobParts does not add charset when partId is set", () => {
  const envelope: JmapEnvelope = {
    using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
    methodCalls: [
      [
        "Email/set",
        {
          accountId: "acc",
          create: {
            m1: {
              textBody: [{ partId: "body1", type: "text/plain" }],
            },
          },
        },
        "c0",
      ],
    ],
  };
  ensureTextCharsetOnEmailSetBlobParts(envelope);
  const call0 = envelope.methodCalls[0] as unknown[];
  const create = (call0[1] as Record<string, unknown>)["create"] as Record<
    string,
    unknown
  >;
  const email = create["m1"] as Record<string, unknown>;
  const parts = email["textBody"] as Record<string, unknown>[];
  assertEquals(Object.hasOwn(parts[0]!, "charset"), false);
});

Deno.test("ensureTextCharsetOnEmailSetBlobParts skips non-text blob attachment", () => {
  const envelope: JmapEnvelope = {
    using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
    methodCalls: [
      [
        "Email/set",
        {
          accountId: "acc",
          create: {
            m1: {
              attachments: [
                {
                  blobId: "G1",
                  type: "image/png",
                  name: "x.png",
                },
              ],
            },
          },
        },
        "c0",
      ],
    ],
  };
  ensureTextCharsetOnEmailSetBlobParts(envelope);
  const call0 = envelope.methodCalls[0] as unknown[];
  const create = (call0[1] as Record<string, unknown>)["create"] as Record<
    string,
    unknown
  >;
  const email = create["m1"] as Record<string, unknown>;
  const atts = email["attachments"] as Record<string, unknown>[];
  assertEquals(Object.hasOwn(atts[0]!, "charset"), false);
});

Deno.test("ensureTextCharsetOnEmailSetBlobParts respects existing charset", () => {
  const envelope: JmapEnvelope = {
    using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
    methodCalls: [
      [
        "Email/set",
        {
          accountId: "acc",
          create: {
            m1: {
              attachments: [
                {
                  blobId: "G1",
                  type: "text/plain",
                  name: "a.txt",
                  charset: "iso-8859-1",
                },
              ],
            },
          },
        },
        "c0",
      ],
    ],
  };
  ensureTextCharsetOnEmailSetBlobParts(envelope);
  const call0 = envelope.methodCalls[0] as unknown[];
  const create = (call0[1] as Record<string, unknown>)["create"] as Record<
    string,
    unknown
  >;
  const email = create["m1"] as Record<string, unknown>;
  const atts = email["attachments"] as Record<string, unknown>[];
  assertEquals(atts[0]!["charset"], "iso-8859-1");
});

Deno.test("ensureTextCharsetOnEmailSetBlobParts handles text/html blob in htmlBody", () => {
  const envelope: JmapEnvelope = {
    using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
    methodCalls: [
      [
        "Email/set",
        {
          accountId: "acc",
          create: {
            m1: {
              htmlBody: [{ blobId: "Gh", type: "text/html", name: "x.html" }],
            },
          },
        },
        "c0",
      ],
    ],
  };
  ensureTextCharsetOnEmailSetBlobParts(envelope);
  const call0 = envelope.methodCalls[0] as unknown[];
  const create = (call0[1] as Record<string, unknown>)["create"] as Record<
    string,
    unknown
  >;
  const email = create["m1"] as Record<string, unknown>;
  const parts = email["htmlBody"] as Record<string, unknown>[];
  assertEquals(parts[0]!["charset"], "utf-8");
});
