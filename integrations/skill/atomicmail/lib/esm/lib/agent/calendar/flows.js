// The five calendar operations as JMAP round trips, independent of how the
// caller talks to JMAP. The hosted MCP server runs them through its own session;
// the client CLI and stdio MCP through AgentSession. This file, ical.ts and
// invites.ts are carried byte-for-byte by both repos — change them together.
//
//   send    1 request : Blob/upload + Email/set + EmailSubmission/set
//   update  3–4       : find our versions by UID → their calendar parts →
//                       (CANCEL to removed guests) → REQUEST with SEQUENCE+1
//   cancel  3         : find → parts → CANCEL with SEQUENCE+1
//   list    2         : scan Sent (by UID header) + Inbox → calendar parts
//   respond 3         : the invitation → its calendar part → REPLY
import { isValidTimeZone } from "./ical.js";
import { buildBlobGetOps, buildCalendarSend, buildCancelIcs, buildGetMessageOps, buildReplyIcs, buildRequestIcs, buildScanOps, buildSentByUidOps, checkAllDayStart, checkLength, checkStart, composeBody, deriveInviteState, findMethodError, formatWhen, latestOursByUid, MAX_COMMENT_CHARS, MAX_DESCRIPTION_CHARS, MAX_LOCATION_CHARS, MAX_TITLE_CHARS, messageSubject, newEventUid, outgoingFromParsed, parseAttendees, parseBlobGetResponse, parseCalendar, parseMeetingUrl, parseScanResponse, parseUserDate, parseUserDateTime, primaryEvent, resolveAllDayEnd, resolveEnd, RESPONSE_TO_PARTSTAT, SCAN_DEFAULT, SCAN_MAX, toItems, } from "./invites.js";
/** A refusal or failure to show the caller as is. */
export class CalendarError extends Error {
}
/** Split "a@x, b@y" / arrays into trimmed entries. */
export function asList(v) {
    if (v == null)
        return [];
    return (Array.isArray(v) ? v : [v])
        .flatMap((s) => s.split(/[,;\n]/))
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}
/** Zone for the human-readable date: the caller's, else the offset given, else UTC. */
export function displayZone(timeZone, raw) {
    if (timeZone && isValidTimeZone(timeZone))
        return timeZone;
    const m = raw?.trim().match(/([+-]\d{2}):?(\d{2})$/);
    if (m) {
        const offset = `${m[1]}:${m[2]}`;
        if (isValidTimeZone(offset))
            return offset;
    }
    return "UTC";
}
function firstSetFailure(bodyText) {
    let parsed;
    try {
        parsed = JSON.parse(bodyText);
    }
    catch {
        return null;
    }
    for (const [name, args] of parsed.methodResponses ?? []) {
        if (name === "error")
            return `JMAP error: ${JSON.stringify(args)}`;
        const notCreated = args?.notCreated;
        if (notCreated && Object.keys(notCreated).length > 0) {
            return `${name} rejected: ${JSON.stringify(notCreated)}`;
        }
    }
    return null;
}
/** Send one calendar message; returns the created Email id. */
async function sendCalendarMessage(runner, input) {
    const { opsJson, vars } = buildCalendarSend(input);
    const result = await runner.run(opsJson, vars, input.label);
    if (!result.ok) {
        throw new CalendarError(`${input.label} failed (HTTP ${result.status}): ${result.bodyText.slice(0, 300)}`);
    }
    const failure = firstSetFailure(result.bodyText);
    if (failure) {
        throw new CalendarError(`${input.label} failed: ${failure.slice(0, 400)}`);
    }
    try {
        const parsed = JSON.parse(result.bodyText);
        const set = parsed.methodResponses?.find((r) => r[0] === "Email/set");
        const created = set?.[1].created;
        return created?.m1?.id ?? null;
    }
    catch {
        return null;
    }
}
async function runChecked(runner, opsJson, vars, label) {
    const r = await runner.run(opsJson, vars, label);
    if (!r.ok)
        throw new CalendarError(`${label} failed (HTTP ${r.status}).`);
    const err = findMethodError(r.bodyText);
    if (err)
        throw new CalendarError(`${label} failed: ${err}`);
    return r.bodyText;
}
/** The calendar parts of `messages`, by blob id (one request). */
async function fetchCalendars(runner, messages, label) {
    const ids = [
        ...new Set(messages
            .map((m) => m.calendarBlobId)
            .filter((id) => Boolean(id))),
    ];
    if (ids.length === 0)
        return new Map();
    const { opsJson, vars } = buildBlobGetOps(ids);
    const body = await runChecked(runner, opsJson, vars, `${label} (calendar parts)`);
    return parseBlobGetResponse(body);
}
/** The latest version of an invitation we organize. */
async function loadOurInvite(runner, uid, label) {
    const body = await runChecked(runner, buildSentByUidOps(), { UID: uid }, `${label} (lookup)`);
    const messages = parseScanResponse(body);
    const calendars = await fetchCalendars(runner, messages, label);
    const latest = latestOursByUid(toItems(messages, calendars), runner.self)
        .get(uid);
    if (!latest) {
        throw new CalendarError(`no invitation with invite_id '${uid}' was sent from this inbox. ` +
            "Use list_invites to see the ones you organize.");
    }
    return {
        ev: outgoingFromParsed(latest.ev),
        cancelled: latest.method === "CANCEL" || latest.ev.status === "CANCELLED",
    };
}
function inviteResult(status, ev, when, messageId) {
    return {
        status,
        invite_id: ev.uid,
        version: ev.sequence,
        title: ev.title,
        start: ev.start.toISOString(),
        end: ev.end.toISOString(),
        ...(ev.allDay ? { all_day: true } : {}),
        when,
        ...(ev.meetingUrl ? { meeting_url: ev.meetingUrl } : {}),
        attendees: ev.attendees.map((a) => a.email),
        message_id: messageId,
    };
}
/** `meeting_url` as given: "" (or spaces) means none. */
function meetingUrlInput(raw) {
    return raw?.trim() ? parseMeetingUrl(raw) : undefined;
}
/**
 * The zone to remember on the event for later messages: the caller's
 * time_zone, else the UTC offset written in start; none for all-day events
 * or plain UTC.
 */
