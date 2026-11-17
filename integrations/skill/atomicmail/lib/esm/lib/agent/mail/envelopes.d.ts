import { type ComposeOptions, type MailAddress } from "./compose.js";
/** read_inbox: the latest `limit` inbox messages. */
export declare function buildReadInboxOps(limit: number): string;
/** search_messages: full-text query (vars: `QUERY`). */
export declare function buildSearchOps(limit: number): string;
/** read_message: one message with headers and bodies (vars: `MESSAGE_ID`). */
export declare function buildReadMessageOps(): string;
/** send_email: draft + submit. The caller adds `SUBJECT` and `BODY` to vars. */
export declare function buildSendEmailOps(opts: {
    to: MailAddress[];
    cc?: MailAddress[];
    bcc?: MailAddress[];
    attachmentCount: number;
    compose?: ComposeOptions;
}): {
    opsJson: string;
    vars: Record<string, string>;
};
/** reply step 1: the headers needed to address a reply (vars: `MAIL_ID`). */
export declare function buildReplyLookupOps(): string;
interface JmapAddr {
    email?: string | null;
    name?: string | null;
}
interface JmapPart {
    partId?: string | null;
    blobId?: string | null;
    type?: string | null;
    name?: string | null;
    size?: number | null;
}
interface JmapEmail {
    id?: string;
    threadId?: string | null;
    subject?: string | null;
    preview?: string | null;
    from?: JmapAddr[] | null;
    to?: JmapAddr[] | null;
    cc?: JmapAddr[] | null;
    sender?: JmapAddr[] | null;
    replyTo?: JmapAddr[] | null;
    receivedAt?: string | null;
    messageId?: string[] | null;
    inReplyTo?: string[] | null;
    references?: string[] | null;
    keywords?: Record<string, boolean> | null;
    textBody?: JmapPart[] | null;
    htmlBody?: JmapPart[] | null;
    bodyValues?: Record<string, {
        value?: string;
        isTruncated?: boolean;
    }> | null;
    attachments?: JmapPart[] | null;
}
export interface ReplyHeaders {
    to: MailAddress[];
    subject: string;
    inReplyTo: string[];
    references: string[];
}
/**
 * Reply headers from the step-1 Email/get (RFC 5322 §3.6.4): To = Reply-To, else
 * From, else Sender; one "Re: " prefix; In-Reply-To = the original Message-ID;
 * References = the original's References (or In-Reply-To) + its Message-ID.
 */
export declare function computeReplyHeaders(bodyText: string, mailId: string): ReplyHeaders;
/** reply step 2: the send batch, with every original's value in `vars`. */
export declare function buildReplyOps(headers: ReplyHeaders, attachmentCount: number, compose?: ComposeOptions): {
    opsJson: string;
    vars: Record<string, string>;
};
/**
 * JMAP answers a rejected create with HTTP 200 and a `notCreated` map (or a
 * method-level `error`). The first such failure, readable, or null.
 */
export declare function findJmapSetFailure(bodyText: string): string | null;
/** The `id` and `threadId` Email/set assigned to the sent message. */
export declare function sentMessageIds(bodyText: string): {
    id: string | null;
    threadId: string | null;
};
/** The Email/get `list` of a JMAP response, or throw on a method error. */
export declare function extractEmailList(bodyText: string): JmapEmail[];
/**
 * The body as bounded plain text: the text parts, else the HTML parts stripped
 * to text, else the preview. `textBody` itself can point at an HTML part when
 * the message has no plain one, so the part's own type decides.
 */
export declare function extractBodyText(email: JmapEmail, maxLen?: number): {
    text: string;
    truncated: boolean;
};
export interface MessageSummary {
    id: string;
    threadId: string | null;
    subject: string;
    from: JmapAddr[] | null;
    to: JmapAddr[] | null;
    preview: string | null;
    receivedAt: string | null;
    unread: boolean;
}
/** read_inbox / search_messages result: one row per message. */
export declare function toMessageSummaries(bodyText: string): {
    messages: MessageSummary[];
};
export interface MessageDocument {
    id: string;
    threadId: string | null;
    subject: string;
    from: JmapAddr[] | null;
    to: JmapAddr[] | null;
    cc: JmapAddr[] | null;
    replyTo: JmapAddr[] | null;
    receivedAt: string | null;
    unread: boolean;
    attachments: {
        name: string | null;
        type: string | null;
        size: number | null;
        blobId: string | null;
    }[] | null;
    bodyTruncated: boolean;
    /** Plain text, length-capped, wrapped in an untrusted-content delimiter. */
    body: string;
}
/**
 * read_message result. The body is plain text, capped, and delimited as
 * untrusted data; raw HTML and raw body values never reach the model.
 */
export declare function toMessageDocument(bodyText: string, id: string): MessageDocument;
export {};
//# sourceMappingURL=envelopes.d.ts.map