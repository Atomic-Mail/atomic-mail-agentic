// Meeting invitations over email: iTIP objects (REQUEST / CANCEL / REPLY), the
// human-readable message around them, and the state an agent sees in
// list_invites. Pure — the JMAP round trips live in src/tools/calendar-tools.ts.
//
// No calendar is stored server-side. The agent's Sent mailbox is the record:
// every invitation, update, cancellation and reply we send carries the event
// UID in the `X-Atomic-Calendar-Uid` header, so the latest version of an
// invitation is found with one header query, and the attendees' answers are
// the REPLY objects that come back to the inbox.
import { collectTimeZones, emailToMailto, escapeText, formatDate, formatProperty, formatUtc, getProp, getProps, getText, isRealDate, isValidTimeZone, mailtoToEmail, parseDurationMs, parseIcal, parseTimeProp, unescapeText, zonedWallTimeToUtc, } from "./ical.js";
export { isRealDate };
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
export const MAX_MEETING_URL_CHARS = 2_000;
const DAY_MS = 24 * 60 * 60_000;
/** Longest event we accept (31 days). */
export const MAX_DURATION_MS = 31 * DAY_MS;
/** Leads DESCRIPTION when the event has a meeting link (Google does the same). */
const JOIN_PREFIX = "Join: ";
export const RESPONSE_TO_PARTSTAT = {
    accepted: "ACCEPTED",
    declined: "DECLINED",
    tentative: "TENTATIVE",
};
// ---------------------------------------------------------------------------
// Input validation (tool arguments)
// ---------------------------------------------------------------------------
const OFFSET_RE = /(Z|[+-]\d{2}:?\d{2})$/i;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;
/**
 * Parse a tool-supplied start/end. ISO 8601 with an offset (`…Z`,
 * `…+03:00`) is absolute. A local time (`2026-10-16T15:00`) needs `timeZone`
 * (IANA, e.g. `Europe/Moscow`); without one we refuse rather than guess —
 * a wrong guess books the meeting at the wrong hour for everyone.
 */
export function parseUserDateTime(value, timeZone, field) {
    const v = value.trim();
    if (OFFSET_RE.test(v)) {
        const ms = Date.parse(v);
        const ymd = v.match(/^(\d{4})-(\d{2})-(\d{2})T/);
        if (!Number.isFinite(ms) || !ymd) {
            throw new Error(`${field} must be ISO 8601, e.g. 2026-10-16T15:00:00+03:00.`);
        }
        if (!isRealDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]))) {
            throw new Error(`${field} is not a valid date and time.`);
        }
        return new Date(ms);
    }
    const m = v.match(LOCAL_RE);
    if (!m && DATE_RE.test(v)) {
        throw new Error(`${field} has no time. Add one (e.g. ${v}T15:00:00+03:00), or pass ` +
            "all_day: true for an all-day event.");
    }
    if (!m) {
        throw new Error(`${field} must be ISO 8601, e.g. 2026-10-16T15:00:00+03:00, or a local ` +
            "time like 2026-10-16T15:00 together with time_zone.");
    }
    if (!timeZone) {
        throw new Error(`${field} has no UTC offset. Add one (e.g. +03:00) or pass time_zone ` +
            "(an IANA name such as Europe/Moscow). Ask the user which time zone " +
            "they mean rather than guessing.");
    }
    if (!isValidTimeZone(timeZone)) {
        throw new Error(`Unknown time_zone '${timeZone}'. Use an IANA name.`);
    }
    const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
    if (!isRealDate(y, mo, d) || h > 23 || mi > 59 || s > 59) {
        throw new Error(`${field} is not a valid date and time.`);
    }
    return zonedWallTimeToUtc({ y, mo, d, h, mi, s }, timeZone);
}
/** Refuse meetings in the past or absurdly far ahead (typo, abuse). */
export function checkStart(start, now = new Date()) {
    if (start.getTime() < now.getTime() - MAX_START_PAST_MS) {
        throw new Error(`start ${start.toISOString()} is in the past. Check the date and the time zone.`);
    }
    if (start.getTime() > now.getTime() + MAX_START_AHEAD_MS) {
        throw new Error("start is more than two years ahead.");
    }
}
/** Resolve end from `end` or `duration_minutes` (default 30 minutes). */
export function resolveEnd(input) {
    let end;
    if (input.end) {
        end = parseUserDateTime(input.end, input.timeZone, "end");
    }
    else {
        const minutes = input.durationMinutes ?? 30;
        end = new Date(input.start.getTime() + minutes * 60_000);
    }
    const span = end.getTime() - input.start.getTime();
    if (span <= 0)
        throw new Error("end must be after start.");
    if (span > MAX_DURATION_MS) {
        throw new Error("An invitation can span at most 31 days.");
    }
    return end;
}
/** `YYYY-MM-DD` of the UTC calendar date of `d`. */
export function isoDate(d) {
    return d.toISOString().slice(0, 10);
}
/**
 * An all-day date (`2026-10-16`) as the UTC midnight that starts it. All-day
 * dates are the same in every zone (VALUE=DATE is floating), so no time zone.
 */
