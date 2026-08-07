import { assertEquals } from "@std/assert";

import {
  inboxIdToMailboxEmail,
  looksLikeEmailAddress,
  resolveInboxMailboxEmail,
} from "./inbox-id-to-mailbox-email.ts";

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
    inboxIdToMailboxEmail("bob", {
      ATOMIC_MAIL_INBOX_DOMAIN: "@other.example",
    }),
    "bob@other.example",
  );
});

Deno.test("looksLikeEmailAddress accepts real addresses, rejects opaque ids", () => {
  assertEquals(looksLikeEmailAddress("sasha@cdtest.atomicmail.ai"), true);
  assertEquals(looksLikeEmailAddress("alice@atomicmail.ai"), true);
  // Opaque JMAP account ids (no dotted domain / no @) must NOT be treated as
  // addresses, so resolution falls back to domain-append.
  assertEquals(looksLikeEmailAddress("u_12345"), false);
  assertEquals(looksLikeEmailAddress("account@1"), false);
  assertEquals(looksLikeEmailAddress("a@b@c.com"), false);
});

Deno.test("resolveInboxMailboxEmail derives custom-domain $INBOX from accountId", () => {
  // Bug 1: credentials persist only the local-part ("sasha"); the JMAP account
  // id carries the REAL custom-domain address. $INBOX must use it, not the
  // hardcoded @atomicmail.ai.
  assertEquals(
    resolveInboxMailboxEmail({
      inboxId: "sasha",
      accountId: "sasha@cdtest.atomicmail.ai",
    }),
    "sasha@cdtest.atomicmail.ai",
  );
});

Deno.test("resolveInboxMailboxEmail uses accountId when no inboxId is known", () => {
  assertEquals(
    resolveInboxMailboxEmail({ accountId: "agent@corp.example" }),
    "agent@corp.example",
  );
});

Deno.test("resolveInboxMailboxEmail honors ATOMIC_MAIL_INBOX_DOMAIN fallback", () => {
  // No usable accountId → the env override must take effect at request time.
  assertEquals(
    resolveInboxMailboxEmail({
      inboxId: "sasha",
      accountId: "opaque-account-id",
      inboxDomain: "cdtest.atomicmail.ai",
    }),
    "sasha@cdtest.atomicmail.ai",
  );
});

Deno.test("resolveInboxMailboxEmail defaults to atomicmail.ai when nothing else", () => {
  assertEquals(
    resolveInboxMailboxEmail({ inboxId: "alice" }),
    "alice@atomicmail.ai",
  );
});

Deno.test("resolveInboxMailboxEmail keeps a stored full address verbatim", () => {
  assertEquals(
    resolveInboxMailboxEmail({
      inboxId: "alice@stored.example",
      accountId: "alice@other.example",
    }),
    "alice@stored.example",
  );
});

Deno.test("resolveInboxMailboxEmail ignores accountId whose local-part mismatches", () => {
  // Guard against an unexpected account id swapping the sender: fall back to
  // domain-append on the known inbox local-part instead.
  assertEquals(
    resolveInboxMailboxEmail({
      inboxId: "sasha",
      accountId: "someoneelse@cdtest.atomicmail.ai",
      inboxDomain: "cdtest.atomicmail.ai",
    }),
    "sasha@cdtest.atomicmail.ai",
  );
});

Deno.test("resolveInboxMailboxEmail returns empty when nothing is known", () => {
  assertEquals(resolveInboxMailboxEmail({}), "");
});
