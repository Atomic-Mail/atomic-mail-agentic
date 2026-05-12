import { assertEquals, assertThrows } from "@std/assert";

import {
  assertBlobUploadEnvelopeWithinLimits,
  decodedBase64ByteLength,
  tryComputeUploadDataOctets,
  utf8ByteLength,
  type JmapBlobUploadLimits,
} from "./agent-jmap-blob-limits.ts";

Deno.test("utf8ByteLength counts UTF-8 octets", () => {
  assertEquals(utf8ByteLength("a"), 1);
  assertEquals(utf8ByteLength("é"), 2);
});

Deno.test("decodedBase64ByteLength accepts standard base64", () => {
  assertEquals(decodedBase64ByteLength("QQ=="), 1);
  assertEquals(decodedBase64ByteLength("SGVsbG8="), 5);
});

Deno.test("decodedBase64ByteLength rejects invalid base64", () => {
  assertThrows(() => decodedBase64ByteLength("@@@"));
});

Deno.test("tryComputeUploadDataOctets sums text and base64", () => {
  const known = new Map<string, number>();
  const n = tryComputeUploadDataOctets(
    [{ "data:asText": "Hi" }, { "data:asBase64": "QQ==" }],
    known,
  );
  assertEquals(n, utf8ByteLength("Hi") + 1);
});

Deno.test("tryComputeUploadDataOctets resolves #ref slice", () => {
  const known = new Map([["b4", 10]]);
  const n = tryComputeUploadDataOctets(
    [{ "blobId": "#b4", "offset": 2, "length": 3 }],
    known,
  );
  assertEquals(n, 3);
});

Deno.test("assertBlobUploadEnvelopeWithinLimits rejects maxDataSources breach", () => {
  const limits: JmapBlobUploadLimits = {
    maxSizeBlobSet: 1_000_000,
    maxDataSources: 1,
  };
  const limitsByAccount = new Map([["A1", limits]]);
  assertThrows(() =>
    assertBlobUploadEnvelopeWithinLimits(
      {
        using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:blob"],
        methodCalls: [
          [
            "Blob/upload",
            {
              accountId: "A1",
              create: {
                "x": {
                  data: [
                    { "data:asText": "a" },
                    { "data:asText": "b" },
                  ],
                },
              },
            },
            "m0",
          ],
        ],
      },
      limitsByAccount,
    )
  );
});

Deno.test("assertBlobUploadEnvelopeWithinLimits rejects maxSizeBlobSet breach", () => {
  const limits: JmapBlobUploadLimits = {
    maxSizeBlobSet: 4,
    maxDataSources: 64,
  };
  const limitsByAccount = new Map([["A1", limits]]);
  assertThrows(() =>
    assertBlobUploadEnvelopeWithinLimits(
      {
        using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:blob"],
        methodCalls: [
          [
            "Blob/upload",
            {
              accountId: "A1",
              create: {
                "b1": {
                  data: [{ "data:asBase64": "SGVsbG8=" }],
                },
              },
            },
            "m0",
          ],
        ],
      },
      limitsByAccount,
    )
  );
});

Deno.test("assertBlobUploadEnvelopeWithinLimits allows chained Blob/upload with #ref", () => {
  const limits: JmapBlobUploadLimits = {
    maxSizeBlobSet: 500,
    maxDataSources: 64,
  };
  const limitsByAccount = new Map([["A1", limits]]);
  assertBlobUploadEnvelopeWithinLimits(
    {
      using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:blob"],
      methodCalls: [
        [
          "Blob/upload",
          {
            accountId: "A1",
            create: {
              "b4": {
                data: [{ "data:asText": "The quick brown fox jumped over the lazy dog." }],
              },
            },
          },
          "S4",
        ],
        [
          "Blob/upload",
          {
            accountId: "A1",
            create: {
              "cat": {
                data: [
                  { "data:asText": "How" },
                  { "blobId": "#b4", "length": 7, "offset": 3 },
                  { "data:asText": "was t" },
                  { "blobId": "#b4", "length": 1, "offset": 1 },
                  { "data:asBase64": "YXQ/" },
                ],
              },
            },
          },
          "CAT",
        ],
      ],
    },
    limitsByAccount,
  );
});

Deno.test("assertBlobUploadEnvelopeWithinLimits skips account without limits entry", () => {
  assertBlobUploadEnvelopeWithinLimits(
    {
      using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:blob"],
      methodCalls: [
        [
          "Blob/upload",
          {
            accountId: "A1",
            create: {
              "b1": { data: [{ "data:asBase64": "SGVsbG8=" }] },
            },
          },
          "m0",
        ],
      ],
    },
    new Map([["A1", null]]),
  );
});