export function parseUserDate(value, field) {
    const m = value.trim().match(DATE_RE);
    if (!m) {
        throw new Error(`with all_day, ${field} must be a date like 2026-10-16 (no time).`);
    }
    const [y, mo, d] = [m[1], m[2], m[3]].map(Number);
    const date = new Date(Date.UTC(y, mo - 1, d));
    if (isoDate(date) !== m[0]) {
        throw new Error(`${field} is not a valid date.`);
    }
    return date;
}
/**
 * All-day starts: today counts, wherever the caller is (UTC today minus one
 * day covers zones behind UTC), and at most two years ahead.
 */
export function checkAllDayStart(start, now = new Date()) {
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    if (start.getTime() < today - DAY_MS) {
        throw new Error(`start ${isoDate(start)} is in the past. Check the date.`);
    }
    if (start.getTime() > now.getTime() + MAX_START_AHEAD_MS) {
        throw new Error("start is more than two years ahead.");
    }
}
/**
 * Exclusive end (DTEND;VALUE=DATE) of an all-day event from `lastDay`, the
 * LAST day it covers, inclusive (`2026-10-16` → `20261017`). Default: one day.
 */
export function resolveAllDayEnd(start, lastDay) {
    const end = lastDay
        ? new Date(parseUserDate(lastDay, "end").getTime() + DAY_MS)
        : new Date(start.getTime() + DAY_MS);
    const span = end.getTime() - start.getTime();
    if (span <= 0) {
        throw new Error("end (the last day) must not be before start.");
    }
    if (span > MAX_DURATION_MS) {
        throw new Error("An invitation can span at most 31 days.");
    }
    return end;
}
/**
 * A meeting link as given: one https URL, no spaces, quotes or credentials
 * (`https://google.com@evil.example` is a classic phishing disguise).
 */
export function parseMeetingUrl(raw) {
    const v = raw.trim();
    if (v.length > MAX_MEETING_URL_CHARS) {
        throw new Error(`meeting_url is longer than ${MAX_MEETING_URL_CHARS} characters.`);
    }
    const unsafe = /[\s"<>\\`]/.test(v) ||
        [...v].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);
    if (unsafe) {
        throw new Error("meeting_url must be one https:// link without spaces or quotes.");
    }
    let url;
    try {
        url = new URL(v);
    }
    catch {
        throw new Error("meeting_url is not a valid link, e.g. https://meet.google.com/abc-defg-hij.");
    }
    if (url.protocol !== "https:" || !url.hostname) {
        throw new Error("meeting_url must start with https://.");
    }
    if (url.username || url.password) {
        throw new Error("meeting_url must not contain a user name or password.");
    }
    return v;
}
/**
 * The agenda without the "Join: <link>" line that invitations sent before
 * 2026-11-03 carried in front of it (the link now lives only in LOCATION, URL
 * and CONFERENCE, so the calendar shows it once).
 */
