// Forward placeholders ($FORWARD_SUBJECT, $FORWARD_TEXT, $FORWARD_BLOB_ID,
// $FORWARD_NAME) derived from the message named by $MAIL_ID. Same reason as the
// reply placeholders (reply-context.ts): one batch cannot copy fields of the
// original into an `Email/set` create, so the client looks them up first.
import { htmlToPlainText } from "../mail/compose.js";
export const FORWARD_VAR_NAMES = [
    "FORWARD_SUBJECT",
    "FORWARD_TEXT",
    "FORWARD_BLOB_ID",
    "FORWARD_NAME",
];
/** Enough text to read; the full original is always attached. */
const MAX_QUOTED_BYTES = 262_144;
const FWD_PREFIX = /^\s*(fwd?)\s*:/i;
export function forwardSubject(subject) {
    const s = (typeof subject === "string" ? subject : "")
        .replace(/[\r\n]+/g, " ")
        .trim();
    return FWD_PREFIX.test(s) ? s : `Fwd: ${s}`.trimEnd();
}
/** The subject as a safe `.eml` filename. */
export function forwardFilename(subject) {
    const base = (typeof subject === "string" ? subject : "")
        // deno-lint-ignore no-control-regex
        .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 100)
        .trim();
    return `${base || "message"}.eml`;
}
function formatAddresses(list) {
    if (!Array.isArray(list))
        return "";
    return list
        .filter((a) => typeof a?.email === "string" && a.email.length > 0)
        .map((a) => (a.name ? `${a.name} <${a.email}>` : a.email))
        .join(", ")
        .replace(/[\r\n]+/g, " ");
}
function quotedText(email) {
    const values = (email.bodyValues ?? {});
    let truncated = false;
    const chunks = (email.textBody ?? []).flatMap((part) => {
        const body = part.partId ? values[part.partId] : undefined;
        if (!body?.value)
            return [];
        truncated ||= body.isTruncated === true;
        return part.type?.toLowerCase() === "text/html"
            ? [htmlToPlainText(body.value)]
            : [body.value.replace(/\r\n?/g, "\n")];
    });
    const text = chunks.join("\n").trim();
    return truncated
        ? `${text}\n\n[Cut here; the full message is attached.]`
        : text;
}
export async function fetchForwardContext(post, accountId, mailId) {
    if (!mailId) {
        throw new Error("$FORWARD_SUBJECT / $FORWARD_TEXT / $FORWARD_BLOB_ID / $FORWARD_NAME " +
            "need MAIL_ID in vars (the id of the message to forward).");
    }
    const { ok, status, bodyText } = await post({
        using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
        methodCalls: [[
                "Email/get",
                {
                    accountId,
                    ids: [mailId],
                    properties: [
                        "blobId",
                        "from",
                        "to",
                        "cc",
                        "subject",
                        "sentAt",
                        "receivedAt",
                        "textBody",
                        "bodyValues",
                    ],
                    fetchTextBodyValues: true,
                    maxBodyValueBytes: MAX_QUOTED_BYTES,
                },
                "fg0",
            ]],
    });
    if (!ok) {
        throw new Error(`Email/get for forward failed (HTTP ${status}): ${bodyText}`);
    }
    let first;
    try {
        const parsed = JSON.parse(bodyText);
        first = parsed.methodResponses?.[0];
    }
    catch {
        throw new Error("Email/get for forward returned invalid JSON.");
    }
    if (Array.isArray(first) && first[0] === "error") {
        throw new Error(`Email/get for forward failed: ${JSON.stringify(first[1])}`);
    }
    const email = Array.isArray(first) && first[0] === "Email/get"
        ? first[1]?.list?.[0]
        : undefined;
    if (!email) {
        throw new Error(`MAIL_ID ${mailId} not found; nothing to forward.`);
    }
    if (typeof email.blobId !== "string" || email.blobId.length === 0) {
        throw new Error(`Message ${mailId} has no blobId to attach.`);
    }
    const subject = typeof email.subject === "string"
        ? email.subject.replace(/[\r\n]+/g, " ").trim()
        : "";
    const header = [
        "---------- Forwarded message ---------",
        `From: ${formatAddresses(email.from)}`,
        `Date: ${email.sentAt ?? email.receivedAt ?? ""}`,
        `Subject: ${subject}`,
        `To: ${formatAddresses(email.to)}`,
    ];
    const cc = formatAddresses(email.cc);
    if (cc)
        header.push(`Cc: ${cc}`);
    return {
        subject: forwardSubject(email.subject),
        text: `${header.join("\n")}\n\n${quotedText(email)}`,
        blobId: email.blobId,
        name: forwardFilename(email.subject),
    };
}
/**
 * Auto-resolvers for the forward placeholders. One `Email/get` is shared by all
 * of them, and only runs when a forward placeholder is actually referenced.
 */
export function forwardContextResolvers(load) {
    let pending;
    const ctx = () => (pending ??= load());
    return {
        FORWARD_SUBJECT: async () => (await ctx()).subject,
        FORWARD_TEXT: async () => (await ctx()).text,
        FORWARD_BLOB_ID: async () => (await ctx()).blobId,
        FORWARD_NAME: async () => (await ctx()).name,
    };
}
