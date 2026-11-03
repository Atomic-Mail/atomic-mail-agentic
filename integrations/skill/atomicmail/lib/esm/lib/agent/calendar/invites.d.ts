import { isRealDate } from "./ical.js";
export { isRealDate };
export declare const CALENDAR_UID_HEADER = "X-Atomic-Calendar-Uid";
export declare const PRODID = "-//Atomic Mail//Agent Calendar 1.0//EN";
/**
 * Hard cap on attendees per invitation (the egress MTA caps recipients too).
 * Large guest lists are a calendar-spam signal (CalConnect/M3AAWG 2019).
 */
export declare const MAX_ATTENDEES = 25;
/** How far ahead a meeting may start, and how stale a start we still accept. */
export declare const MAX_START_AHEAD_MS: number;
export declare const MAX_START_PAST_MS: number;
export declare const MAX_TITLE_CHARS = 200;
export declare const MAX_DESCRIPTION_CHARS = 8000;
export declare const MAX_LOCATION_CHARS = 500;
export declare const MAX_COMMENT_CHARS = 1000;
export declare const MAX_MEETING_URL_CHARS = 2000;
/** Longest event we accept (31 days). */
export declare const MAX_DURATION_MS: number;
export type Method = "REQUEST" | "CANCEL" | "REPLY" | "COUNTER";
export type PartStat = "NEEDS-ACTION" | "ACCEPTED" | "DECLINED" | "TENTATIVE" | "DELEGATED";
/** The answers a tool caller can give. */
export type Response = "accepted" | "declined" | "tentative";
export declare const RESPONSE_TO_PARTSTAT: Record<Response, PartStat>;
export interface Person {
    email: string;
    name?: string;
}
export interface Attendee extends Person {
    partstat?: PartStat;
    comment?: string;
}
/**
 * The event as we send it. Times are absolute instants; for an all-day event
 * they are UTC midnights of the first day and of the day after the last one
 * (DTEND;VALUE=DATE is exclusive).
 */
export interface OutgoingEvent {
    uid: string;
    sequence: number;
    title: string;
    /** The agenda as the caller gave it (DESCRIPTION carries nothing else). */
    description?: string;
    /** As the caller gave it; LOCATION falls back to `meetingUrl` when unset. */
    location?: string;
    /** Video-call link (https), sent as URL + CONFERENCE (RFC 7986). */
    meetingUrl?: string;
    allDay?: boolean;
    start: Date;
    end: Date;
    /**
     * The zone the organizer gave (IANA name or UTC offset). Times are written
     * in UTC, so it travels as X-ATOMIC-TIMEZONE: an update or cancellation sent
     * later shows "15:00 (Europe/Moscow)" again instead of "12:00 (UTC)".
     */
    displayTimeZone?: string;
    organizer: Person;
    attendees: Attendee[];
}
/**
 * Parse a tool-supplied start/end. ISO 8601 with an offset (`…Z`,
 * `…+03:00`) is absolute. A local time (`2026-10-16T15:00`) needs `timeZone`
 * (IANA, e.g. `Europe/Moscow`); without one we refuse rather than guess —
 * a wrong guess books the meeting at the wrong hour for everyone.
 */
export declare function parseUserDateTime(value: string, timeZone: string | undefined, field: string): Date;
/** Refuse meetings in the past or absurdly far ahead (typo, abuse). */
export declare function checkStart(start: Date, now?: Date): void;
/** Resolve end from `end` or `duration_minutes` (default 30 minutes). */
export declare function resolveEnd(input: {
    start: Date;
    end?: string;
    durationMinutes?: number;
    timeZone?: string;
}): Date;
/** `YYYY-MM-DD` of the UTC calendar date of `d`. */
export declare function isoDate(d: Date): string;
/**
 * An all-day date (`2026-10-16`) as the UTC midnight that starts it. All-day
 * dates are the same in every zone (VALUE=DATE is floating), so no time zone.
 */