export function stripJoinLine(description, meetingUrl) {
    if (!description || !meetingUrl)
        return description;
    const join = `${JOIN_PREFIX}${meetingUrl}`;
    if (description === join)
        return undefined;
    if (!description.startsWith(`${join}\n`))
        return description;
    return description.slice(join.length).replace(/^\n+/, "") || undefined;
}
/** `Anna <anna@x.com>`, `"Anna B" <anna@x.com>` or `anna@x.com`. */
export function parsePerson(raw) {
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
export function parseAttendees(raw) {
    const out = [];
    const seen = new Set();
    for (const r of raw) {
        const p = parsePerson(r);
        if (!p)
            throw new Error(`'${r}' is not an email address.`);
        if (seen.has(p.email))
            continue;
        seen.add(p.email);
        out.push(p);
    }
    if (out.length === 0)
        throw new Error("Invite at least one attendee.");
    if (out.length > MAX_ATTENDEES) {
        throw new Error(`At most ${MAX_ATTENDEES} attendees per invitation.`);
    }
    return out;
}
export function checkLength(value, max, field) {
    if (value !== undefined && value.length > max) {
        throw new Error(`${field} is longer than ${max} characters.`);
    }
}
/**
 * A random UUID. RFC 7986 §5.3 recommends UIDs carry no host, domain or user
 * (the organizer stays private to the object). `_organizerEmail` is unused and
 * kept for call-site stability.
 */
export function newEventUid(_organizerEmail) {
    return crypto.randomUUID();
}
// ---------------------------------------------------------------------------
// Building iTIP objects
// ---------------------------------------------------------------------------
function vcalendarHead(method) {
    return [
        "BEGIN:VCALENDAR\r\n",
        formatProperty("PRODID", {}, PRODID),
        "VERSION:2.0\r\n",
        "CALSCALE:GREGORIAN\r\n",
        `METHOD:${method}\r\n`,
    ].join("");
}
function organizerLine(p) {
    return formatProperty("ORGANIZER", { CN: p.name }, emailToMailto(p.email));
}
function attendeeLine(a, rsvp) {
    return formatProperty("ATTENDEE", {
        CUTYPE: "INDIVIDUAL",
        ROLE: "REQ-PARTICIPANT",
        PARTSTAT: a.partstat ?? "NEEDS-ACTION",
        RSVP: rsvp ? "TRUE" : undefined,
        CN: a.name,
    }, emailToMailto(a.email));
}
function eventCore(ev, now) {
    let s = "";
    s += formatProperty("UID", {}, ev.uid);
    s += `DTSTAMP:${formatUtc(now)}\r\n`;
    s += `SEQUENCE:${ev.sequence}\r\n`;
    if (ev.allDay) {
        s += `DTSTART;VALUE=DATE:${formatDate(ev.start)}\r\n`;
        s += `DTEND;VALUE=DATE:${formatDate(ev.end)}\r\n`;
    }
    else {
        s += `DTSTART:${formatUtc(ev.start)}\r\n`;
        s += `DTEND:${formatUtc(ev.end)}\r\n`;
    }
    s += formatProperty("SUMMARY", {}, escapeText(ev.title));
    const description = ev.description;
    if (description) {
        s += formatProperty("DESCRIPTION", {}, escapeText(description));
    }
    const location = ev.location || ev.meetingUrl;
    if (location)
        s += formatProperty("LOCATION", {}, escapeText(location));
    if (ev.meetingUrl) {
        // URI values are not TEXT: no escaping, only folding (parseMeetingUrl
        // already refused spaces and control characters).
        s += formatProperty("URL", {}, ev.meetingUrl);
        s += formatProperty("CONFERENCE", { VALUE: "URI", FEATURE: "VIDEO", LABEL: "Join" }, ev.meetingUrl);
    }
    if (ev.displayTimeZone && !ev.allDay) {
        s += formatProperty("X-ATOMIC-TIMEZONE", {}, escapeText(ev.displayTimeZone));
    }
    s += organizerLine(ev.organizer);
    return s;
}
/** METHOD:REQUEST — a new invitation or an update (bump `sequence`). */
export function buildRequestIcs(ev, now = new Date()) {
    let s = vcalendarHead("REQUEST");
    s += "BEGIN:VEVENT\r\n";
    s += eventCore(ev, now);
    for (const a of ev.attendees)
        s += attendeeLine(a, true);
    s += "STATUS:CONFIRMED\r\n";
    // All-day events do not block the day as busy (Google does the same).
    s += ev.allDay ? "TRANSP:TRANSPARENT\r\n" : "TRANSP:OPAQUE\r\n";
    s += "END:VEVENT\r\nEND:VCALENDAR\r\n";
    return s;
}
/**
 * METHOD:CANCEL. For the whole meeting: every attendee and
 * STATUS:CANCELLED. To uninvite some attendees (`partial`): only them and no
 * STATUS, so the meeting itself stays alive (RFC 5546 §3.2.5).
 */
export function buildCancelIcs(ev, now = new Date(), comment, partial = false) {
    let s = vcalendarHead("CANCEL");
    s += "BEGIN:VEVENT\r\n";
    s += eventCore(ev, now);
    for (const a of ev.attendees)
        s += attendeeLine(a, false);
    if (comment)
        s += formatProperty("COMMENT", {}, escapeText(comment));
    if (!partial)
        s += "STATUS:CANCELLED\r\n";
    s += "END:VEVENT\r\nEND:VCALENDAR\r\n";
    return s;
}
/**
 * METHOD:REPLY — our answer to someone else's invitation. Echoes UID,
 * SEQUENCE, DTSTART/DTEND, SUMMARY and ORGANIZER from the request, plus one
 * ATTENDEE (us) with the chosen PARTSTAT (RFC 5546 §3.2.3).
 */
export function buildReplyIcs(invite, me, partstat, now = new Date(), comment) {
    if (!invite.organizer) {
        throw new Error("The invitation has no organizer to answer.");
    }
    let s = vcalendarHead("REPLY");
    s += "BEGIN:VEVENT\r\n";
    s += formatProperty("UID", {}, invite.uid);
    s += `DTSTAMP:${formatUtc(now)}\r\n`;
    s += `SEQUENCE:${invite.sequence}\r\n`;
    if (invite.recurrenceIdRaw)
        s += invite.recurrenceIdRaw;
    if (invite.allDayDate && invite.start) {
        s += `DTSTART;VALUE=DATE:${invite.allDayDate.replace(/-/g, "")}\r\n`;
    }
    else if (invite.start) {
        s += `DTSTART:${formatUtc(invite.start)}\r\n`;
        if (invite.end)
            s += `DTEND:${formatUtc(invite.end)}\r\n`;
    }
    if (invite.title) {
        s += formatProperty("SUMMARY", {}, escapeText(invite.title));
    }
    s += organizerLine(invite.organizer);
    s += formatProperty("ATTENDEE", { PARTSTAT: partstat, CN: me.name }, emailToMailto(me.email));
    if (comment)
        s += formatProperty("COMMENT", {}, escapeText(comment));
    s += "END:VEVENT\r\nEND:VCALENDAR\r\n";
    return s;
}
function personFromProp(value, params) {
    const email = mailtoToEmail(value);
    if (!email)
        return null;
    const name = params.CN ? unescapeCn(params.CN) : undefined;
    return name ? { email, name } : { email };
}
function unescapeCn(v) {
    return v.replace(/^"|"$/g, "").trim();
}
function findMeetingUrl(ev) {
    for (const name of [
        "X-GOOGLE-CONFERENCE",
        "X-MICROSOFT-SKYPETEAMSMEETINGURL",
        "X-MICROSOFT-ONLINEMEETINGEXTERNALLINK",
        "URL",
    ]) {
        const v = getProp(ev, name)?.value.trim();
        if (v && /^https:\/\//i.test(v))
            return { url: v };
    }
    for (const c of getProps(ev, "CONFERENCE")) {
        if (/^https:\/\//i.test(c.value.trim()))
            return { url: c.value.trim() };
    }
    const loc = getText(ev, "LOCATION");
    const m = loc?.match(/https:\/\/\S+/);
    return m ? { url: m[0], guessed: true } : undefined;
}
/** Parse an iMIP calendar object. Returns null when it is not iCalendar. */
export function parseCalendar(text) {
    const cal = parseIcal(text);
    if (!cal)
        return null;
    const method = (getProp(cal, "METHOD")?.value ?? "PUBLISH").trim()
        .toUpperCase();
    const tzs = collectTimeZones(cal);
    const events = [];
    for (const ev of cal.components) {
        if (ev.name !== "VEVENT")
            continue;
        const uid = getProp(ev, "UID")?.value.trim();
        if (!uid)
            continue;
        const startProp = getProp(ev, "DTSTART");
        const start = startProp ? parseTimeProp(startProp, tzs) : null;
        let end = null;
        let endUncertain = false;
        const endProp = getProp(ev, "DTEND");
        if (endProp) {
            const e = parseTimeProp(endProp, tzs);
            end = e.instant;
            endUncertain = Boolean(e.assumedUtc);
        }
        else if (start?.instant) {
            const dur = getProp(ev, "DURATION");
            const ms = dur ? parseDurationMs(dur.value) : null;
            const t = ms === null ? NaN : start.instant.getTime() + ms;
            // Bounded on its own, a DURATION can still push start + ms past the
            // Date range (8.64e15 ms): then there is no end, not an Invalid Date.
            if (Math.abs(t) <= 8.64e15)
                end = new Date(t);
            else if (ms !== null)
                end = null;
            else if (start.date) {
                end = new Date(start.instant.getTime() + 24 * 60 * 60_000);
            }
            else
                end = start.instant;
        }
        const stampProp = getProp(ev, "DTSTAMP");
        const stamp = stampProp ? parseTimeProp(stampProp, tzs).instant : null;
        const orgProp = getProp(ev, "ORGANIZER");
        const recurrenceId = getProp(ev, "RECURRENCE-ID");
        const attendees = [];
        for (const a of getProps(ev, "ATTENDEE")) {
            const p = personFromProp(a.value, a.params);
            if (!p)
                continue;
            const partstat = (a.params.PARTSTAT ?? "NEEDS-ACTION").toUpperCase();
            const note = a.params["X-RESPONSE-COMMENT"];
            attendees.push({
                ...p,
                partstat: partstat,
                ...(note ? { comment: unescapeText(note) } : {}),
            });
        }
        const seqRaw = Number(getProp(ev, "SEQUENCE")?.value ?? "0");
        const link = findMeetingUrl(ev);
        events.push({
            uid,
            sequence: Number.isFinite(seqRaw) && seqRaw >= 0 ? Math.floor(seqRaw) : 0,
            stamp,
            title: getText(ev, "SUMMARY"),
            description: getText(ev, "DESCRIPTION"),
            location: getText(ev, "LOCATION"),
            meetingUrl: link?.url,
            ...(link?.guessed ? { meetingUrlGuessed: true } : {}),
            start: start?.instant ?? null,
            end,
            allDayDate: start?.date,
            timeZone: start?.timeZone,
            ...(displayTimeZoneOf(ev)
                ? { displayTimeZone: displayTimeZoneOf(ev) }
                : {}),
            timeUncertain: Boolean(start?.assumedUtc) || endUncertain || undefined,
            organizer: orgProp ? personFromProp(orgProp.value, orgProp.params) : null,
            attendees,
            status: getProp(ev, "STATUS")?.value.trim().toUpperCase(),
            // Outlook puts a note in COMMENT; Google in the attendee's
            // X-RESPONSE-COMMENT parameter.
            comment: getText(ev, "COMMENT") ??
                attendees.find((a) => a.comment)?.comment,
            recurring: Boolean(getProp(ev, "RRULE") || getProp(ev, "RDATE") || recurrenceId),
            recurrenceIdRaw: recurrenceId
                ? formatProperty("RECURRENCE-ID", recurrenceId.params, recurrenceId.value)
                : undefined,
        });
    }
    return { method, events };
}
/** The master VEVENT (no RECURRENCE-ID) or the first one. */
export function primaryEvent(cal) {
    return cal.events.find((e) => !e.recurrenceIdRaw) ?? cal.events[0] ?? null;
}
/**
 * `Thu, Oct 16, 2026 15:00 – 15:30 (Europe/Moscow)`; all-day (`end`
 * exclusive): `Thu, Oct 16, 2026 (all day)` or
 * `Thu, Oct 16, 2026 – Sat, Oct 18, 2026 (all day)`.
 */
export function formatWhen(start, end, timeZone = "UTC", allDay = false) {
    // All-day dates are UTC midnights: read them in UTC, whatever the zone.
    const tz = allDay ? "UTC" : isValidTimeZone(timeZone) ? timeZone : "UTC";
    const date = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
    });
    if (allDay) {
        const last = new Date(Math.max(start.getTime(), end.getTime() - DAY_MS));
        return isoDate(last) === isoDate(start)
            ? `${date.format(start)} (all day)`
            : `${date.format(start)} – ${date.format(last)} (all day)`;
    }
    const time = new Intl.DateTimeFormat("en-GB", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    });
    const sameDay = date.format(start) === date.format(end);
    return sameDay
        ? `${date.format(start)} ${time.format(start)} – ${time.format(end)} (${tz})`
        : `${date.format(start)} ${time.format(start)} – ${date.format(end)} ${time.format(end)} (${tz})`;
}
const SUBJECT_PREFIX = {
    "invite": "Invitation",
    "update": "Updated invitation",
    "cancel": "Canceled event",
    "reply-accepted": "Accepted",
    "reply-declined": "Declined",
    "reply-tentative": "Tentatively accepted",
};
export function messageSubject(kind, title, when) {
    // The title may come from someone else's invitation: no control characters
    // (CR/LF especially) in a header we send.
    const clean = (x) => x.replace(/[\u0000-\u001f\u007f]+/g, " ");
    return `${SUBJECT_PREFIX[kind]}: ${clean(title)} @ ${clean(when)}`.slice(0, 250);
}
function escapeHtml(s) {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
/** Plain text + HTML alternative shown by clients next to (or instead of) the card. */
export function composeBody(input) {
    const lines = [];
    const who = (p) => (p.name ? `${p.name} <${p.email}>` : p.email);
    let lead;
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
            lead = `${who(input.responder ?? input.organizer)} ${verb} "${input.title}".`;
        }
    }
    const url = input.meetingUrl;
    lines.push(["When", input.when]);
    if (url)
        lines.push(["Join", url]);
    if (input.location && input.location !== url) {
        lines.push(["Where", input.location]);
    }
    if (input.attendees && input.attendees.length > 0) {
        lines.push(["Guests", input.attendees.map(who).join(", ")]);
    }
    if (input.comment)
        lines.push(["Note", input.comment]);
    const text = [
        lead,
        "",
        ...lines.map(([k, v]) => `${k}: ${v}`),
        ...(input.description ? ["", input.description] : []),
        "",
    ].join("\n");
    // The meeting link is one row next to When / Guests, shown as its own
    // address so a reader sees where it goes (no button that looks like a
    // Google Meet one).
    const rows = lines
        .map(([k, v]) => {
        const value = k === "Join" && v === url
            ? `<a href="${escapeHtml(v)}" style="word-break:break-all">${escapeHtml(v)}</a>`
            : escapeHtml(v);
        return `<tr><td style="padding:2px 12px 2px 0;color:#666;vertical-align:top">${escapeHtml(k)}</td><td style="padding:2px 0">${value}</td></tr>`;
    })
        .join("");
    const desc = input.description
        ? `<p style="white-space:pre-wrap">${escapeHtml(input.description)}</p>`
        : "";
    // No font of our own: like a regular email, the body takes the reader's
    // default font and size, so it matches the "Sent from …" signature that
    // the platform appends after it.
    const html = `<div>` +
        `<p>${escapeHtml(lead)}</p><table style="border-collapse:collapse">${rows}</table>${desc}</div>`;
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
 * the outbound mail path adds it from the object's METHOD line.
 *
 * Every user-controlled value travels through `vars` ($ICS, $SUBJECT, $TEXT,
 * $HTML, $UID, addresses, threading id) so it is substituted once and never
 * re-read as a $VAR token. The sent copy lands in Sent and leaves `$draft` on
 * success, exactly like send_email.
 */
