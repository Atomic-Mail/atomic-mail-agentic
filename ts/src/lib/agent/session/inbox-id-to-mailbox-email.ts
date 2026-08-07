/** Optional inbox domain override for `$INBOX` normalization. */
export type InboxEmailEnv = { ATOMIC_MAIL_INBOX_DOMAIN?: string };

/**
 * Normalizes stored `inboxId` into an RFC5322 mailbox address for `$INBOX`
 * substitution (`From`, submission `envelope`, etc.).
 *
 * Credentials may store only the local-part (`alice`); production mailboxes
 * live at `alice@atomicmail.ai`. Pass `ATOMIC_MAIL_INBOX_DOMAIN` via `env`
 * when not using the default domain.
 */
const DEFAULT_INBOX_DOMAIN = "atomicmail.ai";

export function inboxIdToMailboxEmail(
  inboxId: string,
  env?: InboxEmailEnv,
): string {
  const trimmed = inboxId.trim();
  if (trimmed.length === 0) return inboxId;
  if (trimmed.includes("@")) return trimmed;

  const raw = env?.ATOMIC_MAIL_INBOX_DOMAIN?.trim();
  const domain = raw && raw.length > 0
    ? raw.replace(/^@+/, "")
    : DEFAULT_INBOX_DOMAIN;

  return `${trimmed}@${domain}`;
}

/** Local-part of an email address (lowercased), or "" when malformed. */
function emailLocalPart(email: string): string {
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at).trim().toLowerCase() : "";
}

/**
 * True when `s` has a plausible `local@domain` shape (single `@`, non-empty
 * local part, dotted domain). Used to decide whether a JMAP `accountId` is a
 * real mailbox address rather than an opaque account id.
 */
export function looksLikeEmailAddress(s: string): boolean {
  const trimmed = s.trim();
  const parts = trimmed.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return local.length > 0 && domain.length > 0 && domain.includes(".");
}

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
export function resolveInboxMailboxEmail(
  input: ResolveInboxMailboxEmailInput,
): string {
  const inboxId = input.inboxId?.trim();
  const accountId = input.accountId?.trim();

  // 1. Stored full address wins (explicitly persisted with a domain).
  if (inboxId && inboxId.includes("@")) return inboxId;

  // 2. Real address from the JMAP session account id.
  if (accountId && looksLikeEmailAddress(accountId)) {
    if (!inboxId || emailLocalPart(accountId) === inboxId.toLowerCase()) {
      return accountId;
    }
  }

  // 3 + 4. Append configured / default domain to the local-part.
  if (inboxId && inboxId.length > 0) {
    return inboxIdToMailboxEmail(inboxId, {
      ATOMIC_MAIL_INBOX_DOMAIN: input.inboxDomain,
    });
  }

  return "";
}
