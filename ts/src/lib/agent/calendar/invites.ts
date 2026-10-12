// Meeting invitations over email: iTIP objects (REQUEST / CANCEL / REPLY), the
// human-readable message around them, and the state an agent sees in
// list_invites. Pure — the JMAP round trips live in src/tools/calendar-tools.ts.
//
// No calendar is stored server-side. The agent's Sent mailbox is the record:
// every invitation, update, cancellation and reply we send carries the event
// UID in the `X-Atomic-Calendar-Uid` header, so the latest version of an
// invitation is found with one header query, and the attendees' answers are
// the REPLY objects that come back to the inbox.

import {
  collectTimeZones,
  emailToMailto,
  escapeText,
  formatProperty,
  formatUtc,
  getProp,
  getProps,
  getText,
  type IcalComponent,
  isValidTimeZone,
  mailtoToEmail,
  parseDurationMs,
  parseIcal,
  parseTimeProp,
  unescapeText,
  zonedWallTimeToUtc,
} from "./ical.ts";

export const CALENDAR_UID_HEADER = "X-Atomic-Calendar-Uid";
export const PRODID = "-//Atomic Mail//Agent Calendar 1.0//EN";

/**
 * Hard cap on attendees per invitation (the egress MTA caps recipients too).
 * Large guest lists are a calendar-spam signal (CalConnect/M3AAWG 2019).
 */
export const MAX_ATTENDEES = 25;
/** How far ahead a meeting may start, and how stale a start we still accept. */
export const MAX_START_AHEAD_MS = 2 * 366 * 24 * 60 * 60_000;
export const MAX_START_PAST_MS = 10 * 60_000;
export const MAX_TITLE_CHARS = 200;
export const MAX_DESCRIPTION_CHARS = 8_000;
export const MAX_LOCATION_CHARS = 500;
export const MAX_COMMENT_CHARS = 1_000;
/** Longest event we accept (31 days). */
export const MAX_DURATION_MS = 31 * 24 * 60 * 60_000;

export type Method = "REQUEST" | "CANCEL" | "REPLY" | "COUNTER";
export type PartStat =
  | "NEEDS-ACTION"
  | "ACCEPTED"
  | "DECLINED"
  | "TENTATIVE"
  | "DELEGATED";

/** The answers a tool caller can give. */
export type Response = "accepted" | "declined" | "tentative";

export const RESPONSE_TO_PARTSTAT: Record<Response, PartStat> = {
  accepted: "ACCEPTED",
  declined: "DECLINED",
  tentative: "TENTATIVE",
};

export interface Person {
  email: string;
  name?: string;
}

export interface Attendee extends Person {
  partstat?: PartStat;
  comment?: string;
}

/** The event as we send it. Times are absolute instants. */
export interface OutgoingEvent {
  uid: string;
  sequence: number;
  title: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  organizer: Person;
  attendees: Attendee[];
}

// ---------------------------------------------------------------------------
// Input validation (tool arguments)
// ---------------------------------------------------------------------------

const OFFSET_RE = /(Z|[+-]\d{2}:?\d{2})$/i;
const LOCAL_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;

/**
 * Parse a tool-supplied start/end. ISO 8601 with an offset (`…Z`,
 * `…+03:00`) is absolute. A local time (`2026-10-16T15:00`) needs `timeZone`
 * (IANA, e.g. `Europe/Moscow`); without one we refuse rather than guess —
 * a wrong guess books the meeting at the wrong hour for everyone.
 */
export function parseUserDateTime(
  value: string,
  timeZone: string | undefined,
  field: string,
): Date {
  const v = value.trim();
  if (OFFSET_RE.test(v)) {
    const ms = Date.parse(v);
    if (!Number.isFinite(ms) || !/^\d{4}-\d{2}-\d{2}T/.test(v)) {
      throw new Error(
        `${field} must be ISO 8601, e.g. 2026-10-16T15:00:00+03:00.`,
      );
    }
    return new Date(ms);
  }
  const m = v.match(LOCAL_RE);
  if (!m) {
    throw new Error(
      `${field} must be ISO 8601, e.g. 2026-10-16T15:00:00+03:00, or a local ` +
        "time like 2026-10-16T15:00 together with time_zone.",
    );
  }
  if (!timeZone) {
    throw new Error(
      `${field} has no UTC offset. Add one (e.g. +03:00) or pass time_zone ` +
        "(an IANA name such as Europe/Moscow). Ask the user which time zone " +
        "they mean rather than guessing.",
    );
  }
  if (!isValidTimeZone(timeZone)) {
    throw new Error(`Unknown time_zone '${timeZone}'. Use an IANA name.`);
  }
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(
    Number,
  );
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) {
    throw new Error(`${field} is not a valid date and time.`);
  }
  return zonedWallTimeToUtc({ y, mo, d, h, mi, s }, timeZone);
}

/** Refuse meetings in the past or absurdly far ahead (typo, abuse). */
export function checkStart(start: Date, now = new Date()): void {
  if (start.getTime() < now.getTime() - MAX_START_PAST_MS) {
    throw new Error(
      `start ${start.toISOString()} is in the past. Check the date and the time zone.`,
    );
  }
  if (start.getTime() > now.getTime() + MAX_START_AHEAD_MS) {
    throw new Error("start is more than two years ahead.");
  }
}

/** Resolve end from `end` or `duration_minutes` (default 30 minutes). */
export function resolveEnd(input: {
  start: Date;
  end?: string;
  durationMinutes?: number;
  timeZone?: string;
}): Date {
  let end: Date;
  if (input.end) {
    end = parseUserDateTime(input.end, input.timeZone, "end");
  } else {
    const minutes = input.durationMinutes ?? 30;
    end = new Date(input.start.getTime() + minutes * 60_000);
  }
  const span = end.getTime() - input.start.getTime();
  if (span <= 0) throw new Error("end must be after start.");
  if (span > MAX_DURATION_MS) {
    throw new Error("An invitation can span at most 31 days.");
  }
  return end;
}

