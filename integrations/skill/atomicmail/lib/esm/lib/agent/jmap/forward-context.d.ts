type PostJmap = (envelope: {
    using: string[];
    methodCalls: [string, Record<string, unknown>, string][];
}) => Promise<{
    ok: boolean;
    status: number;
    bodyText: string;
}>;
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
export declare const FORWARD_VAR_NAMES: readonly ["FORWARD_SUBJECT", "FORWARD_TEXT", "FORWARD_BLOB_ID", "FORWARD_NAME"];
export declare function forwardSubject(subject: unknown): string;
/** The subject as a safe `.eml` filename. */
export declare function forwardFilename(subject: unknown): string;
export declare function fetchForwardContext(post: PostJmap, accountId: string, mailId: string | undefined): Promise<ForwardContext>;
/**
 * Auto-resolvers for the forward placeholders. One `Email/get` is shared by all
 * of them, and only runs when a forward placeholder is actually referenced.
 */
export declare function forwardContextResolvers(load: () => Promise<ForwardContext>): Record<(typeof FORWARD_VAR_NAMES)[number], () => Promise<string>>;
export {};
//# sourceMappingURL=forward-context.d.ts.map