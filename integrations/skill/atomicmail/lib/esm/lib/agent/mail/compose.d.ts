export interface MailAddress {
    email: string;
    name?: string;
}
/** The tool arguments, as the tools and the CLI receive them. */
export interface ComposeInput {
    body?: string;
    html_body?: string;
    from_name?: string;
    reply_to?: string | string[];
}
export interface ComposeOptions {
    htmlBody?: string;
    fromName?: string;
    replyTo?: MailAddress[];
}
export interface Composed {
    /** The text/plain part. */
    text: string;
    options: ComposeOptions;
}
/**
 * `anna@x.com`, `Anna <anna@x.com>`, or several of those (an array, or one
 * string separated by commas). Throws on anything that is not an address.
 */
export declare function parseAddressList(value: string | string[] | undefined, field: string): MailAddress[];
/**
 * The display name on the From header. The address itself is always this inbox,
 * so a name that looks like an address (a spoofing classic) is refused here.
 */
export declare function parseFromName(raw: string | undefined): string | undefined;
/**
 * Check and normalize the arguments. `body` and `html_body` are both optional,
 * but one must be given; without `body` the text part is derived from the HTML,
 * so a message is never HTML-only (spam filters mark that down).
 */
export declare function composeFromInput(input: ComposeInput): Composed;
/** Put one address into `vars` and return its `$VAR` form for the template. */
export declare function addressToken(prefix: string, address: MailAddress, vars: Record<string, string>): {
    email: string;
    name?: string;
};
/**
 * The Email/set create shared by send and reply: filed in Sent as a draft until
 * the submission succeeds, From this inbox, with the compose options applied.
 * Without `bodyStructure`, `textBody` + `htmlBody` become multipart/alternative.
 */
export declare function buildDraft(subjectToken: string, options: ComposeOptions, vars: Record<string, string>): Record<string, unknown>;
/**
 * A readable text version of an HTML body: scripts and styles dropped, block
 * tags as line breaks, `text (url)` for links. A hand-written scan rather than
 * regexes over the whole body: the input can be any size, and `<[^>]+>` is
 * quadratic on a body full of `<`.
 */
export declare function htmlToPlainText(html: string): string;
//# sourceMappingURL=compose.d.ts.map