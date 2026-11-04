// Forward placeholders ($FORWARD_SUBJECT, $FORWARD_TEXT, $FORWARD_BLOB_ID,
// $FORWARD_NAME) derived from the message named by $MAIL_ID. Same reason as the
// reply placeholders (reply-context.ts): one batch cannot copy fields of the
// original into an `Email/set` create, so the client looks them up first.

import { htmlToPlainText } from "../mail/compose.ts";

type PostJmap = (envelope: {
  using: string[];
  methodCalls: [string, Record<string, unknown>, string][];
}) => Promise<{ ok: boolean; status: number; bodyText: string }>;

export interface ForwardContext {
  /** Original subject with a single `Fwd: ` prefix. */
  subject: string;
  /** The usual "Forwarded message" block: the headers, then the text. */
  text: string;
  /** Blob of the whole original, attached as message/rfc822. */
  blobId: string;
  /** Filename for that attachment. */
  name: string;
}

export const FORWARD_VAR_NAMES = [
  "FORWARD_SUBJECT",
  "FORWARD_TEXT",
  "FORWARD_BLOB_ID",
  "FORWARD_NAME",
] as const;

/** Enough text to read; the full original is always attached. */
const MAX_QUOTED_BYTES = 262_144;

const FWD_PREFIX = /^\s*(fwd?)\s*:/i;

export function forwardSubject(subject: unknown): string {
  const s = (typeof subject === "string" ? subject : "")
    .replace(/[\r\n]+/g, " ")
    .trim();
  return FWD_PREFIX.test(s) ? s : `Fwd: ${s}`.trimEnd();
}

/** The subject as a safe `.eml` filename. */
export function forwardFilename(subject: unknown): string {
  const base = (typeof subject === "string" ? subject : "")
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
    .trim();
  return `${base || "message"}.eml`;
}

type Address = { email?: string | null; name?: string | null };

function formatAddresses(list: unknown): string {
  if (!Array.isArray(list)) return "";
  return (list as (Address | null)[])
    .filter((a) => typeof a?.email === "string" && a.email.length > 0)
    .map((a) => (a!.name ? `${a!.name} <${a!.email}>` : a!.email!))
    .join(", ")
    .replace(/[\r\n]+/g, " ");
}

type Part = { partId?: string | null; type?: string | null };

function quotedText(email: Record<string, unknown>): string {
  const values = (email.bodyValues ?? {}) as Record<
    string,
    { value?: string; isTruncated?: boolean }
  >;
  let truncated = false;
  const chunks = ((email.textBody ?? []) as Part[]).flatMap((part) => {
    const body = part.partId ? values[part.partId] : undefined;
    if (!body?.value) return [];
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

export async function fetchForwardContext(
  post: PostJmap,
  accountId: string,
  mailId: string | undefined,
): Promise<ForwardContext> {
  if (!mailId) {
    throw new Error(
      "$FORWARD_SUBJECT / $FORWARD_TEXT / $FORWARD_BLOB_ID / $FORWARD_NAME " +
        "need MAIL_ID in vars (the id of the message to forward).",
    );
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
    throw new Error(
      `Email/get for forward failed (HTTP ${status}): ${bodyText}`,
    );
  }
  let first: unknown[] | undefined;
  try {
    const parsed = JSON.parse(bodyText) as { methodResponses?: unknown[][] };
    first = parsed.methodResponses?.[0];
  } catch {
    throw new Error("Email/get for forward returned invalid JSON.");
  }
  if (Array.isArray(first) && first[0] === "error") {
    throw new Error(
      `Email/get for forward failed: ${JSON.stringify(first[1])}`,
    );
  }
  const email = Array.isArray(first) && first[0] === "Email/get"
    ? (first[1] as { list?: Record<string, unknown>[] } | undefined)?.list?.[0]
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
  if (cc) header.push(`Cc: ${cc}`);

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
export function forwardContextResolvers(
  load: () => Promise<ForwardContext>,
): Record<(typeof FORWARD_VAR_NAMES)[number], () => Promise<string>> {
  let pending: Promise<ForwardContext> | undefined;
  const ctx = () => (pending ??= load());
  return {
    FORWARD_SUBJECT: async () => (await ctx()).subject,
    FORWARD_TEXT: async () => (await ctx()).text,
    FORWARD_BLOB_ID: async () => (await ctx()).blobId,
    FORWARD_NAME: async () => (await ctx()).name,
  };
}
