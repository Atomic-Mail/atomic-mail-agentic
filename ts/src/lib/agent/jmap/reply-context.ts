// Reply placeholders ($REPLY_TO, $REPLY_SUBJECT, $REPLY_MESSAGE_ID) derived
// from the message named by $MAIL_ID. JMAP result references (`#to`, …) are
// only valid at the top level of method arguments (RFC 8620 §3.7), not inside
// an `Email/set` create object, so a single-batch preset cannot copy fields of
// the original message; the client looks them up first instead.

type PostJmap = (envelope: {
  using: string[];
  methodCalls: [string, Record<string, unknown>, string][];
}) => Promise<{ ok: boolean; status: number; bodyText: string }>;

export interface ReplyContext {
  /** Reply-To address of the original, else its From address. */
  to: string;
  /** Original subject with a single `Re: ` prefix. */
  subject: string;
  /** Message-ID of the original (for In-Reply-To / References). */
  messageId: string;
}

export const REPLY_VAR_NAMES = [
  "REPLY_TO",
  "REPLY_SUBJECT",
  "REPLY_MESSAGE_ID",
] as const;

type Address = { email?: string | null };

function firstEmail(list: unknown): string | undefined {
  if (!Array.isArray(list)) return undefined;
  const email = (list[0] as Address | undefined)?.email;
  return typeof email === "string" && email.length > 0 ? email : undefined;
}

export function replySubject(subject: unknown): string {
  const s = typeof subject === "string" ? subject.trim() : "";
  return /^re:/i.test(s) ? s : `Re: ${s}`.trimEnd();
}

export async function fetchReplyContext(
  post: PostJmap,
  accountId: string,
  mailId: string | undefined,
): Promise<ReplyContext> {
  if (!mailId) {
    throw new Error(
      "$REPLY_TO / $REPLY_SUBJECT / $REPLY_MESSAGE_ID need MAIL_ID in vars " +
        "(the id of the message to reply to).",
    );
  }
  const { ok, status, bodyText } = await post({
    using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
    methodCalls: [[
      "Email/get",
      {
        accountId,
        ids: [mailId],
        properties: ["from", "replyTo", "subject", "messageId"],
      },
      "rg0",
    ]],
  });
  if (!ok) {
    throw new Error(`Email/get for reply failed (HTTP ${status}): ${bodyText}`);
  }
  let email: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(bodyText) as { methodResponses?: unknown[][] };
    const first = parsed.methodResponses?.[0];
    if (Array.isArray(first) && first[0] === "Email/get") {
      email = (first[1] as { list?: Record<string, unknown>[] }).list?.[0];
    }
  } catch {
    throw new Error("Email/get for reply returned invalid JSON.");
  }
  if (!email) {
    throw new Error(`MAIL_ID ${mailId} not found; nothing to reply to.`);
  }
  const to = firstEmail(email.replyTo) ?? firstEmail(email.from);
  if (!to) {
    throw new Error(`Message ${mailId} has no From or Reply-To address.`);
  }
  const ids = email.messageId;
  const messageId = Array.isArray(ids) && typeof ids[0] === "string"
    ? ids[0]
    : undefined;
  if (!messageId) {
    throw new Error(`Message ${mailId} has no Message-ID to thread on.`);
  }
  return { to, subject: replySubject(email.subject), messageId };
}

/**
 * Auto-resolvers for the reply placeholders. One `Email/get` is shared by all
 * three, and only runs when a reply placeholder is actually referenced.
 */
export function replyContextResolvers(
  load: () => Promise<ReplyContext>,
): Record<(typeof REPLY_VAR_NAMES)[number], () => Promise<string>> {
  let pending: Promise<ReplyContext> | undefined;
  const ctx = () => (pending ??= load());
  return {
    REPLY_TO: async () => (await ctx()).to,
    REPLY_SUBJECT: async () => (await ctx()).subject,
    REPLY_MESSAGE_ID: async () => (await ctx()).messageId,
  };
}
