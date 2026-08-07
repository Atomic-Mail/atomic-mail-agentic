import { assertEquals, assertStringIncludes } from "@std/assert";

import { substituteResolvedVars, substituteVars } from "./agent-vars.ts";

/** The real bundled preset that places `$BODY` inside a JSON string literal. */
const SEND_MAIL_PRESET = Deno.readTextFileSync(
  new URL("../../../../../shared/presets/send_mail.json", import.meta.url),
);

Deno.test("substituteVars: multiline $BODY into send_mail.json stays valid JSON", async () => {
  // Bug 2: a body with newlines/quotes/backslashes/tabs used to splice raw text
  // into a JSON string literal and break JSON.parse ("Bad control character").
  const body = 'Line 1\nLine 2\twith tab\nHe said "hi" and a path C:\\temp\\x';
  const { text } = await substituteVars({
    raw: SEND_MAIL_PRESET,
    vars: {
      ACCOUNT_ID: "acct-1",
      INBOX_MAILBOX_ID: "mbox-1",
      INBOX: "sasha@cdtest.atomicmail.ai",
      TO: "dest@example.com",
      SUBJECT: "Hi there",
      BODY: body,
    },
  });

  // Must parse without throwing, and the body must round-trip exactly.
  const parsed = JSON.parse(text) as {
    methodCalls: [string, Record<string, unknown>, string][];
  };
  const emailSet = parsed.methodCalls[0][1] as {
    create: { d1: { bodyValues: { b: { value: string } } } };
  };
  assertEquals(emailSet.create.d1.bodyValues.b.value, body);
});

Deno.test("substituteResolvedVars: escapes control chars inside JSON strings", () => {
  const raw = '{"value":"$BODY"}';
  const resolved = new Map([["BODY", 'a\nb"c\\d\te']]);
  const out = substituteResolvedVars(raw, resolved);
  const parsed = JSON.parse(out) as { value: string };
  assertEquals(parsed.value, 'a\nb"c\\d\te');
});

Deno.test("substituteResolvedVars: bare (non-string) tokens substitute verbatim", () => {
  // Outside a string literal the value is inserted raw, preserving numeric /
  // structural placeholders (e.g. a user-supplied inline limit).
  const raw = '{"limit":$LIMIT}';
  const resolved = new Map([["LIMIT", "50"]]);
  const out = substituteResolvedVars(raw, resolved);
  const parsed = JSON.parse(out) as { limit: number };
  assertEquals(parsed.limit, 50);
});

Deno.test("substituteResolvedVars: leaves lowercase JMAP keywords untouched", () => {
  // `$draft` is a JMAP keyword, not a user var — VAR pattern requires uppercase.
  const raw = '{"keywords":{"$draft":true},"from":"$INBOX"}';
  const resolved = new Map([["INBOX", "sasha@cdtest.atomicmail.ai"]]);
  const out = substituteResolvedVars(raw, resolved);
  assertStringIncludes(out, '"$draft":true');
  const parsed = JSON.parse(out) as { from: string };
  assertEquals(parsed.from, "sasha@cdtest.atomicmail.ai");
});

Deno.test("substituteVars: value containing another $TOKEN is not rescanned", async () => {
  const { text } = await substituteVars({
    raw: '{"a":"$A","b":"$B"}',
    vars: { A: "$B", B: "second" },
  });
  const parsed = JSON.parse(text) as { a: string; b: string };
  assertEquals(parsed.a, "$B");
  assertEquals(parsed.b, "second");
});
