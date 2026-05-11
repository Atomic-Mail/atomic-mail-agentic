import { assertEquals } from "@std/assert";

import { inboxIdToMailboxEmail } from "./inbox-id-to-mailbox-email.ts";

Deno.test("inboxIdToMailboxEmail leaves full addresses unchanged", () => {
  assertEquals(inboxIdToMailboxEmail("agent@example.com"), "agent@example.com");
});

Deno.test("inboxIdToMailboxEmail appends default domain for local-part only", () => {
  assertEquals(inboxIdToMailboxEmail("alice", {}), "alice@atomicmail.ai");
});

Deno.test("inboxIdToMailboxEmail respects ATOMIC_MAIL_INBOX_DOMAIN", () => {
  assertEquals(
    inboxIdToMailboxEmail("bob", { ATOMIC_MAIL_INBOX_DOMAIN: "corp.example" }),
    "bob@corp.example",
  );
  assertEquals(
    inboxIdToMailboxEmail("bob", { ATOMIC_MAIL_INBOX_DOMAIN: "@other.example" }),
    "bob@other.example",
  );
});
