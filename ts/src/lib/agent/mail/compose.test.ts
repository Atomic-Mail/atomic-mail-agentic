import { assert, assertEquals, assertThrows } from "@std/assert";

import {
  buildDraft,
  composeFromInput,
  htmlToPlainText,
  parseAddressList,
  parseFromName,
} from "./compose.ts";

Deno.test("parseAddressList: bare, named, several, deduped", () => {
  assertEquals(parseAddressList(undefined, "to"), []);
  assertEquals(parseAddressList("anna@x.com", "to"), [{ email: "anna@x.com" }]);
  assertEquals(parseAddressList("Anna B <Anna@X.com>", "to"), [
    { email: "anna@x.com", name: "Anna B" },
  ]);
  assertEquals(parseAddressList("a@x.com, b@x.com; A@X.com", "to"), [
    { email: "a@x.com" },
    { email: "b@x.com" },
  ]);
  assertEquals(parseAddressList(["a@x.com", "b@x.com,c@x.com"], "to"), [
    { email: "a@x.com" },
    { email: "b@x.com" },
    { email: "c@x.com" },
  ]);
});

Deno.test("parseAddressList: a comma inside quotes stays in the name", () => {
  assertEquals(parseAddressList('"Doe, Anna" <anna@x.com>, b@x.com', "to"), [
    { email: "anna@x.com", name: "Doe, Anna" },
    { email: "b@x.com" },
  ]);
});

Deno.test("parseAddressList: anything else is refused, naming the field", () => {
  for (const bad of ["nope", "a@b", "Doe, Anna <anna@x.com>", "a b@x.com"]) {
    assertThrows(
      () => parseAddressList(bad, "reply_to"),
      Error,
      "reply_to:",
    );
  }
  assertThrows(() => parseAddressList(`${"a".repeat(600)}@x.com`, "to"));
});

Deno.test("parseFromName: trims, folds whitespace, drops blanks", () => {
  assertEquals(parseFromName(undefined), undefined);
  assertEquals(parseFromName("   "), undefined);
  assertEquals(parseFromName("  Anna   from\r\nAcme "), "Anna from Acme");
  assertEquals(parseFromName('Иван, Acme "Bot"'), 'Иван, Acme "Bot"');
});

Deno.test("parseFromName: refuses an address-like or oversized name", () => {
  for (const bad of ["ceo@bank.com", "Bank <ceo@bank.com>", "a>b"]) {
    assertThrows(() => parseFromName(bad), Error, "display name only");
  }
  assertThrows(() => parseFromName("x".repeat(101)), Error, "100 characters");
});

Deno.test("composeFromInput: needs body or html_body", () => {
  assertThrows(() => composeFromInput({}), Error, "html_body");
  assertThrows(() => composeFromInput({ html_body: "  " }), Error, "html_body");
  assertEquals(composeFromInput({ body: "" }), { text: "", options: {} });
});

Deno.test("composeFromInput: body stays as given next to html", () => {
  const { text, options } = composeFromInput({
    body: "plain",
    html_body: "<p>rich</p>",
    from_name: "Anna",
    reply_to: "Help <help@x.com>",
  });
  assertEquals(text, "plain");
  assertEquals(options, {
    htmlBody: "<p>rich</p>",
    fromName: "Anna",
    replyTo: [{ email: "help@x.com", name: "Help" }],
  });
});

Deno.test("composeFromInput: text part derived from html when body is empty", () => {
  for (const body of [undefined, "", "  \n"]) {
    assertEquals(
      composeFromInput({ body, html_body: "<p>Hi <b>there</b></p>" }).text,
      "Hi there",
    );
  }
});

Deno.test("buildDraft: plain message has only what the presets have", () => {
  const vars: Record<string, string> = {};
  assertEquals(buildDraft("$SUBJECT", {}, vars), {
    mailboxIds: { "$SENT_MAILBOX_ID": true },
    from: [{ email: "$INBOX" }],
    subject: "$SUBJECT",
    textBody: [{ partId: "b", type: "text/plain" }],
    bodyValues: { b: { value: "$BODY" } },
    keywords: { $draft: true, $seen: true },
  });
  assertEquals(vars, {});
});

Deno.test("buildDraft: options reach the batch through vars only", () => {
  const vars: Record<string, string> = {};
  const draft = buildDraft("$SUBJECT", {
    htmlBody: '<a href="x">$INBOX</a>',
    fromName: 'A "$TOKEN"',
    replyTo: [{ email: "h$X@x.com", name: "H" }, { email: "i@x.com" }],
  }, vars);
  assertEquals(draft.from, [{ email: "$INBOX", name: "$FROM_NAME" }]);
  assertEquals(draft.htmlBody, [{ partId: "h", type: "text/html" }]);
  assertEquals(draft.replyTo, [
    { email: "$HEADER_REPLY_TO_0_EMAIL", name: "$HEADER_REPLY_TO_0_NAME" },
    { email: "$HEADER_REPLY_TO_1_EMAIL" },
  ]);
  assertEquals(vars, {
    FROM_NAME: 'A "$TOKEN"',
    HTML_BODY: '<a href="x">$INBOX</a>',
    HEADER_REPLY_TO_0_EMAIL: "h$X@x.com",
    HEADER_REPLY_TO_0_NAME: "H",
    HEADER_REPLY_TO_1_EMAIL: "i@x.com",
  });
  assertEquals(JSON.stringify(draft).includes("h$X"), false);
});

Deno.test("htmlToPlainText: structure, links, entities", () => {
  const html = `<!doctype html><html><head><title>T</title>
    <style>p { color: red }</style></head>
    <body><!-- note --><h1>Report</h1><p>Hello <b>there</b> &amp; welcome&nbsp;&#33;&#x21;</p>
    <ul><li>One</li><li>Two</li></ul>
    <a href="https://x.example/a">the link</a> <a href='https://x.example/b'>https://x.example/b</a>
    <a href="javascript:alert(1)">bad</a> a < b line<br/>two
    <script>alert("<p>no</p>")</script>
    </body></html>`;
  assertEquals(
    htmlToPlainText(html),
    [
      "Report",
      "",
      "Hello there & welcome !!",
      "",
      "- One",
      "- Two",
      "",
      "the link (https://x.example/a) https://x.example/b",
      "bad a < b line",
      "two",
    ].join("\n"),
  );
});

Deno.test("htmlToPlainText: broken input neither throws nor leaks tags", () => {
  assertEquals(htmlToPlainText(""), "");
  assertEquals(htmlToPlainText("text <b unterminated"), "text");
  assertEquals(htmlToPlainText("<!-- open comment"), "");
  assertEquals(htmlToPlainText("a<script>never closed"), "a");
  assertEquals(
    htmlToPlainText("&bogus; &#99999999999; &#0;"),
    "&bogus; &#99999999999; &#0;",
  );
});

Deno.test("htmlToPlainText: stays linear on adversarial bodies", () => {
  const n = 2_000_000;
  const start = performance.now();
  for (
    const body of [
      "<".repeat(n),
      "<".repeat(n) + ">",
      "<a ".repeat(n / 3),
      "<a href='x'>".repeat(n / 12),
      "<script>".repeat(n / 8),
      "<!--".repeat(n / 4),
      " ".repeat(n),
      " ".repeat(n) + "x",
      "\r".repeat(n),
      "&".repeat(n),
    ]
  ) {
    htmlToPlainText(body);
  }
  // Each pass above is a few ms when linear; quadratic would take hours.
  assert(performance.now() - start < 10_000);
});