/** `Anna <anna@x.com>`, `"Anna B" <anna@x.com>` or `anna@x.com`. */
export function parsePerson(raw: string): Person | null {
  const v = raw.trim();
  const angle = v.match(/^(.*)<([^<>\s]+@[^<>\s]+)>$/);
  if (angle) {
    const name = angle[1].trim().replace(/^"|"$/g, "").trim();
    const email = angle[2].trim().toLowerCase();
    return { email, ...(name ? { name } : {}) };
  }
  if (/^[^\s@<>",;:]+@[^\s@<>",;:]+\.[^\s@<>",;:]+$/.test(v)) {
    return { email: v.toLowerCase() };
  }
  return null;
}

export function parseAttendees(raw: string[]): Person[] {
  const out: Person[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const p = parsePerson(r);
    if (!p) throw new Error(`'${r}' is not an email address.`);
    if (seen.has(p.email)) continue;
    seen.add(p.email);
    out.push(p);
  }
  if (out.length === 0) throw new Error("Invite at least one attendee.");
  if (out.length > MAX_ATTENDEES) {
    throw new Error(`At most ${MAX_ATTENDEES} attendees per invitation.`);
  }
  return out;
}

export function checkLength(
  value: string | undefined,
  max: number,
  field: string,
): void {
  if (value !== undefined && value.length > max) {
    throw new Error(`${field} is longer than ${max} characters.`);
  }
}

/**
 * A random UUID. RFC 7986 §5.3 recommends UIDs carry no host, domain or user
 * (the organizer stays private to the object). `_organizerEmail` is unused and
 * kept for call-site stability.
 */
export function newEventUid(_organizerEmail?: string): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Building iTIP objects
// ---------------------------------------------------------------------------

function vcalendarHead(method: Method): string {
  return [
    "BEGIN:VCALENDAR\r\n",
    formatProperty("PRODID", {}, PRODID),
    "VERSION:2.0\r\n",
    "CALSCALE:GREGORIAN\r\n",
    `METHOD:${method}\r\n`,
  ].join("");
}

function organizerLine(p: Person): string {
  return formatProperty("ORGANIZER", { CN: p.name }, emailToMailto(p.email));
}

function attendeeLine(a: Attendee, rsvp: boolean): string {
  return formatProperty(
    "ATTENDEE",
    {
      CUTYPE: "INDIVIDUAL",
      ROLE: "REQ-PARTICIPANT",
      PARTSTAT: a.partstat ?? "NEEDS-ACTION",
      RSVP: rsvp ? "TRUE" : undefined,
      CN: a.name,
    },
    emailToMailto(a.email),
  );
}

function eventCore(ev: OutgoingEvent, now: Date): string {
  let s = "";
  s += formatProperty("UID", {}, ev.uid);
  s += `DTSTAMP:${formatUtc(now)}\r\n`;
  s += `SEQUENCE:${ev.sequence}\r\n`;
  s += `DTSTART:${formatUtc(ev.start)}\r\n`;
  s += `DTEND:${formatUtc(ev.end)}\r\n`;
  s += formatProperty("SUMMARY", {}, escapeText(ev.title));
  if (ev.description) {
    s += formatProperty("DESCRIPTION", {}, escapeText(ev.description));
  }
  if (ev.location) s += formatProperty("LOCATION", {}, escapeText(ev.location));
  s += organizerLine(ev.organizer);
  return s;
}

/** METHOD:REQUEST — a new invitation or an update (bump `sequence`). */
export function buildRequestIcs(ev: OutgoingEvent, now = new Date()): string {
  let s = vcalendarHead("REQUEST");
  s += "BEGIN:VEVENT\r\n";
  s += eventCore(ev, now);
  for (const a of ev.attendees) s += attendeeLine(a, true);
  s += "STATUS:CONFIRMED\r\n";
  s += "TRANSP:OPAQUE\r\n";
  s += "END:VEVENT\r\nEND:VCALENDAR\r\n";
  return s;
}

/**
 * METHOD:CANCEL. For the whole meeting: every attendee and
 * STATUS:CANCELLED. To uninvite some attendees (`partial`): only them and no
 * STATUS, so the meeting itself stays alive (RFC 5546 §3.2.5).
 */
export function buildCancelIcs(
  ev: OutgoingEvent,
  now = new Date(),
  comment?: string,
  partial = false,
): string {
  let s = vcalendarHead("CANCEL");
  s += "BEGIN:VEVENT\r\n";
  s += eventCore(ev, now);
  for (const a of ev.attendees) s += attendeeLine(a, false);
  if (comment) s += formatProperty("COMMENT", {}, escapeText(comment));
  if (!partial) s += "STATUS:CANCELLED\r\n";
  s += "END:VEVENT\r\nEND:VCALENDAR\r\n";
  return s;
}

/**
 * METHOD:REPLY — our answer to someone else's invitation. Echoes UID,
 * SEQUENCE, DTSTART/DTEND, SUMMARY and ORGANIZER from the request, plus one
 * ATTENDEE (us) with the chosen PARTSTAT (RFC 5546 §3.2.3).
 */
export function buildReplyIcs(
  invite: ParsedEvent,
  me: Person,
  partstat: PartStat,
  now = new Date(),
  comment?: string,
): string {
  if (!invite.organizer) {
    throw new Error("The invitation has no organizer to answer.");
  }
  let s = vcalendarHead("REPLY");
  s += "BEGIN:VEVENT\r\n";
  s += formatProperty("UID", {}, invite.uid);
  s += `DTSTAMP:${formatUtc(now)}\r\n`;
  s += `SEQUENCE:${invite.sequence}\r\n`;
  if (invite.recurrenceIdRaw) s += invite.recurrenceIdRaw;
  if (invite.allDayDate && invite.start) {
    s += `DTSTART;VALUE=DATE:${invite.allDayDate.replace(/-/g, "")}\r\n`;
  } else if (invite.start) {
    s += `DTSTART:${formatUtc(invite.start)}\r\n`;
    if (invite.end) s += `DTEND:${formatUtc(invite.end)}\r\n`;
  }
  if (invite.title) {
    s += formatProperty("SUMMARY", {}, escapeText(invite.title));
  }
  s += organizerLine(invite.organizer);
  s += formatProperty(
    "ATTENDEE",
    { PARTSTAT: partstat, CN: me.name },
    emailToMailto(me.email),
  );
  if (comment) s += formatProperty("COMMENT", {}, escapeText(comment));
  s += "END:VEVENT\r\nEND:VCALENDAR\r\n";
  return s;
}

// ---------------------------------------------------------------------------
// Parsing what arrives (and what we sent)
// ---------------------------------------------------------------------------

export interface ParsedEvent {
  uid: string;
  sequence: number;
  /** DTSTAMP — when the organizer/attendee produced this object. */
  stamp: Date | null;
  title?: string;
  description?: string;
  location?: string;
  /** A meeting link when one is advertised (URL, Google Meet, Teams). */
  meetingUrl?: string;
  start: Date | null;
  end: Date | null;
  /** `YYYY-MM-DD` for all-day events. */
  allDayDate?: string;
  /** Time zone the organizer used, when known. */
  timeZone?: string;
  /** True when local times had to be read as UTC (no usable zone data). */
  timeUncertain?: boolean;
  organizer: Person | null;
  attendees: Attendee[];
  status?: string;
  comment?: string;
  recurring: boolean;
  /** RECURRENCE-ID line as received (one occurrence of a series). */
  recurrenceIdRaw?: string;
}

export interface ParsedCalendar {
  method: string;
  events: ParsedEvent[];
}

function personFromProp(
  value: string,
  params: Record<string, string>,
): Person | null {
  const email = mailtoToEmail(value);
  if (!email) return null;
  const name = params.CN ? unescapeCn(params.CN) : undefined;
  return name ? { email, name } : { email };
}

function unescapeCn(v: string): string {
  return v.replace(/^"|"$/g, "").trim();
}

function findMeetingUrl(ev: IcalComponent): string | undefined {
  for (
    const name of [
      "X-GOOGLE-CONFERENCE",
      "X-MICROSOFT-SKYPETEAMSMEETINGURL",
      "X-MICROSOFT-ONLINEMEETINGEXTERNALLINK",
      "URL",
    ]
  ) {
    const v = getProp(ev, name)?.value.trim();
    if (v && /^https:\/\//i.test(v)) return v;
  }
  for (const c of getProps(ev, "CONFERENCE")) {
    if (/^https:\/\//i.test(c.value.trim())) return c.value.trim();
  }
  const loc = getText(ev, "LOCATION");
  const m = loc?.match(/https:\/\/\S+/);
  return m ? m[0] : undefined;
}

/** Parse an iMIP calendar object. Returns null when it is not iCalendar. */
export function parseCalendar(text: string): ParsedCalendar | null {
  const cal = parseIcal(text);
  if (!cal) return null;
  const method = (getProp(cal, "METHOD")?.value ?? "PUBLISH").trim()
    .toUpperCase();
  const tzs = collectTimeZones(cal);
  const events: ParsedEvent[] = [];
  for (const ev of cal.components) {
    if (ev.name !== "VEVENT") continue;
    const uid = getProp(ev, "UID")?.value.trim();
    if (!uid) continue;
    const startProp = getProp(ev, "DTSTART");
    const start = startProp ? parseTimeProp(startProp, tzs) : null;
    let end: Date | null = null;
    let endUncertain = false;
    const endProp = getProp(ev, "DTEND");
    if (endProp) {
      const e = parseTimeProp(endProp, tzs);
      end = e.instant;
      endUncertain = Boolean(e.assumedUtc);
    } else if (start?.instant) {
      const dur = getProp(ev, "DURATION");
      const ms = dur ? parseDurationMs(dur.value) : null;
      if (ms !== null) end = new Date(start.instant.getTime() + ms);
      else if (start.date) {
        end = new Date(start.instant.getTime() + 24 * 60 * 60_000);
      } else end = start.instant;
    }
    const stampProp = getProp(ev, "DTSTAMP");
    const stamp = stampProp ? parseTimeProp(stampProp, tzs).instant : null;
    const orgProp = getProp(ev, "ORGANIZER");
    const recurrenceId = getProp(ev, "RECURRENCE-ID");
    const attendees: Attendee[] = [];
    for (const a of getProps(ev, "ATTENDEE")) {
      const p = personFromProp(a.value, a.params);
      if (!p) continue;
      const partstat = (a.params.PARTSTAT ?? "NEEDS-ACTION").toUpperCase();
      const note = a.params["X-RESPONSE-COMMENT"];
      attendees.push({
        ...p,
        partstat: partstat as PartStat,
        ...(note ? { comment: unescapeText(note) } : {}),
      });
    }
    const seqRaw = Number(getProp(ev, "SEQUENCE")?.value ?? "0");
    events.push({
      uid,
      sequence: Number.isFinite(seqRaw) && seqRaw >= 0 ? Math.floor(seqRaw) : 0,
      stamp,
      title: getText(ev, "SUMMARY"),
      description: getText(ev, "DESCRIPTION"),
      location: getText(ev, "LOCATION"),
      meetingUrl: findMeetingUrl(ev),
      start: start?.instant ?? null,
      end,
      allDayDate: start?.date,
      timeZone: start?.timeZone,
      timeUncertain: Boolean(start?.assumedUtc) || endUncertain || undefined,
      organizer: orgProp ? personFromProp(orgProp.value, orgProp.params) : null,
      attendees,
      status: getProp(ev, "STATUS")?.value.trim().toUpperCase(),
      // Outlook puts a note in COMMENT; Google in the attendee's
      // X-RESPONSE-COMMENT parameter.
      comment: getText(ev, "COMMENT") ??
        attendees.find((a) => a.comment)?.comment,
      recurring: Boolean(
        getProp(ev, "RRULE") || getProp(ev, "RDATE") || recurrenceId,
      ),
      recurrenceIdRaw: recurrenceId
        ? formatProperty(
          "RECURRENCE-ID",
          recurrenceId.params,
          recurrenceId.value,
        )
        : undefined,
    });
  }
  return { method, events };
}

/** The master VEVENT (no RECURRENCE-ID) or the first one. */
export function primaryEvent(cal: ParsedCalendar): ParsedEvent | null {
  return cal.events.find((e) => !e.recurrenceIdRaw) ?? cal.events[0] ?? null;
}

// ---------------------------------------------------------------------------
// The message around the calendar object
// ---------------------------------------------------------------------------

export type MessageKind =
  | "invite"
  | "update"
  | "cancel"
  | "reply-accepted"
  | "reply-declined"
  | "reply-tentative";

/** `Thu Oct 16, 2026 15:00 – 15:30 (Europe/Moscow)` */
export function formatWhen(
  start: Date,
  end: Date,
  timeZone = "UTC",
  allDay = false,
): string {
  const tz = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  if (allDay) return `${date.format(start)} (all day)`;
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const sameDay = date.format(start) === date.format(end);
  return sameDay
    ? `${date.format(start)} ${time.format(start)} – ${
      time.format(end)
    } (${tz})`
    : `${date.format(start)} ${time.format(start)} – ${date.format(end)} ${
      time.format(end)
    } (${tz})`;
}

const SUBJECT_PREFIX: Record<MessageKind, string> = {
  "invite": "Invitation",
  "update": "Updated invitation",
  "cancel": "Canceled event",
  "reply-accepted": "Accepted",
  "reply-declined": "Declined",
  "reply-tentative": "Tentatively accepted",
};

export function messageSubject(
  kind: MessageKind,
  title: string,
  when: string,
): string {
  return `${SUBJECT_PREFIX[kind]}: ${title} @ ${when}`.slice(0, 250);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface MessageBody {
  text: string;
  html: string;
}

/** Plain text + HTML alternative shown by clients next to (or instead of) the card. */
export function composeBody(input: {
  kind: MessageKind;
  title: string;
  when: string;
  location?: string;
  description?: string;
  organizer: Person;
  attendees?: Person[];
  responder?: Person;
  comment?: string;
}): MessageBody {
  const lines: [string, string][] = [];
  const who = (p: Person) => (p.name ? `${p.name} <${p.email}>` : p.email);
  let lead: string;
  switch (input.kind) {
    case "invite":
      lead = `${who(input.organizer)} invited you to "${input.title}".`;
      break;
    case "update":
      lead = `${who(input.organizer)} updated "${input.title}".`;
      break;
    case "cancel":
      lead = `${who(input.organizer)} canceled "${input.title}".`;
      break;
    default: {
      const verb = input.kind === "reply-accepted"
        ? "accepted"
        : input.kind === "reply-declined"
        ? "declined"
        : "tentatively accepted";
      lead = `${
        who(input.responder ?? input.organizer)
      } ${verb} "${input.title}".`;
    }
  }
  lines.push(["When", input.when]);
  if (input.location) lines.push(["Where", input.location]);
  if (input.attendees && input.attendees.length > 0) {
    lines.push(["Guests", input.attendees.map(who).join(", ")]);
  }
  if (input.comment) lines.push(["Note", input.comment]);

  const text = [
    lead,
    "",
    ...lines.map(([k, v]) => `${k}: ${v}`),
    ...(input.description ? ["", input.description] : []),
    "",
  ].join("\n");

  const rows = lines
    .map(([k, v]) =>
      `<tr><td style="padding:2px 12px 2px 0;color:#666;vertical-align:top">${
        escapeHtml(k)
      }</td><td style="padding:2px 0">${escapeHtml(v)}</td></tr>`
    )
    .join("");
  const desc = input.description
    ? `<p style="white-space:pre-wrap">${escapeHtml(input.description)}</p>`
    : "";
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4">` +
    `<p>${
      escapeHtml(lead)
    }</p><table style="border-collapse:collapse">${rows}</table>${desc}</div>`;
  return { text, html };
}

// ---------------------------------------------------------------------------
// JMAP: the send batch (Blob/upload + Email/set + EmailSubmission/set)
// ---------------------------------------------------------------------------

const CORE = "urn:ietf:params:jmap:core";
const MAIL = "urn:ietf:params:jmap:mail";
const SUBMISSION = "urn:ietf:params:jmap:submission";
const BLOB = "urn:ietf:params:jmap:blob";

/**
 * One request that uploads the calendar object and sends it. The MIME shape
 * follows what Google Calendar itself sends:
 *
 *   multipart/mixed
 *     multipart/alternative
 *       text/plain
 *       text/html
 *       text/calendar; charset=utf-8          <- the inline iMIP part
 *     application/ics; name=invite.ics       <- the same object as a file
 *
 * JMAP cannot set the `method=` Content-Type parameter RFC 6047 asks for;
 * cyrus-adapter adds it on the way out from the object's METHOD line.
 *
 * Every user-controlled value travels through `vars` ($ICS, $SUBJECT, $TEXT,
 * $HTML, $UID, addresses, threading id) so it is substituted once and never
 * re-read as a $VAR token. The sent copy lands in Sent and leaves `$draft` on
 * success, exactly like send_email.
 */
export function buildCalendarSend(input: {
  to: Person[];
  fromName?: string;
  subject: string;
  body: MessageBody;
  ics: string;
  uid: string;
  /** Message-ID of the invitation a reply answers (threads the reply). */
  inReplyTo?: string;
  includeIcsFile?: boolean;
}): { opsJson: string; vars: Record<string, string> } {
  const vars: Record<string, string> = {
    SUBJECT: input.subject,
    TEXT: input.body.text,
    HTML: input.body.html,
    ICS: input.ics,
    UID: input.uid,
  };
  const from: Record<string, string> = { email: "$INBOX" };
  if (input.fromName) {
    from.name = "$FROM_NAME";
    vars.FROM_NAME = input.fromName;
  }
  const to = input.to.map((p, i) => {
    vars[`TO_${i}`] = p.email;
    const addr: Record<string, string> = { email: `$TO_${i}` };
    if (p.name) {
      addr.name = `$TO_NAME_${i}`;
      vars[`TO_NAME_${i}`] = p.name;
    }
    return addr;
  });
  const alternative: Record<string, unknown>[] = [
    { partId: "t", type: "text/plain" },
    { partId: "h", type: "text/html" },
    { blobId: "#ics", type: "text/calendar", charset: "utf-8" },
  ];
  const bodyStructure = input.includeIcsFile === false
    ? { type: "multipart/alternative", subParts: alternative }
    : {
      type: "multipart/mixed",
      subParts: [
        { type: "multipart/alternative", subParts: alternative },
        {
          blobId: "#ics",
          type: "application/ics",
          name: "invite.ics",
          disposition: "attachment",
        },
      ],
    };
  const create: Record<string, unknown> = {
    mailboxIds: { "$SENT_MAILBOX_ID": true },
    from: [from],
    to,
    subject: "$SUBJECT",
    [`header:${CALENDAR_UID_HEADER}:asText`]: "$UID",
    bodyStructure,
    bodyValues: { t: { value: "$TEXT" }, h: { value: "$HTML" } },
    keywords: { $draft: true, $seen: true },
  };
  if (input.inReplyTo) {
    vars.IN_REPLY_TO = input.inReplyTo;
    create["header:In-Reply-To:asMessageIds"] = ["$IN_REPLY_TO"];
    create["header:References:asMessageIds"] = ["$IN_REPLY_TO"];
  }
  const opsJson = JSON.stringify({
    using: [CORE, MAIL, SUBMISSION, BLOB],
    methodCalls: [
      ["Blob/upload", {
        accountId: "$ACCOUNT_ID",
        create: {
          ics: { data: [{ "data:asText": "$ICS" }], type: "text/calendar" },
        },
      }, "b0"],
      ["Email/set", { accountId: "$ACCOUNT_ID", create: { m1: create } }, "c0"],
      ["EmailSubmission/set", {
        accountId: "$ACCOUNT_ID",
        create: { s1: { emailId: "#m1" } },
        onSuccessUpdateEmail: {
          "#s1": { "keywords/$draft": null, "keywords/$sent": true },
        },
      }, "c1"],
    ],
  });
  return { opsJson, vars };
}

// ---------------------------------------------------------------------------
// JMAP: reading invitations back
// ---------------------------------------------------------------------------

export const SCAN_DEFAULT = 50;
export const SCAN_MAX = 200;

const SCAN_PROPS = [
  "id",
  "threadId",
  "messageId",
  "subject",
  "from",
  "to",
  "receivedAt",
  "sentAt",
  `header:${CALENDAR_UID_HEADER}:asText`,
  "bodyStructure",
];
const BODY_PROPS = [
  "partId",
  "blobId",
  "type",
  "name",
  "disposition",
  "subParts",
];

/**
 * Batch 1 of list_invites: the latest invitation messages we sent (header
 * query on Sent) and the latest inbox messages, with their body structure so
 * calendar parts can be picked out. Optionally narrowed to one UID.
 */
export function buildScanOps(limit: number, uid?: string): string {
  const sentFilter: Record<string, unknown> = {
    inMailbox: "$SENT_MAILBOX_ID",
    header: uid ? [CALENDAR_UID_HEADER, "$UID"] : [CALENDAR_UID_HEADER],
  };
  return JSON.stringify({
    using: [CORE, MAIL],
    methodCalls: [
      ["Email/query", {
        accountId: "$ACCOUNT_ID",
        filter: sentFilter,
        sort: [{ property: "sentAt", isAscending: false }],
        limit,
      }, "qs"],
      ["Email/get", {
        accountId: "$ACCOUNT_ID",
        "#ids": { resultOf: "qs", name: "Email/query", path: "/ids" },
        properties: SCAN_PROPS,
        bodyProperties: BODY_PROPS,
      }, "gs"],
      ["Email/query", {
        accountId: "$ACCOUNT_ID",
        filter: { inMailbox: "$INBOX_MAILBOX_ID" },
        sort: [{ property: "receivedAt", isAscending: false }],
        limit,
      }, "qi"],
      ["Email/get", {
        accountId: "$ACCOUNT_ID",
        "#ids": { resultOf: "qi", name: "Email/query", path: "/ids" },
        properties: SCAN_PROPS,
        bodyProperties: BODY_PROPS,
      }, "gi"],
    ],
  });
}

/** Every message we sent for one UID (invitations, updates, cancellations). */
export function buildSentByUidOps(): string {
  return JSON.stringify({
    using: [CORE, MAIL],
    methodCalls: [
      ["Email/query", {
        accountId: "$ACCOUNT_ID",
        filter: {
          inMailbox: "$SENT_MAILBOX_ID",
          header: [CALENDAR_UID_HEADER, "$UID"],
        },
        sort: [{ property: "sentAt", isAscending: false }],
        limit: 25,
      }, "qs"],
      ["Email/get", {
        accountId: "$ACCOUNT_ID",
        "#ids": { resultOf: "qs", name: "Email/query", path: "/ids" },
        properties: SCAN_PROPS,
        bodyProperties: BODY_PROPS,
      }, "gs"],
    ],
  });
}

/** One message (an incoming invitation) with its body structure. */
export function buildGetMessageOps(): string {
  return JSON.stringify({
    using: [CORE, MAIL],
    methodCalls: [
      ["Email/get", {
        accountId: "$ACCOUNT_ID",
        ids: ["$MESSAGE_ID"],
        properties: SCAN_PROPS,
        bodyProperties: BODY_PROPS,
      }, "g0"],
    ],
  });
}

/** Batch 2: the calendar parts' text, 100 blob ids per Blob/get call. */
export function buildBlobGetOps(blobIds: string[]): {
  opsJson: string;
  vars: Record<string, string>;
} {
  const vars: Record<string, string> = {};
  const methodCalls: unknown[] = [];
  for (let start = 0; start < blobIds.length; start += 100) {
    const ids = blobIds.slice(start, start + 100).map((id, j) => {
      const key = `BLOB_${start + j}`;
      vars[key] = id;
      return `$${key}`;
    });
    methodCalls.push(["Blob/get", {
      accountId: "$ACCOUNT_ID",
      ids,
      properties: ["data:asText"],
    }, `bg${start / 100}`]);
  }
  return {
    opsJson: JSON.stringify({ using: [CORE, MAIL, BLOB], methodCalls }),
    vars,
  };
}

export interface ScannedMessage {
  id: string;
  threadId?: string;
  messageId?: string;
  subject?: string;
  from?: Person[];
  receivedAt?: string;
  sentAt?: string;
  uidHeader?: string;
  /** Blob id of the calendar object (inline text/calendar preferred, else .ics file). */
  calendarBlobId?: string;
  box: "sent" | "inbox";
}

interface BodyPart {
  blobId?: string | null;
  type?: string | null;
  name?: string | null;
  subParts?: BodyPart[] | null;
}

/** Pick the calendar object out of a body structure. */
export function findCalendarBlobId(
  part: BodyPart | undefined,
): string | undefined {
  let inline: string | undefined;
  let file: string | undefined;
  const walk = (p: BodyPart | undefined) => {
    if (!p) return;
    const type = (p.type ?? "").toLowerCase();
    if (type === "text/calendar" && p.blobId && !inline) inline = p.blobId;
    else if (
      p.blobId && !file &&
      (type === "application/ics" ||
        (/\.ics$/i.test(p.name ?? "") &&
          (type === "application/octet-stream" || type === "")))
    ) file = p.blobId;
    for (const s of p.subParts ?? []) walk(s);
  };
  walk(part);
  return inline ?? file;
}

type MethodResponse = [string, Record<string, unknown>, string];

function responsesOf(bodyText: string): MethodResponse[] {
  const parsed = JSON.parse(bodyText) as { methodResponses?: MethodResponse[] };
  return parsed.methodResponses ?? [];
}

/** First JMAP method-level error in a response, as short text. */
export function findMethodError(bodyText: string): string | null {
  for (const [name, args] of responsesOf(bodyText)) {
    if (name === "error") {
      const type = String(args.type ?? "error");
      const desc = args.description ? `: ${String(args.description)}` : "";
      return `${type}${desc}`.slice(0, 300);
    }
  }
  return null;
}

function toPeople(v: unknown): Person[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .filter((x): x is { email: string; name?: string | null } =>
      Boolean(x) && typeof (x as { email?: unknown }).email === "string"
    )
    .map((
      x,
    ) => (x.name ? { email: x.email, name: x.name } : { email: x.email }));
}

function toScanned(
  raw: Record<string, unknown>,
  box: "sent" | "inbox",
): ScannedMessage {
  const messageIds = raw.messageId as string[] | null | undefined;
  return {
    id: String(raw.id),
    threadId: raw.threadId ? String(raw.threadId) : undefined,
    messageId: Array.isArray(messageIds) && messageIds[0]
      ? messageIds[0]
      : undefined,
    subject: typeof raw.subject === "string" ? raw.subject : undefined,
    from: toPeople(raw.from),
    receivedAt: typeof raw.receivedAt === "string" ? raw.receivedAt : undefined,
    sentAt: typeof raw.sentAt === "string" ? raw.sentAt : undefined,
    uidHeader: typeof raw[`header:${CALENDAR_UID_HEADER}:asText`] === "string"
      ? (raw[`header:${CALENDAR_UID_HEADER}:asText`] as string).trim()
      : undefined,
    calendarBlobId: findCalendarBlobId(
      raw.bodyStructure as BodyPart | undefined,
    ),
    box,
  };
}

/** Messages from a scan (buildScanOps) or a single get (buildGetMessageOps). */
export function parseScanResponse(bodyText: string): ScannedMessage[] {
  const out: ScannedMessage[] = [];
  for (const [name, args, callId] of responsesOf(bodyText)) {
    if (name !== "Email/get") continue;
    const box = callId === "gs" ? "sent" : "inbox";
    const list = (args.list as Record<string, unknown>[] | undefined) ?? [];
    for (const raw of list) out.push(toScanned(raw, box));
  }
  return out;
}

/** blobId → text from a Blob/get response. */
export function parseBlobGetResponse(bodyText: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const [name, args] of responsesOf(bodyText)) {
    if (name !== "Blob/get") continue;
    for (
      const b of (args.list as Record<string, unknown>[] | undefined) ?? []
    ) {
      if (typeof b.id === "string" && typeof b["data:asText"] === "string") {
        map.set(b.id, b["data:asText"] as string);
      }
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// State: what list_invites reports
// ---------------------------------------------------------------------------

export type ResponseView =
  | "accepted"
  | "declined"
  | "tentative"
  | "no_response"
  | "proposed_new_time";

const PARTSTAT_VIEW: Record<string, ResponseView> = {
  "ACCEPTED": "accepted",
  "DECLINED": "declined",
  "TENTATIVE": "tentative",
  "NEEDS-ACTION": "no_response",
  "DELEGATED": "no_response",
};

export interface AttendeeView {
  email: string;
  name?: string;
  response: ResponseView;
  responded_at?: string;
  comment?: string;
  proposed_start?: string;
  proposed_end?: string;
  /** The answer was given to an earlier version (before a time change). */
  answered_earlier_version?: boolean;
}

export interface OrganizedView {
  invite_id: string;
  title: string;
  start: string | null;
  end: string | null;
  location?: string;
  status: "scheduled" | "cancelled";
  version: number;
  attendees: AttendeeView[];
  last_sent_message_id: string;
}

export interface ReceivedView {
  invite_id: string;
  message_id: string;
  title: string;
  start: string | null;
  end: string | null;
  all_day_date?: string;
  time_zone?: string;
  time_uncertain?: boolean;
  location?: string;
  meeting_url?: string;
  organizer: Person | null;
  /**
   * False when the message did not come from the organizer's own address —
   * a forwarded or possibly spoofed invitation. Treat it with suspicion.
   */
  organizer_matches_sender: boolean;
  status: "scheduled" | "cancelled";
  recurring: boolean;
  your_response: ResponseView;
}

export interface InviteState {
  organized: OrganizedView[];
  received: ReceivedView[];
}

export interface Item {
  msg: ScannedMessage;
  method: string;
  ev: ParsedEvent;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * Who answered: the ATTENDEE that matches the sender, else the first
 * attendee that is not us (Outlook/Google put only the responder in a REPLY).
 */
function responderOf(it: Item, self: string): string | undefined {
  const sender = it.msg.from?.[0]?.email?.toLowerCase();
  const others = it.ev.attendees.filter((a) => a.email !== self);
  return (others.find((a) => a.email === sender) ?? others[0])?.email ??
    sender;
}

function timeOf(it: Item): number {
  const t = it.ev.stamp?.getTime() ??
    Date.parse(it.msg.sentAt ?? it.msg.receivedAt ?? "");
  return Number.isFinite(t) ? t : 0;
}

/**
 * Is `a` a later version than `b`? Higher SEQUENCE wins. At equal SEQUENCE a
 * REQUEST beats a CANCEL: the only same-sequence CANCEL we send goes to
 * attendees removed by that very update. Otherwise the later DTSTAMP wins.
 */
/** A whole-meeting cancellation (a partial one, to removed guests, has no STATUS). */
function isFullCancel(it: Item): boolean {
  return it.ev.status === "CANCELLED" ||
    (it.method === "CANCEL" && it.msg.box === "inbox");
}

function newer(a: Item, b: Item): boolean {
  if (a.ev.sequence !== b.ev.sequence) return a.ev.sequence > b.ev.sequence;
  if (a.method !== b.method) {
    if (a.method === "REQUEST" && b.method === "CANCEL") return true;
    if (a.method === "CANCEL" && b.method === "REQUEST") return false;
  }
  return timeOf(a) > timeOf(b);
}

/**
 * Fold scanned messages + their calendar objects into the agent's view.
 * `me` is the agent's own address (lower-cased compare).
 */
/** Pair each scanned message with its parsed calendar object. */
export function toItems(
  messages: ScannedMessage[],
  calendars: Map<string, string>,
): Item[] {
  const items: Item[] = [];
  for (const msg of messages) {
    if (!msg.calendarBlobId) continue;
    const text = calendars.get(msg.calendarBlobId);
    if (!text) continue;
    const cal = parseCalendar(text);
    if (!cal) continue;
    const ev = primaryEvent(cal);
    if (!ev) continue;
    items.push({ msg, method: cal.method, ev });
  }
  return items;
}

/** Latest REQUEST/CANCEL we sent as organizer, per UID. */
export function latestOursByUid(
  items: Item[],
  self: string,
): Map<string, Item> {
  const ours = new Map<string, Item>();
  for (const it of items) {
    if (it.msg.box !== "sent") continue;
    if (it.method !== "REQUEST" && it.method !== "CANCEL") continue;
    if (it.method === "CANCEL" && !isFullCancel(it)) continue;
    if (it.ev.organizer?.email !== self) continue;
    const prev = ours.get(it.ev.uid);
    if (!prev || newer(it, prev)) ours.set(it.ev.uid, it);
  }
  return ours;
}

export function deriveInviteState(
  messages: ScannedMessage[],
  calendars: Map<string, string>,
  me: string,
): InviteState {
  const self = me.toLowerCase();
  const items = toItems(messages, calendars);
  const ours = latestOursByUid(items, self);

  // --- Answers to them: REPLY / COUNTER that came back to the inbox.
  const answers = new Map<string, Map<string, Item>>();
  for (const it of items) {
    if (it.msg.box !== "inbox") continue;
    if (it.method !== "REPLY" && it.method !== "COUNTER") continue;
    if (!ours.has(it.ev.uid)) continue;
    const from = responderOf(it, self);
    if (!from) continue;
    let per = answers.get(it.ev.uid);
    if (!per) answers.set(it.ev.uid, per = new Map());
    const prev = per.get(from);
    if (!prev || timeOf(it) >= timeOf(prev)) per.set(from, it);
  }

  const organized: OrganizedView[] = [];
  for (const [uid, it] of ours) {
    const per = answers.get(uid);
    const attendees: AttendeeView[] = it.ev.attendees
      .filter((a) => a.email !== self)
      .map((a) => {
        const ans = per?.get(a.email);
        const view: AttendeeView = {
          email: a.email,
          ...(a.name ? { name: a.name } : {}),
          response: "no_response",
        };
        if (!ans) return view;
        if (ans.method === "COUNTER") {
          view.response = "proposed_new_time";
          view.proposed_start = iso(ans.ev.start) ?? undefined;
          view.proposed_end = iso(ans.ev.end) ?? undefined;
        } else {
          const ps = ans.ev.attendees.find((x) => x.email === a.email)
            ?.partstat ?? "NEEDS-ACTION";
          view.response = PARTSTAT_VIEW[ps] ?? "no_response";
        }
        view.responded_at = iso(ans.ev.stamp) ??
          (ans.msg.receivedAt ?? undefined);
        if (ans.ev.comment) view.comment = ans.ev.comment;
        if (ans.ev.sequence < it.ev.sequence) {
          view.answered_earlier_version = true;
        }
        return view;
      });
    organized.push({
      invite_id: uid,
      title: it.ev.title ?? "(no title)",
      start: iso(it.ev.start),
      end: iso(it.ev.end),
      ...(it.ev.location ? { location: it.ev.location } : {}),
      status: isFullCancel(it) ? "cancelled" : "scheduled",
      version: it.ev.sequence,
      attendees,
      last_sent_message_id: it.msg.id,
    });
  }

  // --- Invitations others sent us: latest REQUEST/CANCEL per UID in inbox.
  const theirs = new Map<string, Item>();
  for (const it of items) {
    if (it.msg.box !== "inbox") continue;
    if (it.method !== "REQUEST" && it.method !== "CANCEL") continue;
    if (!it.ev.organizer || it.ev.organizer.email === self) continue;
    const prev = theirs.get(it.ev.uid);
    if (!prev || newer(it, prev)) theirs.set(it.ev.uid, it);
  }
  // Our answers: REPLYs we sent.
  const myReplies = new Map<string, Item>();
  for (const it of items) {
    if (it.msg.box !== "sent" || it.method !== "REPLY") continue;
    const prev = myReplies.get(it.ev.uid);
    if (!prev || newer(it, prev)) myReplies.set(it.ev.uid, it);
  }

  const received: ReceivedView[] = [];
  for (const [uid, it] of theirs) {
    const mine = myReplies.get(uid);
    const listed = it.ev.attendees.find((a) => a.email === self);
    let yours: ResponseView = "no_response";
    if (mine) {
      const ps = mine.ev.attendees.find((a) => a.email === self)?.partstat ??
        mine.ev.attendees[0]?.partstat ?? "";
      yours = PARTSTAT_VIEW[ps] ?? "no_response";
    } else if (listed?.partstat) {
      yours = PARTSTAT_VIEW[listed.partstat] ?? "no_response";
    }
    received.push({
      invite_id: uid,
      message_id: it.msg.id,
      title: it.ev.title ?? "(no title)",
      start: iso(it.ev.start),
      end: iso(it.ev.end),
      ...(it.ev.allDayDate ? { all_day_date: it.ev.allDayDate } : {}),
      ...(it.ev.timeZone ? { time_zone: it.ev.timeZone } : {}),
      ...(it.ev.timeUncertain ? { time_uncertain: true } : {}),
      ...(it.ev.location ? { location: it.ev.location } : {}),
      ...(it.ev.meetingUrl ? { meeting_url: it.ev.meetingUrl } : {}),
      organizer: it.ev.organizer,
      organizer_matches_sender: it.msg.from?.[0]?.email?.toLowerCase() ===
        it.ev.organizer?.email,
      status: isFullCancel(it) ? "cancelled" : "scheduled",
      recurring: it.ev.recurring,
      your_response: yours,
    });
  }

  const byStart = (a: { start: string | null }, b: { start: string | null }) =>
    (a.start ?? "").localeCompare(b.start ?? "");
  organized.sort(byStart);
  received.sort(byStart);
  return { organized, received };
}

/** Rebuild the event we last sent (for update/cancel) from its parsed object. */
export function outgoingFromParsed(ev: ParsedEvent): OutgoingEvent {
  if (!ev.start || !ev.end || !ev.organizer) {
    throw new Error("The stored invitation is incomplete; send a new one.");
  }
  return {
    uid: ev.uid,
    sequence: ev.sequence,
    title: ev.title ?? "",
    description: ev.description,
    location: ev.location,
    start: ev.start,
    end: ev.end,
    organizer: ev.organizer,
    attendees: ev.attendees.map((a) => ({
      email: a.email,
      ...(a.name ? { name: a.name } : {}),
    })),
  };
}
