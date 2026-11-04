// What send_email and reply_to_message add on top of a plain-text message: an
// HTML body, a From display name and Reply-To addresses. The hosted MCP server
// and the client packages carry this same file: change both together.
//
// All of this is caller text, so it reaches the JMAP batch through `vars`
// (JSON-escaped, one non-recursive pass), never through the template.

import { parsePerson } from "../calendar/invites.ts";

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

const MAX_FROM_NAME = 100;
const MAX_ADDRESS = 512;

/** Split on `,` `;` and newlines, but not inside quotes or angle brackets. */
function splitAddressList(raw: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  let angle = false;
  for (const ch of raw) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === "<") angle = true;
    else if (!quoted && ch === ">") angle = false;
    if (!quoted && !angle && (ch === "," || ch === ";" || ch === "\n")) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * `anna@x.com`, `Anna <anna@x.com>`, or several of those (an array, or one
 * string separated by commas). Throws on anything that is not an address.
 */
export function parseAddressList(
  value: string | string[] | undefined,
  field: string,
): MailAddress[] {
  if (value === undefined) return [];
  const raw = (Array.isArray(value) ? value : [value]).flatMap(
    splitAddressList,
  );
  const seen = new Set<string>();
  const out: MailAddress[] = [];
  for (const item of raw) {
    const person = item.length <= MAX_ADDRESS ? parsePerson(item) : null;
    if (!person) {
      throw new Error(
        `${field}: '${item.slice(0, 80)}' is not an email address. Use ` +
          'anna@example.com or "Doe, Anna" <anna@example.com>.',
      );
    }
    if (seen.has(person.email)) continue;
    seen.add(person.email);
    out.push(person);
  }
  return out;
}

/**
 * The display name on the From header. The address itself is always this inbox,
 * so a name that looks like an address (a spoofing classic) is refused here.
 */
export function parseFromName(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const name = raw
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length === 0) return undefined;
  if (name.length > MAX_FROM_NAME) {
    throw new Error(`from_name is limited to ${MAX_FROM_NAME} characters.`);
  }
  if (/[<>@]/.test(name)) {
    throw new Error(
      "from_name is a display name only, e.g. Anna from Acme: no email " +
        "address or angle brackets. The address is always this inbox's.",
    );
  }
  return name;
}

/**
 * Check and normalize the arguments. `body` and `html_body` are both optional,
 * but one must be given; without `body` the text part is derived from the HTML,
 * so a message is never HTML-only (spam filters mark that down).
 */
export function composeFromInput(input: ComposeInput): Composed {
  const htmlBody = input.html_body?.trim() ? input.html_body : undefined;
  if (input.body === undefined && htmlBody === undefined) {
    throw new Error("Provide body (plain text) and/or html_body.");
  }
  const text = htmlBody !== undefined && !input.body?.trim()
    ? htmlToPlainText(htmlBody)
    : input.body ?? "";

  const options: ComposeOptions = {};
  if (htmlBody !== undefined) options.htmlBody = htmlBody;
  const fromName = parseFromName(input.from_name);
  if (fromName !== undefined) options.fromName = fromName;
  const replyTo = parseAddressList(input.reply_to, "reply_to");
  if (replyTo.length > 0) options.replyTo = replyTo;
  return { text, options };
}

/** Put one address into `vars` and return its `$VAR` form for the template. */
export function addressToken(
  prefix: string,
  address: MailAddress,
  vars: Record<string, string>,
): { email: string; name?: string } {
  vars[`${prefix}_EMAIL`] = address.email;
  if (address.name === undefined) return { email: `$${prefix}_EMAIL` };
  vars[`${prefix}_NAME`] = address.name;
  return { email: `$${prefix}_EMAIL`, name: `$${prefix}_NAME` };
}

/**
 * The Email/set create shared by send and reply: filed in Sent as a draft until
 * the submission succeeds, From this inbox, with the compose options applied.
 * Without `bodyStructure`, `textBody` + `htmlBody` become multipart/alternative.
 */