export declare function parseUserDate(value: string, field: string): Date;
/**
 * All-day starts: today counts, wherever the caller is (UTC today minus one
 * day covers zones behind UTC), and at most two years ahead.
 */
export declare function checkAllDayStart(start: Date, now?: Date): void;
/**
 * Exclusive end (DTEND;VALUE=DATE) of an all-day event from `lastDay`, the
 * LAST day it covers, inclusive (`2026-10-16` → `20261017`). Default: one day.
 */
export declare function resolveAllDayEnd(start: Date, lastDay?: string): Date;
/**
 * A meeting link as given: one https URL, no spaces, quotes or credentials
 * (`https://google.com@evil.example` is a classic phishing disguise).
 */
export declare function parseMeetingUrl(raw: string): string;
/**
 * The agenda without the "Join: <link>" line that invitations sent before
 * 2026-11-03 carried in front of it (the link now lives only in LOCATION, URL
 * and CONFERENCE, so the calendar shows it once).
 */
export declare function stripJoinLine(description: string | undefined, meetingUrl: string | undefined): string | undefined;
/** `Anna <anna@x.com>`, `"Anna B" <anna@x.com>` or `anna@x.com`. */
export declare function parsePerson(raw: string): Person | null;
export declare function parseAttendees(raw: string[]): Person[];
export declare function checkLength(value: string | undefined, max: number, field: string): void;
/**
 * A random UUID. RFC 7986 §5.3 recommends UIDs carry no host, domain or user
 * (the organizer stays private to the object). `_organizerEmail` is unused and
 * kept for call-site stability.
 */
export declare function newEventUid(_organizerEmail?: string): string;
/** METHOD:REQUEST — a new invitation or an update (bump `sequence`). */
export declare function buildRequestIcs(ev: OutgoingEvent, now?: Date): string;
/**
 * METHOD:CANCEL. For the whole meeting: every attendee and
 * STATUS:CANCELLED. To uninvite some attendees (`partial`): only them and no
 * STATUS, so the meeting itself stays alive (RFC 5546 §3.2.5).
 */
export declare function buildCancelIcs(ev: OutgoingEvent, now?: Date, comment?: string, partial?: boolean): string;
/**
 * METHOD:REPLY — our answer to someone else's invitation. Echoes UID,
 * SEQUENCE, DTSTART/DTEND, SUMMARY and ORGANIZER from the request, plus one
 * ATTENDEE (us) with the chosen PARTSTAT (RFC 5546 §3.2.3).
 */
export declare function buildReplyIcs(invite: ParsedEvent, me: Person, partstat: PartStat, now?: Date, comment?: string): string;
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
    /** True when that link was only spotted inside the LOCATION text. */
    meetingUrlGuessed?: boolean;
    start: Date | null;
    end: Date | null;
    /** `YYYY-MM-DD` for all-day events. */
    allDayDate?: string;
    /** Time zone the organizer used, when known. */
    timeZone?: string;
    /** Our own X-ATOMIC-TIMEZONE: the zone our organizer gave when sending. */
    displayTimeZone?: string;
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
/** Parse an iMIP calendar object. Returns null when it is not iCalendar. */
export declare function parseCalendar(text: string): ParsedCalendar | null;
/** The master VEVENT (no RECURRENCE-ID) or the first one. */
export declare function primaryEvent(cal: ParsedCalendar): ParsedEvent | null;
export type MessageKind = "invite" | "update" | "cancel" | "reply-accepted" | "reply-declined" | "reply-tentative";
/**
 * `Thu, Oct 16, 2026 15:00 – 15:30 (Europe/Moscow)`; all-day (`end`
 * exclusive): `Thu, Oct 16, 2026 (all day)` or
 * `Thu, Oct 16, 2026 – Sat, Oct 18, 2026 (all day)`.
 */
