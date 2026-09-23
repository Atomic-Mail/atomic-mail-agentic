/** Optional inbox domain override for `$INBOX` normalization. */
export type InboxEmailEnv = {
    ATOMIC_MAIL_INBOX_DOMAIN?: string;
};
export declare function inboxIdToMailboxEmail(inboxId: string, env?: InboxEmailEnv): string;
/**
 * True when `s` has a plausible `local@domain` shape (single `@`, non-empty
 * local part, dotted domain). Used to decide whether a JMAP `accountId` is a
 * real mailbox address rather than an opaque account id.
 */
export declare function looksLikeEmailAddress(s: string): boolean;
export interface ResolveInboxMailboxEmailInput {
    /** Stored inbox local-part (e.g. `sasha`) or full address, if known. */
    inboxId?: string;
    /**
     * JMAP primary mail `accountId`. In this system it resolves to the inbox's
     * REAL address (e.g. `sasha@cdtest.atomicmail.ai`), so it is the
     * authoritative source for `$INBOX` on custom domains.
     */
    accountId?: string;
    /** `ATOMIC_MAIL_INBOX_DOMAIN` fallback for local-part-only inbox ids. */
    inboxDomain?: string;
}
/**
 * Resolves the `$INBOX` mailbox address, preferring the inbox's real address.
 *
 * Priority:
 *   1. `inboxId` already a full address (`local@domain`) — use verbatim.
 *   2. JMAP `accountId` that looks like an email whose local-part matches the
 *      stored `inboxId` (or when no `inboxId` is known) — the real address,
 *      which is correct for custom domains with zero extra config.
 *   3. `inboxId` + `ATOMIC_MAIL_INBOX_DOMAIN` (secondary fallback).
 *   4. `inboxId` + the default `atomicmail.ai` domain.
 *
 * Returns `""` when nothing usable is available (caller should error).
 */
export declare function resolveInboxMailboxEmail(input: ResolveInboxMailboxEmailInput): string;
//# sourceMappingURL=inbox-id-to-mailbox-email.d.ts.map