export function buildDraft(
  subjectToken: string,
  options: ComposeOptions,
  vars: Record<string, string>,
): Record<string, unknown> {
  const from: { email: string; name?: string } = { email: "$INBOX" };
  if (options.fromName !== undefined) {
    vars.FROM_NAME = options.fromName;
    from.name = "$FROM_NAME";
  }
  const bodyValues: Record<string, { value: string }> = {
    b: { value: "$BODY" },
  };
  const draft: Record<string, unknown> = {
    mailboxIds: { "$SENT_MAILBOX_ID": true },
    from: [from],
    subject: subjectToken,
    textBody: [{ partId: "b", type: "text/plain" }],
    bodyValues,
    keywords: { $draft: true, $seen: true },
  };
  if (options.htmlBody !== undefined) {
    vars.HTML_BODY = options.htmlBody;
    bodyValues.h = { value: "$HTML_BODY" };
    draft.htmlBody = [{ partId: "h", type: "text/html" }];
  }
  if (options.replyTo && options.replyTo.length > 0) {
    draft.replyTo = options.replyTo.map((a, i) =>
      addressToken(`HEADER_REPLY_TO_${i}`, a, vars)
    );
  }
  return draft;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
};

function decodeEntity(match: string, body: string): string {
  if (body[0] !== "#") {
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  }
  const hex = body[1] === "x" || body[1] === "X";
  const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : match;
}

/** Dropped with everything inside them. */
const SKIPPED_TAGS = new Set(["script", "style", "head", "title"]);

const BLOCK_TAGS = new Set([
  "p",
  "div",
  "tr",
  "table",
  "ul",
  "ol",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "section",
  "article",
  "header",
  "footer",
  "hr",
  "pre",
]);

const TAG_NAME_RE = /^(\/?)([a-zA-Z][a-zA-Z0-9]*)/;
const HREF_RE = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

/**
 * A readable text version of an HTML body: scripts and styles dropped, block
 * tags as line breaks, `text (url)` for links. A hand-written scan rather than
 * regexes over the whole body: the input can be any size, and `<[^>]+>` is
 * quadratic on a body full of `<`.
 */
export function htmlToPlainText(html: string): string {
  let out = "";
  let i = 0;
  let href: string | undefined;
  let linkStart = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, lt);
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      if (end === -1) break;
      i = end + 3;
      continue;
    }
    // A `<` that opens no tag is text. Checked before looking for `>`, so a
    // body of `<<<<…>` stays linear.
    if (!/[a-zA-Z/!?]/.test(html[lt + 1] ?? "")) {
      out += "<";
      i = lt + 1;
      continue;
    }
    const gt = html.indexOf(">", lt + 1);
    if (gt === -1) break; // unterminated tag: the rest is not text
    const tag = html.slice(lt + 1, gt);
    i = gt + 1;
    const match = TAG_NAME_RE.exec(tag);
    if (!match) continue;
    const closing = match[1] === "/";
    const name = match[2].toLowerCase();

    if (!closing && SKIPPED_TAGS.has(name)) {
      const close = new RegExp(`</${name}`, "gi");
      close.lastIndex = i;
      const found = close.exec(html);
      if (!found) break;
      const closeGt = html.indexOf(">", found.index);
      if (closeGt === -1) break;
      i = closeGt + 1;
      continue;
    }
    if (name === "br") {
      out += "\n";
    } else if (name === "li") {
      if (!closing) out += "\n- ";
    } else if (BLOCK_TAGS.has(name)) {
      out += "\n";
    } else if (name === "a") {
      if (!closing) {
        const m = HREF_RE.exec(tag);
        const url = m ? (m[1] ?? m[2] ?? m[3] ?? "").trim() : "";
        href = /^(https?:|mailto:)/i.test(url) ? url : undefined;
        linkStart = out.length;
      } else if (href !== undefined) {
        const text = out.slice(linkStart).trim();
        if (text !== href) out += text ? ` (${href})` : href;
        href = undefined;
      }
    }
  }
  return out
    .replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, decodeEntity)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