export declare function formatWhen(start: Date, end: Date, timeZone?: string, allDay?: boolean): string;
export declare function messageSubject(kind: MessageKind, title: string, when: string): string;
export interface MessageBody {
    text: string;
    html: string;
}
/** Plain text + HTML alternative shown by clients next to (or instead of) the card. */
export declare function composeBody(input: {
    kind: MessageKind;
    title: string;
    when: string;
    location?: string;
    description?: string;
    /** Shown as a "Join" row (a plain link) next to When / Guests. */
    meetingUrl?: string;
    organizer: Person;
    attendees?: Person[];
    responder?: Person;
    comment?: string;
}): MessageBody;
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
 * the outbound mail path adds it from the object's METHOD line.
 *
 * Every user-controlled value travels through `vars` ($ICS, $SUBJECT, $TEXT,
 * $HTML, $UID, addresses, threading id) so it is substituted once and never
 * re-read as a $VAR token. The sent copy lands in Sent and leaves `$draft` on
 * success, exactly like send_email.
 */
export declare function buildCalendarSend(input: {
    to: Person[];
    fromName?: string;
    subject: string;
    body: MessageBody;
    ics: string;
    uid: string;
    /** Message-ID of the invitation a reply answers (threads the reply). */
    inReplyTo?: string;
    includeIcsFile?: boolean;
}): {
    opsJson: string;
    vars: Record<string, string>;
};
export declare const SCAN_DEFAULT = 50;
export declare const SCAN_MAX = 200;
/**
 * Batch 1 of list_invites: the latest invitation messages we sent (header
 * query on Sent) and the latest inbox messages, with their body structure so
 * calendar parts can be picked out. Optionally narrowed to one UID.
 */
export declare function buildScanOps(limit: number, uid?: string): string;
/** Every message we sent for one UID (invitations, updates, cancellations). */
export declare function buildSentByUidOps(): string;
/** One message (an incoming invitation) with its body structure. */
export declare function buildGetMessageOps(): string;
/** Batch 2: the calendar parts' text, 100 blob ids per Blob/get call. */
export declare function buildBlobGetOps(blobIds: string[]): {
    opsJson: string;
    vars: Record<string, string>;
};
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
export declare function findCalendarBlobId(part: BodyPart | undefined): string | undefined;
/** First JMAP method-level error in a response, as short text. */
export declare function findMethodError(bodyText: string): string | null;
/** Messages from a scan (buildScanOps) or a single get (buildGetMessageOps). */
export declare function parseScanResponse(bodyText: string): ScannedMessage[];
/** blobId → text from a Blob/get response. */
export declare function parseBlobGetResponse(bodyText: string): Map<string, string>;
export type ResponseView = "accepted" | "declined" | "tentative" | "no_response" | "proposed_new_time";
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
/**
 * All-day fields, present only for all-day events: `all_day_date` is the first
 * day and `all_day_last_date` the last one, inclusive (`end` stays exclusive).
 */
export interface AllDayView {
    all_day?: true;
    all_day_date?: string;
    all_day_last_date?: string;
}
export interface OrganizedView extends AllDayView {
    invite_id: string;
    title: string;
    start: string | null;
    end: string | null;
    location?: string;
    meeting_url?: string;
    status: "scheduled" | "cancelled";
    version: number;
    attendees: AttendeeView[];
    last_sent_message_id: string;
}
export interface ReceivedView extends AllDayView {
    invite_id: string;
    message_id: string;
    title: string;
    start: string | null;
    end: string | null;
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
/**
 * Fold scanned messages + their calendar objects into the agent's view.
 * `me` is the agent's own address (lower-cased compare).
 */
/** Pair each scanned message with its parsed calendar object. */
export declare function toItems(messages: ScannedMessage[], calendars: Map<string, string>): Item[];
/** Latest REQUEST/CANCEL we sent as organizer, per UID. */
export declare function latestOursByUid(items: Item[], self: string): Map<string, Item>;
export declare function deriveInviteState(messages: ScannedMessage[], calendars: Map<string, string>, me: string): InviteState;
export declare function outgoingFromParsed(ev: ParsedEvent): OutgoingEvent;
//# sourceMappingURL=invites.d.ts.map