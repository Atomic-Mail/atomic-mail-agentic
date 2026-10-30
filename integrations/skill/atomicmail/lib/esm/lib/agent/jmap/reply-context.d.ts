type PostJmap = (envelope: {
    using: string[];
    methodCalls: [string, Record<string, unknown>, string][];
}) => Promise<{
    ok: boolean;
    status: number;
    bodyText: string;
}>;
export interface ReplyContext {
    /** First usable Reply-To address of the original, else From, else Sender. */
    to: string;
    /** Original subject with a single `Re: ` prefix. */
    subject: string;
    /** Message-ID of the original (for In-Reply-To / References). */
    messageId: string;
}
export declare const REPLY_VAR_NAMES: readonly ["REPLY_TO", "REPLY_SUBJECT", "REPLY_MESSAGE_ID"];
/**
 * Same rule as the hosted MCP server: newlines collapse to one space, and a
 * single `Re: ` is added unless the subject already starts with one.
 */
export declare function replySubject(subject: unknown): string;
export declare function fetchReplyContext(post: PostJmap, accountId: string, mailId: string | undefined): Promise<ReplyContext>;
/**
 * Auto-resolvers for the reply placeholders. One `Email/get` is shared by all
 * three, and only runs when a reply placeholder is actually referenced.
 */
export declare function replyContextResolvers(load: () => Promise<ReplyContext>): Record<(typeof REPLY_VAR_NAMES)[number], () => Promise<string>>;
export {};
//# sourceMappingURL=reply-context.d.ts.map