function zoneToKeep(timeZone, rawStart, allDay) {
    if (allDay)
        return undefined;
    if (!timeZone && !rawStart)
        return undefined;
    const zone = displayZone(timeZone, rawStart);
    return zone === "UTC" ? undefined : zone;
}
/** The human date for an event, in the caller's zone unless it is all-day. */
function whenOf(ev, timeZone, raw) {
    return formatWhen(ev.start, ev.end, displayZone(timeZone, raw), Boolean(ev.allDay));
}
const ALL_DAY_NO_DURATION = "duration_minutes does not apply to an all-day event; pass end as the " +
    "last day (YYYY-MM-DD) instead.";
const ALL_DAY_NO_ZONE = "time_zone does not apply to an all-day event (its dates are the same in " +
    "every zone); leave it out.";
function guard(fn) {
    try {
        return fn();
    }
    catch (e) {
        throw e instanceof CalendarError
            ? e
            : new CalendarError(e.message);
    }
}
/** Validate a send before any network call (throws CalendarError). */
export function prepareSend(input, self) {
    return guard(() => {
        const title = input.title.trim();
        if (!title)
            throw new Error("title is empty.");
        checkLength(title, MAX_TITLE_CHARS, "title");
        checkLength(input.location, MAX_LOCATION_CHARS, "location");
        checkLength(input.description, MAX_DESCRIPTION_CHARS, "description");
        const meetingUrl = meetingUrlInput(input.meetingUrl);
        let start;
        let end;
        if (input.allDay) {
            if (input.durationMinutes !== undefined) {
                throw new Error(ALL_DAY_NO_DURATION);
            }
            if (input.timeZone)
                throw new Error(ALL_DAY_NO_ZONE);
            start = parseUserDate(input.start, "start");
            checkAllDayStart(start);
            end = resolveAllDayEnd(start, input.end);
        }
        else {
            start = parseUserDateTime(input.start, input.timeZone, "start");
            checkStart(start);
            end = resolveEnd({
                start,
                end: input.end,
                durationMinutes: input.durationMinutes,
                timeZone: input.timeZone,
            });
        }
        const guests = parseAttendees(asList(input.attendees)).filter((a) => a.email !== self);
        if (guests.length === 0) {
            throw new Error("invite at least one address other than this inbox.");
        }
        const ev = {
            uid: newEventUid(self),
            sequence: 0,
            title,
            description: input.description?.trim() || undefined,
            location: input.location?.trim() || undefined,
            ...(meetingUrl ? { meetingUrl } : {}),
            ...(input.allDay ? { allDay: true } : {}),
            start,
            end,
            ...(zoneToKeep(input.timeZone, input.start, input.allDay)
                ? {
                    displayTimeZone: zoneToKeep(input.timeZone, input.start, input.allDay),
                }
                : {}),
            organizer: { email: self },
            attendees: guests,
        };
        return { ev, when: whenOf(ev, input.timeZone, input.start) };
    });
}
export async function sendInvite(runner, input) {
    const { ev, when } = prepareSend(input, runner.self);
    const messageId = await sendCalendarMessage(runner, {
        label: "send_invite",
        to: ev.attendees,
        subject: messageSubject("invite", ev.title, when),
        body: composeBody({
            kind: "invite",
            title: ev.title,
            when,
            location: ev.location,
            description: ev.description,
            meetingUrl: ev.meetingUrl,
            organizer: ev.organizer,
            attendees: ev.attendees,
        }),
        ics: buildRequestIcs(ev),
        uid: ev.uid,
    });
    return inviteResult("sent", ev, when, messageId);
}
/** New start/end for update_invite, switching timed ↔ all-day if asked. */
function updatedTimes(prev, input) {
    const allDay = input.allDay ?? Boolean(prev.allDay);
    const keptLength = (start) => new Date(start.getTime() + (prev.end.getTime() - prev.start.getTime()));
    if (allDay) {
        if (input.durationMinutes !== undefined) {
            throw new Error(ALL_DAY_NO_DURATION);
        }
        if (input.timeZone &&
            (input.allDay !== undefined || input.start || input.end))
            throw new Error(ALL_DAY_NO_ZONE);
        if (!prev.allDay && !input.start) {
            throw new Error("to make this meeting all-day, pass start as a date (YYYY-MM-DD).");
        }
        if (input.start) {
            const start = parseUserDate(input.start, "start");
            checkAllDayStart(start);
            const end = input.end || !prev.allDay
                ? resolveAllDayEnd(start, input.end)
                : keptLength(start);
            return { start, end, allDay };
        }
        const end = input.end ? resolveAllDayEnd(prev.start, input.end) : prev.end;
        return { start: prev.start, end, allDay };
    }
    if (prev.allDay && !input.start) {
        throw new Error("to give this all-day event a time, pass start, e.g. " +
            "2026-10-16T15:00:00+03:00 (length: duration_minutes, default 30).");
    }
    const newEnd = (start) => resolveEnd({
        start,
        end: input.end,
        durationMinutes: input.durationMinutes,
        timeZone: input.timeZone,
    });
    if (input.start) {
        const start = parseUserDateTime(input.start, input.timeZone, "start");
        checkStart(start);
        // Moving a timed meeting keeps its length; one that was all-day gets the
        // send_invite default (30 minutes) unless end/duration say otherwise.
        const end = input.end || input.durationMinutes || prev.allDay
            ? newEnd(start)
            : keptLength(start);
        return { start, end, allDay };
    }
    const end = input.end || input.durationMinutes
        ? newEnd(prev.start)
        : prev.end;
    return { start: prev.start, end, allDay };
}
export async function updateInvite(runner, input) {
    const uid = input.inviteId.trim();
    const loaded = await loadOurInvite(runner, uid, "update_invite");
    if (loaded.cancelled) {
        throw new CalendarError("this invitation was cancelled. Send a new one with send_invite.");
    }
    const prev = loaded.ev;
    const next = guard(() => {
        // A time_zone given on its own still decides how times are shown, so an
        // unknown one is an error, not a silent fall back to UTC.
        if (input.timeZone !== undefined && !isValidTimeZone(input.timeZone)) {
            throw new Error(`Unknown time_zone '${input.timeZone}'. Use an IANA name, e.g. Europe/Moscow.`);
        }
        checkLength(input.title, MAX_TITLE_CHARS, "title");
        checkLength(input.location, MAX_LOCATION_CHARS, "location");
        checkLength(input.description, MAX_DESCRIPTION_CHARS, "description");
        const meetingUrl = input.meetingUrl !== undefined
            ? meetingUrlInput(input.meetingUrl)
            : prev.meetingUrl;
        const { start, end, allDay } = updatedTimes(prev, input);
        let attendees = prev.attendees;
        if (input.attendees !== undefined) {
            attendees = parseAttendees(asList(input.attendees)).filter((a) => a.email !== runner.self);
            if (attendees.length === 0) {
                throw new Error("the guest list would be empty. Use cancel_invite to call the meeting off.");
            }
        }
        const ev = {
            ...prev,
            sequence: prev.sequence + 1,
            title: input.title?.trim() || prev.title,
            description: input.description !== undefined
                ? input.description.trim() || undefined
                : prev.description,
            location: input.location !== undefined
                ? input.location.trim() || undefined
                : prev.location,
            meetingUrl,
            allDay: allDay || undefined,
            start,
            end,
            // A new time_zone or start decides the zone (UTC clears it); with
            // neither, the one the meeting was created in stays.
            displayTimeZone: allDay
                ? undefined
                : input.timeZone !== undefined || input.start !== undefined
                    ? zoneToKeep(input.timeZone, input.start, false)
                    : prev.displayTimeZone,
            attendees,
        };
        return ev;
    });
    const kept = new Set(next.attendees.map((a) => a.email));
    const removed = prev.attendees.filter((a) => !kept.has(a.email));
    const when = whenOf(next, input.timeZone ?? next.displayTimeZone, input.start);
    if (removed.length > 0) {
        // RFC 5546 §3.2.5: uninvited guests get a CANCEL listing only them, no STATUS.
        await sendCalendarMessage(runner, {
            label: "update_invite (removed guests)",
            to: removed,
            subject: messageSubject("cancel", next.title, when),
            body: composeBody({
                kind: "cancel",
                title: next.title,
                when,
                organizer: next.organizer,
            }),
            ics: buildCancelIcs({ ...next, attendees: removed }, new Date(Date.now() - 1000), undefined, true),
            uid: next.uid,
        });
    }
    const messageId = await sendCalendarMessage(runner, {
        label: "update_invite",
        to: next.attendees,
        subject: messageSubject("update", next.title, when),
        body: composeBody({
            kind: "update",
            title: next.title,
            when,
            location: next.location,
            description: next.description,
            meetingUrl: next.meetingUrl,
            organizer: next.organizer,
            attendees: next.attendees,
        }),
        ics: buildRequestIcs(next),
        uid: next.uid,
    });
    return {
        ...inviteResult("updated", next, when, messageId),
        removed_attendees: removed.map((a) => a.email),
    };
}
// ---------------------------------------------------------------------------
export async function cancelInvite(runner, input) {
    guard(() => checkLength(input.note, MAX_COMMENT_CHARS, "note"));
    const loaded = await loadOurInvite(runner, input.inviteId.trim(), "cancel_invite");
    if (loaded.cancelled) {
        throw new CalendarError("this invitation is already cancelled.");
    }
    const ev = { ...loaded.ev, sequence: loaded.ev.sequence + 1 };
    // The zone only labels the times in the email, but an unknown one would
    // silently show them in UTC: refuse it, as update_invite does.
    if (input.timeZone !== undefined && !isValidTimeZone(input.timeZone)) {
        throw new CalendarError(`Unknown time_zone '${input.timeZone}'. Use an IANA name, e.g. Europe/Moscow.`);
    }
    const when = whenOf(ev, input.timeZone ?? ev.displayTimeZone);
    const note = input.note?.trim() || undefined;
    const messageId = await sendCalendarMessage(runner, {
        label: "cancel_invite",
        to: ev.attendees,
        subject: messageSubject("cancel", ev.title, when),
        body: composeBody({
            kind: "cancel",
            title: ev.title,
            when,
            organizer: ev.organizer,
            comment: note,
        }),
        ics: buildCancelIcs(ev, new Date(), note),
        uid: ev.uid,
    });
    return inviteResult("cancelled", ev, when, messageId);
}
export async function listInvites(runner, input) {
    const limit = Math.min(Math.max(Math.floor(input.limit ?? SCAN_DEFAULT), 1), SCAN_MAX);
    const uid = input.inviteId?.trim() || undefined;
    const body = await runChecked(runner, buildScanOps(limit, uid), uid ? { UID: uid } : undefined, "list_invites");
    const messages = parseScanResponse(body);
    const calendars = await fetchCalendars(runner, messages, "list_invites");
    const state = deriveInviteState(messages, calendars, runner.self);
    return {
        organized: uid
            ? state.organized.filter((o) => o.invite_id === uid)
            : state.organized,
        received: uid
            ? state.received.filter((r) => r.invite_id === uid)
            : state.received,
        scanned: {
            sent: messages.filter((m) => m.box === "sent").length,
            inbox: messages.filter((m) => m.box === "inbox").length,
        },
    };
}
export async function respondToInvite(runner, input) {
    if (!(input.response in RESPONSE_TO_PARTSTAT)) {
        throw new CalendarError("response must be accepted, declined or tentative.");
    }
    guard(() => checkLength(input.note, MAX_COMMENT_CHARS, "note"));
    const body = await runChecked(runner, buildGetMessageOps(), { MESSAGE_ID: input.messageId.trim() }, "respond_to_invite (lookup)");
    const msg = parseScanResponse(body)[0];
    if (!msg)
        throw new CalendarError("message not found.");
    if (!msg.calendarBlobId) {
        throw new CalendarError("this message carries no calendar invitation.");
    }
    const calendars = await fetchCalendars(runner, [msg], "respond_to_invite");
    const cal = parseCalendar(calendars.get(msg.calendarBlobId) ?? "");
    const invite = cal ? primaryEvent(cal) : null;
    if (!cal || !invite) {
        throw new CalendarError("the calendar part could not be read.");
    }
    if (cal.method !== "REQUEST") {
        throw new CalendarError(`this message is a ${cal.method}, not an invitation you can answer.`);
    }
    if (!invite.organizer || invite.organizer.email === runner.self) {
        throw new CalendarError("you organize this meeting; there is nothing to answer.");
    }
    const listed = invite.attendees.find((a) => a.email === runner.self);
    if (!listed) {
        throw new CalendarError("this invitation does not list this inbox as a guest, so there is " +
            "nothing to answer (a reply would speak for an address it wasn't sent to).");
    }
    // The organizer named inside the calendar is where the answer goes. Only
    // trust it when the email came from that organizer (or from the delegate it
    // names in SENT-BY): otherwise anyone could make us mail an arbitrary address.
    // SENT-BY comes from the same untrusted calendar, so a delegate counts only
    // inside the organizer's own domain: a stranger cannot name themselves the
    // delegate of any address.
    const sender = msg.from?.[0]?.email?.toLowerCase();
    const sentBy = organizerSentBy(calendars.get(msg.calendarBlobId) ?? "");
    // The domain of a well-formed `local@domain` only; anything else is null.
    const domainOf = (a) => {
        const at = a.indexOf("@");
        return at > 0 && at === a.lastIndexOf("@") && at < a.length - 1
            ? a.slice(at + 1)
            : null;
    };
    const senderDomain = sender === undefined ? null : domainOf(sender);
    const delegate = senderDomain !== null && sender === sentBy &&
        senderDomain === domainOf(invite.organizer.email);
    if (sender !== invite.organizer.email && !delegate) {
        throw new CalendarError(`the invitation names ${invite.organizer.email} as organizer but the ` +
            `email came from ${sender ?? "an unknown sender"}; not answering. ` +
            "Ask the user whether to reply by email instead.");
    }
    const me = listed;
    const note = input.note?.trim() || undefined;
    const kind = input.response === "accepted"
        ? "reply-accepted"
        : input.response === "declined"
            ? "reply-declined"
            : "reply-tentative";
    const when = invite.start && invite.end
        ? formatWhen(invite.start, invite.end, invite.timeZone ?? "UTC", Boolean(invite.allDayDate))
        : "time not given";
    const title = invite.title ?? "(no title)";
    const messageId = await sendCalendarMessage(runner, {
        label: "respond_to_invite",
        to: [invite.organizer],
        subject: messageSubject(kind, title, when),
        body: composeBody({
            kind,
            title,
            when,
            organizer: invite.organizer,
            responder: me,
            comment: note,
        }),
        ics: buildReplyIcs(invite, { email: runner.self, name: me.name }, RESPONSE_TO_PARTSTAT[input.response], new Date(), note),
        uid: invite.uid,
        inReplyTo: msg.messageId,
    });
    return {
        status: "sent",
        invite_id: invite.uid,
        response: input.response,
        organizer: invite.organizer.email,
        title,
        message_id: messageId,
    };
}
/** The SENT-BY address on the ORGANIZER line (a delegate sending for them). */
function organizerSentBy(ics) {
    const line = ics.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)
        .find((l) => /^ORGANIZER[;:]/i.test(l));
    const m = line?.match(/;SENT-BY="?(?:mailto:)?([^";:]+)"?/i);
    return m ? m[1].trim().toLowerCase() : undefined;
}