export function buildCalendarSend(input) {
    const vars = {
        SUBJECT: input.subject,
        TEXT: input.body.text,
        HTML: input.body.html,
        ICS: input.ics,
        UID: input.uid,
    };
    const from = { email: "$INBOX" };
    if (input.fromName) {
        from.name = "$FROM_NAME";
        vars.FROM_NAME = input.fromName;
    }
    const to = input.to.map((p, i) => {
        vars[`TO_${i}`] = p.email;
        const addr = { email: `$TO_${i}` };
        if (p.name) {
            addr.name = `$TO_NAME_${i}`;
            vars[`TO_NAME_${i}`] = p.name;
        }
        return addr;
    });
    const alternative = [
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
    const create = {
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
export function buildScanOps(limit, uid) {
    // A send that was refused keeps its `$draft` copy in Sent (only a
    // successful submission clears it): never read that as a sent version.
    const sentFilter = {
        inMailbox: "$SENT_MAILBOX_ID",
        notKeyword: "$draft",
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
export function buildSentByUidOps() {
    return JSON.stringify({
        using: [CORE, MAIL],
        methodCalls: [
            ["Email/query", {
                    accountId: "$ACCOUNT_ID",
                    filter: {
                        inMailbox: "$SENT_MAILBOX_ID",
                        notKeyword: "$draft", // a refused send is not a version
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
export function buildGetMessageOps() {
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
export function buildBlobGetOps(blobIds) {
    const vars = {};
    const methodCalls = [];
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
/** Pick the calendar object out of a body structure. */
export function findCalendarBlobId(part) {
    let inline;
    let file;
    const walk = (p) => {
        if (!p)
            return;
        const type = (p.type ?? "").toLowerCase();
        if (type === "text/calendar" && p.blobId && !inline)
            inline = p.blobId;
        else if (p.blobId && !file &&
            (type === "application/ics" ||
                (/\.ics$/i.test(p.name ?? "") &&
                    (type === "application/octet-stream" || type === ""))))
            file = p.blobId;
        for (const s of p.subParts ?? [])
            walk(s);
    };
    walk(part);
    return inline ?? file;
}
function responsesOf(bodyText) {
    const parsed = JSON.parse(bodyText);
    return parsed.methodResponses ?? [];
}
/** First JMAP method-level error in a response, as short text. */
export function findMethodError(bodyText) {
    for (const [name, args] of responsesOf(bodyText)) {
        if (name === "error") {
            const type = String(args.type ?? "error");
            const desc = args.description ? `: ${String(args.description)}` : "";
            return `${type}${desc}`.slice(0, 300);
        }
    }
    return null;
}
function toPeople(v) {
    if (!Array.isArray(v))
        return undefined;
    return v
        .filter((x) => Boolean(x) && typeof x.email === "string")
        .map((x) => (x.name ? { email: x.email, name: x.name } : { email: x.email }));
}
function toScanned(raw, box) {
    const messageIds = raw.messageId;
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
            ? raw[`header:${CALENDAR_UID_HEADER}:asText`].trim()
            : undefined,
        calendarBlobId: findCalendarBlobId(raw.bodyStructure),
        box,
    };
}
/** Messages from a scan (buildScanOps) or a single get (buildGetMessageOps). */
export function parseScanResponse(bodyText) {
    const out = [];
    for (const [name, args, callId] of responsesOf(bodyText)) {
        if (name !== "Email/get")
            continue;
        const box = callId === "gs" ? "sent" : "inbox";
        const list = args.list ?? [];
        for (const raw of list)
            out.push(toScanned(raw, box));
    }
    return out;
}
/** blobId → text from a Blob/get response. */
export function parseBlobGetResponse(bodyText) {
    const map = new Map();
    for (const [name, args] of responsesOf(bodyText)) {
        if (name !== "Blob/get")
            continue;
        for (const b of args.list ?? []) {
            if (typeof b.id === "string" && typeof b["data:asText"] === "string") {
                map.set(b.id, b["data:asText"]);
            }
        }
    }
    return map;
}
const PARTSTAT_VIEW = {
    "ACCEPTED": "accepted",
    "DECLINED": "declined",
    "TENTATIVE": "tentative",
    "NEEDS-ACTION": "no_response",
    "DELEGATED": "no_response",
};
function allDayView(ev) {
    if (!ev.allDayDate)
        return {};
    const last = ev.end && ev.start && ev.end.getTime() - DAY_MS > ev.start.getTime()
        ? isoDate(new Date(ev.end.getTime() - DAY_MS))
        : ev.allDayDate;
    return {
        all_day: true,
        all_day_date: ev.allDayDate,
        all_day_last_date: last,
    };
}
const iso = (d) => d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
/**
 * Who answered: the ATTENDEE that matches the sender. Outlook/Google put only
 * the responder in a REPLY, and an Exchange alias may answer from another
 * address of the same domain, so a single ATTENDEE on the sender's domain
 * counts too. Anything else is ignored: a REPLY from a stranger must not mark
 * one of our guests as accepted.
 */
function responderOf(it, self) {
    const sender = it.msg.from?.[0]?.email?.toLowerCase();
    if (!sender)
        return undefined;
    const others = it.ev.attendees.filter((a) => a.email !== self);
    const exact = others.find((a) => a.email === sender);
    if (exact)
        return exact.email;
    const domain = sender.slice(sender.lastIndexOf("@") + 1);
    if (others.length === 1 &&
        others[0].email.slice(others[0].email.lastIndexOf("@") + 1) === domain) {
        return others[0].email;
    }
    return undefined;
}
function timeOf(it) {
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
function isFullCancel(it) {
    return it.ev.status === "CANCELLED" ||
        (it.method === "CANCEL" && it.msg.box === "inbox");
}
function newer(a, b) {
    if (a.ev.sequence !== b.ev.sequence)
        return a.ev.sequence > b.ev.sequence;
    // An organizer that cancels without bumping SEQUENCE still cancelled: a
    // whole-meeting cancellation wins over a REQUEST of the same version.
    if (isFullCancel(a) !== isFullCancel(b))
        return isFullCancel(a);
    if (a.method !== b.method) {
        if (a.method === "REQUEST" && b.method === "CANCEL")
            return true;
        if (a.method === "CANCEL" && b.method === "REQUEST")
            return false;
    }
    return timeOf(a) > timeOf(b);
}
/**
 * Fold scanned messages + their calendar objects into the agent's view.
 * `me` is the agent's own address (lower-cased compare).
 */
/** Pair each scanned message with its parsed calendar object. */
export function toItems(messages, calendars) {
    const items = [];
    for (const msg of messages) {
        if (!msg.calendarBlobId)
            continue;
        const text = calendars.get(msg.calendarBlobId);
        if (!text)
            continue;
        const cal = parseCalendar(text);
        if (!cal)
            continue;
        const ev = primaryEvent(cal);
        if (!ev)
            continue;
        items.push({ msg, method: cal.method, ev });
    }
    return items;
}
/** Latest REQUEST/CANCEL we sent as organizer, per UID. */
export function latestOursByUid(items, self) {
    const ours = new Map();
    for (const it of items) {
        if (it.msg.box !== "sent")
            continue;
        if (it.method !== "REQUEST" && it.method !== "CANCEL")
            continue;
        if (it.method === "CANCEL" && !isFullCancel(it))
            continue;
        if (it.ev.organizer?.email !== self)
            continue;
        const prev = ours.get(it.ev.uid);
        if (!prev || newer(it, prev))
            ours.set(it.ev.uid, it);
    }
    return ours;
}
export function deriveInviteState(messages, calendars, me) {
    const self = me.toLowerCase();
    const items = toItems(messages, calendars);
    const ours = latestOursByUid(items, self);
    // --- Answers to them: REPLY / COUNTER that came back to the inbox.
    const answers = new Map();
    for (const it of items) {
        if (it.msg.box !== "inbox")
            continue;
        if (it.method !== "REPLY" && it.method !== "COUNTER")
            continue;
        if (!ours.has(it.ev.uid))
            continue;
        const from = responderOf(it, self);
        if (!from)
            continue;
        let per = answers.get(it.ev.uid);
        if (!per)
            answers.set(it.ev.uid, per = new Map());
        const prev = per.get(from);
        if (!prev || timeOf(it) >= timeOf(prev))
            per.set(from, it);
    }
    const organized = [];
    for (const [uid, it] of ours) {
        const per = answers.get(uid);
        const attendees = it.ev.attendees
            .filter((a) => a.email !== self)
            .map((a) => {
            const ans = per?.get(a.email);
            const view = {
                email: a.email,
                ...(a.name ? { name: a.name } : {}),
                response: "no_response",
            };
            if (!ans)
                return view;
            if (ans.method === "COUNTER") {
                view.response = "proposed_new_time";
                view.proposed_start = iso(ans.ev.start) ?? undefined;
                view.proposed_end = iso(ans.ev.end) ?? undefined;
            }
            else {
                const ps = ans.ev.attendees.find((x) => x.email === a.email)
                    ?.partstat ?? "NEEDS-ACTION";
                view.response = PARTSTAT_VIEW[ps] ?? "no_response";
            }
            view.responded_at = iso(ans.ev.stamp) ??
                (ans.msg.receivedAt ?? undefined);
            if (ans.ev.comment)
                view.comment = ans.ev.comment;
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
            ...allDayView(it.ev),
            ...(it.ev.location ? { location: it.ev.location } : {}),
            ...(it.ev.meetingUrl ? { meeting_url: it.ev.meetingUrl } : {}),
            status: isFullCancel(it) ? "cancelled" : "scheduled",
            version: it.ev.sequence,
            attendees,
            last_sent_message_id: it.msg.id,
        });
    }
    // --- Invitations others sent us: latest REQUEST/CANCEL per UID in inbox.
    // Anyone who knows a UID (another guest) can mail an update for it, so the
    // first message for a UID pins its organizer, and one sent from the
    // organizer's own address is never replaced by one that is not.
    const fromOrganizer = (it) => it.msg.from?.[0]?.email?.toLowerCase() === it.ev.organizer?.email;
    const inboxItems = items
        .filter((it) => it.msg.box === "inbox")
        .sort((a, b) => (a.msg.receivedAt ?? "").localeCompare(b.msg.receivedAt ?? ""));
    const theirs = new Map();
    for (const it of inboxItems) {
        if (it.method !== "REQUEST" && it.method !== "CANCEL")
            continue;
        if (!it.ev.organizer || it.ev.organizer.email === self)
            continue;
        const prev = theirs.get(it.ev.uid);
        if (!prev) {
            theirs.set(it.ev.uid, it);
            continue;
        }
        if (it.ev.organizer.email !== prev.ev.organizer?.email)
            continue;
        if (fromOrganizer(it) !== fromOrganizer(prev)) {
            if (fromOrganizer(it))
                theirs.set(it.ev.uid, it);
            continue;
        }
        if (newer(it, prev))
            theirs.set(it.ev.uid, it);
    }
    // Our answers: REPLYs we sent.
    const myReplies = new Map();
    for (const it of items) {
        if (it.msg.box !== "sent" || it.method !== "REPLY")
            continue;
        const prev = myReplies.get(it.ev.uid);
        if (!prev || newer(it, prev))
            myReplies.set(it.ev.uid, it);
    }
    const received = [];
    for (const [uid, it] of theirs) {
        const mine = myReplies.get(uid);
        const listed = it.ev.attendees.find((a) => a.email === self);
        let yours = "no_response";
        if (mine) {
            const ps = mine.ev.attendees.find((a) => a.email === self)?.partstat ??
                mine.ev.attendees[0]?.partstat ?? "";
            yours = PARTSTAT_VIEW[ps] ?? "no_response";
        }
        else if (listed?.partstat) {
            yours = PARTSTAT_VIEW[listed.partstat] ?? "no_response";
        }
        received.push({
            invite_id: uid,
            message_id: it.msg.id,
            title: it.ev.title ?? "(no title)",
            start: iso(it.ev.start),
            end: iso(it.ev.end),
            ...allDayView(it.ev),
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
    const byStart = (a, b) => (a.start ?? "").localeCompare(b.start ?? "");
    organized.sort(byStart);
    received.sort(byStart);
    return { organized, received };
}
/** Rebuild the event we last sent (for update/cancel) from its parsed object. */
/** X-ATOMIC-TIMEZONE when it names a zone this runtime knows. */
function displayTimeZoneOf(ev) {
    const tz = getText(ev, "X-ATOMIC-TIMEZONE")?.trim();
    return tz && isValidTimeZone(tz) ? tz : undefined;
}
export function outgoingFromParsed(ev) {
    if (!ev.start || !ev.end || !ev.organizer) {
        throw new Error("The stored invitation is incomplete; send a new one.");
    }
    // Undo what eventCore adds for a link: the "Join:" line in DESCRIPTION and
    // LOCATION filled with the link. A link only seen in LOCATION text is the
    // caller's location, not a meeting_url.
    const meetingUrl = ev.meetingUrlGuessed ? undefined : ev.meetingUrl;
    return {
        uid: ev.uid,
        sequence: ev.sequence,
        title: ev.title ?? "",
        description: stripJoinLine(ev.description, meetingUrl),
        location: meetingUrl && ev.location === meetingUrl
            ? undefined
            : ev.location,
        ...(meetingUrl ? { meetingUrl } : {}),
        ...(ev.allDayDate ? { allDay: true } : {}),
        start: ev.start,
        end: ev.end,
        ...(ev.displayTimeZone ? { displayTimeZone: ev.displayTimeZone } : {}),
        organizer: ev.organizer,
        attendees: ev.attendees.map((a) => ({
            email: a.email,
            ...(a.name ? { name: a.name } : {}),
        })),
    };
}
