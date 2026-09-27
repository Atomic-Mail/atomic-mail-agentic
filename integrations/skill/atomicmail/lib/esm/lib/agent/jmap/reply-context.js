// Reply placeholders ($REPLY_TO, $REPLY_SUBJECT, $REPLY_MESSAGE_ID) derived
// from the message named by $MAIL_ID. JMAP result references (`#to`, …) are
// only valid at the top level of method arguments (RFC 8620 §3.7), not inside
// an `Email/set` create object, so a single-batch preset cannot copy fields of
// the original message; the client looks them up first instead.
export const REPLY_VAR_NAMES = [
    "REPLY_TO",
    "REPLY_SUBJECT",
    "REPLY_MESSAGE_ID",
];
/** First usable (non-blank) address in the list, trimmed. */
function firstEmail(list) {
    if (!Array.isArray(list))
        return undefined;
    for (const item of list) {
        const email = item?.email;
        if (typeof email === "string" && email.trim().length > 0) {
            return email.trim();
        }
    }
    return undefined;
}
const RE_PREFIX = /^\s*re\s*:/i;
/**
 * Same rule as the hosted MCP server: newlines collapse to one space, and a
 * single `Re: ` is added unless the subject already starts with one.
 */
export function replySubject(subject) {
    const s = (typeof subject === "string" ? subject : "")
        .replace(/[\r\n]+/g, " ")
        .trim();
    return RE_PREFIX.test(s) ? s : `Re: ${s}`.trimEnd();
}
export async function fetchReplyContext(post, accountId, mailId) {
    if (!mailId) {
        throw new Error("$REPLY_TO / $REPLY_SUBJECT / $REPLY_MESSAGE_ID need MAIL_ID in vars " +
            "(the id of the message to reply to).");
    }
    const { ok, status, bodyText } = await post({
        using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
        methodCalls: [[
                "Email/get",
                {
                    accountId,
                    ids: [mailId],
                    properties: ["from", "replyTo", "sender", "subject", "messageId"],
                },
                "rg0",
            ]],
    });
    if (!ok) {
        throw new Error(`Email/get for reply failed (HTTP ${status}): ${bodyText}`);
    }
    let first;
    try {
        const parsed = JSON.parse(bodyText);
        first = parsed.methodResponses?.[0];
    }
    catch {
        throw new Error("Email/get for reply returned invalid JSON.");
    }
    if (Array.isArray(first) && first[0] === "error") {
        throw new Error(`Email/get for reply failed: ${JSON.stringify(first[1])}`);
    }
    let email;
    if (Array.isArray(first) && first[0] === "Email/get") {
        email = first[1]
            ?.list?.[0];
    }
    if (!email) {
        throw new Error(`MAIL_ID ${mailId} not found; nothing to reply to.`);
    }
    const to = firstEmail(email.replyTo) ?? firstEmail(email.from) ??
        firstEmail(email.sender);
    if (!to) {
        throw new Error(`Message ${mailId} has no Reply-To, From or Sender address.`);
    }
    const ids = email.messageId;
    const messageId = Array.isArray(ids) && typeof ids[0] === "string"
        ? ids[0]
        : undefined;
    if (!messageId) {
        throw new Error(`Message ${mailId} has no Message-ID to thread on; ` +
            "use send_mail.json with TO/SUBJECT instead.");
    }
    return { to, subject: replySubject(email.subject), messageId };
}
/**
 * Auto-resolvers for the reply placeholders. One `Email/get` is shared by all
 * three, and only runs when a reply placeholder is actually referenced.
 */
export function replyContextResolvers(load) {
    let pending;
    const ctx = () => (pending ??= load());
    return {
        REPLY_TO: async () => (await ctx()).to,
        REPLY_SUBJECT: async () => (await ctx()).subject,
        REPLY_MESSAGE_ID: async () => (await ctx()).messageId,
    };
}
