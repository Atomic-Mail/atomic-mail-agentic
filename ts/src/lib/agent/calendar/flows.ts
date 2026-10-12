// The five calendar operations as JMAP round trips, independent of how the
// caller talks to JMAP. mcp-server runs them through its per-call session;
// the client CLI and stdio MCP through AgentSession. This file, ical.ts and
// invites.ts are carried byte-for-byte by both repos — change them together.
//
//   send    1 request : Blob/upload + Email/set + EmailSubmission/set
//   update  3–4       : find our versions by UID → their calendar parts →
//                       (CANCEL to removed guests) → REQUEST with SEQUENCE+1
//   cancel  3         : find → parts → CANCEL with SEQUENCE+1
//   list    2         : scan Sent (by UID header) + Inbox → calendar parts
//   respond 3         : the invitation → its calendar part → REPLY

import { isValidTimeZone } from "./ical.ts";
import {
  buildBlobGetOps,
  buildCalendarSend,
  buildCancelIcs,
  buildGetMessageOps,
  buildReplyIcs,
  buildRequestIcs,
  buildScanOps,
  buildSentByUidOps,
  checkLength,
  checkStart,
  composeBody,
  deriveInviteState,
  findMethodError,
  formatWhen,
  type InviteState,
  latestOursByUid,
  MAX_COMMENT_CHARS,
  MAX_DESCRIPTION_CHARS,
  MAX_LOCATION_CHARS,
  MAX_TITLE_CHARS,
  messageSubject,
  newEventUid,
  type OutgoingEvent,
  outgoingFromParsed,
  parseAttendees,
  parseBlobGetResponse,
  parseCalendar,
  parseScanResponse,
  parseUserDateTime,
  type Person,
  primaryEvent,
  resolveEnd,
  type Response,
  RESPONSE_TO_PARTSTAT,
  SCAN_DEFAULT,
  SCAN_MAX,
  type ScannedMessage,
  toItems,
} from "./invites.ts";

export interface JmapCallResult {
  ok: boolean;
  status: number;
  bodyText: string;
}

export interface CalendarRunner {
  /** The agent's own address, lower-cased (custom-domain aware). */
  self: string;
  /** Run one JMAP batch; `vars` fill $VAR tokens ($ACCOUNT_ID etc. auto). */
  run(
    opsJson: string,
    vars: Record<string, string> | undefined,
    label: string,
  ): Promise<JmapCallResult>;
}

/** A refusal or failure to show the caller as is. */
export class CalendarError extends Error {}

/** Split "a@x, b@y" / arrays into trimmed entries. */
export function asList(v: string | string[] | undefined): string[] {
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v])
    .flatMap((s) => s.split(/[,;\n]/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Zone for the human-readable date: the caller's, else the offset given, else UTC. */
export function displayZone(timeZone?: string, raw?: string): string {
  if (timeZone && isValidTimeZone(timeZone)) return timeZone;
  const m = raw?.trim().match(/([+-]\d{2}):?(\d{2})$/);
  if (m) {
    const offset = `${m[1]}:${m[2]}`;
    if (isValidTimeZone(offset)) return offset;
  }
  return "UTC";
}

function firstSetFailure(bodyText: string): string | null {
  let parsed: { methodResponses?: [string, Record<string, unknown>, string][] };
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return null;
  }
  for (const [name, args] of parsed.methodResponses ?? []) {
    if (name === "error") return `JMAP error: ${JSON.stringify(args)}`;
    const notCreated = args?.notCreated as Record<string, unknown> | undefined;
    if (notCreated && Object.keys(notCreated).length > 0) {
      return `${name} rejected: ${JSON.stringify(notCreated)}`;
    }
  }
  return null;
}

/** Send one calendar message; returns the created Email id. */
async function sendCalendarMessage(
  runner: CalendarRunner,
  input: {
    label: string;
    to: Person[];
    subject: string;
    body: { text: string; html: string };
    ics: string;
    uid: string;
    inReplyTo?: string;
  },
): Promise<string | null> {
  const { opsJson, vars } = buildCalendarSend(input);
  const result = await runner.run(opsJson, vars, input.label);
  if (!result.ok) {
    throw new CalendarError(
      `${input.label} failed (HTTP ${result.status}): ${
        result.bodyText.slice(0, 300)
      }`,
    );
  }
  const failure = firstSetFailure(result.bodyText);
  if (failure) {
    throw new CalendarError(`${input.label} failed: ${failure.slice(0, 400)}`);
  }
  try {
    const parsed = JSON.parse(result.bodyText) as {
      methodResponses?: [string, Record<string, unknown>, string][];
    };
    const set = parsed.methodResponses?.find((r) => r[0] === "Email/set");
    const created = set?.[1].created as
      | Record<string, { id?: string }>
      | undefined;
    return created?.m1?.id ?? null;
  } catch {
    return null;
  }
}

async function runChecked(
  runner: CalendarRunner,
  opsJson: string,
  vars: Record<string, string> | undefined,
  label: string,
): Promise<string> {
  const r = await runner.run(opsJson, vars, label);
  if (!r.ok) throw new CalendarError(`${label} failed (HTTP ${r.status}).`);
  const err = findMethodError(r.bodyText);
  if (err) throw new CalendarError(`${label} failed: ${err}`);
  return r.bodyText;
}

/** The calendar parts of `messages`, by blob id (one request). */
async function fetchCalendars(
  runner: CalendarRunner,
  messages: ScannedMessage[],
  label: string,
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      messages
        .map((m) => m.calendarBlobId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (ids.length === 0) return new Map();
  const { opsJson, vars } = buildBlobGetOps(ids);
  const body = await runChecked(
    runner,
    opsJson,
    vars,
    `${label} (calendar parts)`,
  );
  return parseBlobGetResponse(body);
}

/** The latest version of an invitation we organize. */
async function loadOurInvite(
  runner: CalendarRunner,
  uid: string,
  label: string,
): Promise<{ ev: OutgoingEvent; cancelled: boolean }> {
  const body = await runChecked(
    runner,
    buildSentByUidOps(),
    { UID: uid },
    `${label} (lookup)`,
  );
  const messages = parseScanResponse(body);
  const calendars = await fetchCalendars(runner, messages, label);
  const latest = latestOursByUid(toItems(messages, calendars), runner.self)
    .get(uid);
  if (!latest) {
    throw new CalendarError(
      `no invitation with invite_id '${uid}' was sent from this inbox. ` +
        "Use list_invites to see the ones you organize.",
    );
  }
  return {
    ev: outgoingFromParsed(latest.ev),
    cancelled: latest.method === "CANCEL" || latest.ev.status === "CANCELLED",
  };
}

export interface InviteResult {
  status: "sent" | "updated" | "cancelled";
  invite_id: string;
  version: number;
  title: string;
  start: string;
  end: string;
  when: string;
  attendees: string[];
  removed_attendees?: string[];
  message_id: string | null;
}

function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw e instanceof CalendarError
      ? e
      : new CalendarError((e as Error).message);
  }
}

// ---------------------------------------------------------------------------

export interface SendInviteInput {
  title: string;
  start: string;
  end?: string;
  durationMinutes?: number;
  timeZone?: string;
  attendees: string | string[];
  location?: string;
  description?: string;
}

/** Validate a send before any network call (throws CalendarError). */
export function prepareSend(input: SendInviteInput, self: string): {
  ev: OutgoingEvent;
  when: string;
} {
  return guard(() => {
    const title = input.title.trim();
    if (!title) throw new Error("title is empty.");
    checkLength(title, MAX_TITLE_CHARS, "title");
    checkLength(input.location, MAX_LOCATION_CHARS, "location");
    checkLength(input.description, MAX_DESCRIPTION_CHARS, "description");
    const start = parseUserDateTime(input.start, input.timeZone, "start");
    checkStart(start);
    const end = resolveEnd({
      start,
      end: input.end,
      durationMinutes: input.durationMinutes,
      timeZone: input.timeZone,
    });
    const guests = parseAttendees(asList(input.attendees)).filter((a) =>
      a.email !== self
    );
    if (guests.length === 0) {
      throw new Error("invite at least one address other than this inbox.");
    }
    const ev: OutgoingEvent = {
      uid: newEventUid(self),
      sequence: 0,
      title,
      description: input.description?.trim() || undefined,
      location: input.location?.trim() || undefined,
      start,
      end,
      organizer: { email: self },
      attendees: guests,
    };
    return {
      ev,
      when: formatWhen(start, end, displayZone(input.timeZone, input.start)),
    };
  });
}

export async function sendInvite(
  runner: CalendarRunner,
  input: SendInviteInput,
): Promise<InviteResult> {
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
      organizer: ev.organizer,
      attendees: ev.attendees,
    }),
    ics: buildRequestIcs(ev),
    uid: ev.uid,
  });
  return {
    status: "sent",
    invite_id: ev.uid,
    version: 0,
    title: ev.title,
    start: ev.start.toISOString(),
    end: ev.end.toISOString(),
    when,
    attendees: ev.attendees.map((a) => a.email),
    message_id: messageId,
  };
}

// ---------------------------------------------------------------------------

export interface UpdateInviteInput {
  inviteId: string;
  title?: string;
  start?: string;
  end?: string;
  durationMinutes?: number;
  timeZone?: string;
  /** The full new guest list; omit to keep it. */
  attendees?: string | string[];
  location?: string;
  description?: string;
}

export async function updateInvite(
  runner: CalendarRunner,
  input: UpdateInviteInput,
): Promise<InviteResult> {
  const uid = input.inviteId.trim();
  const loaded = await loadOurInvite(runner, uid, "update_invite");
  if (loaded.cancelled) {
    throw new CalendarError(
      "this invitation was cancelled. Send a new one with send_invite.",
    );
  }
  const prev = loaded.ev;
  const next = guard(() => {
    checkLength(input.title, MAX_TITLE_CHARS, "title");
    checkLength(input.location, MAX_LOCATION_CHARS, "location");
    checkLength(input.description, MAX_DESCRIPTION_CHARS, "description");
    let start = prev.start;
    let end = prev.end;
    if (input.start) {
      start = parseUserDateTime(input.start, input.timeZone, "start");
      checkStart(start);
      end = input.end || input.durationMinutes
        ? resolveEnd({
          start,
          end: input.end,
          durationMinutes: input.durationMinutes,
          timeZone: input.timeZone,
        })
        : new Date(
          start.getTime() + (prev.end.getTime() - prev.start.getTime()),
        );
    } else if (input.end || input.durationMinutes) {
      end = resolveEnd({
        start,
        end: input.end,
        durationMinutes: input.durationMinutes,
        timeZone: input.timeZone,
      });
    }
    let attendees = prev.attendees;
    if (input.attendees !== undefined) {
      attendees = parseAttendees(asList(input.attendees)).filter((a) =>
        a.email !== runner.self
      );
      if (attendees.length === 0) {
        throw new Error(
          "the guest list would be empty. Use cancel_invite to call the meeting off.",
        );
      }
    }
    const ev: OutgoingEvent = {
      ...prev,
      sequence: prev.sequence + 1,
      title: input.title?.trim() || prev.title,
      description: input.description !== undefined
        ? input.description.trim() || undefined
        : prev.description,
      location: input.location !== undefined
        ? input.location.trim() || undefined
        : prev.location,
      start,
      end,
      attendees,
    };
    return ev;
  });
  const kept = new Set(next.attendees.map((a) => a.email));
  const removed = prev.attendees.filter((a) => !kept.has(a.email));
  const when = formatWhen(
    next.start,
    next.end,
    displayZone(input.timeZone, input.start),
  );
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
      ics: buildCancelIcs(
        { ...next, attendees: removed },
        new Date(Date.now() - 1000),
        undefined,
        true,
      ),
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
      organizer: next.organizer,
      attendees: next.attendees,
    }),
    ics: buildRequestIcs(next),
    uid: next.uid,
  });
  return {
    status: "updated",
    invite_id: next.uid,
    version: next.sequence,
    title: next.title,
    start: next.start.toISOString(),
    end: next.end.toISOString(),
    when,
    attendees: next.attendees.map((a) => a.email),
    removed_attendees: removed.map((a) => a.email),
    message_id: messageId,
  };
}

// ---------------------------------------------------------------------------

export async function cancelInvite(
  runner: CalendarRunner,
  input: { inviteId: string; note?: string; timeZone?: string },
): Promise<InviteResult> {
  guard(() => checkLength(input.note, MAX_COMMENT_CHARS, "note"));
  const loaded = await loadOurInvite(
    runner,
    input.inviteId.trim(),
    "cancel_invite",
  );
  if (loaded.cancelled) {
    throw new CalendarError("this invitation is already cancelled.");
  }
  const ev: OutgoingEvent = { ...loaded.ev, sequence: loaded.ev.sequence + 1 };
  const when = formatWhen(ev.start, ev.end, displayZone(input.timeZone));
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
  return {
    status: "cancelled",
    invite_id: ev.uid,
    version: ev.sequence,
    title: ev.title,
    start: ev.start.toISOString(),
    end: ev.end.toISOString(),
    when,
    attendees: ev.attendees.map((a) => a.email),
    message_id: messageId,
  };
}

// ---------------------------------------------------------------------------

export interface ListResult extends InviteState {
  scanned: { sent: number; inbox: number };
}

export async function listInvites(
  runner: CalendarRunner,
  input: { inviteId?: string; limit?: number },
): Promise<ListResult> {
  const limit = Math.min(
    Math.max(Math.floor(input.limit ?? SCAN_DEFAULT), 1),
    SCAN_MAX,
  );
  const uid = input.inviteId?.trim() || undefined;
  const body = await runChecked(
    runner,
    buildScanOps(limit, uid),
    uid ? { UID: uid } : undefined,
    "list_invites",
  );
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

// ---------------------------------------------------------------------------

export interface RespondResult {
  status: "sent";
  invite_id: string;
  response: Response;
  organizer: string;
  title: string;
  message_id: string | null;
}

export async function respondToInvite(
  runner: CalendarRunner,
  input: { messageId: string; response: Response; note?: string },
): Promise<RespondResult> {
  if (!(input.response in RESPONSE_TO_PARTSTAT)) {
    throw new CalendarError(
      "response must be accepted, declined or tentative.",
    );
  }
  guard(() => checkLength(input.note, MAX_COMMENT_CHARS, "note"));
  const body = await runChecked(
    runner,
    buildGetMessageOps(),
    { MESSAGE_ID: input.messageId.trim() },
    "respond_to_invite (lookup)",
  );
  const msg = parseScanResponse(body)[0];
  if (!msg) throw new CalendarError("message not found.");
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
    throw new CalendarError(
      `this message is a ${cal.method}, not an invitation you can answer.`,
    );
  }
  if (!invite.organizer || invite.organizer.email === runner.self) {
    throw new CalendarError(
      "you organize this meeting; there is nothing to answer.",
    );
  }
  const me: Person = invite.attendees.find((a) => a.email === runner.self) ??
    { email: runner.self };
  const note = input.note?.trim() || undefined;
  const kind = input.response === "accepted"
    ? "reply-accepted"
    : input.response === "declined"
    ? "reply-declined"
    : "reply-tentative";
  const when = invite.start && invite.end
    ? formatWhen(
      invite.start,
      invite.end,
      invite.timeZone ?? "UTC",
      Boolean(invite.allDayDate),
    )
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
    ics: buildReplyIcs(
      invite,
      { email: runner.self, name: me.name },
      RESPONSE_TO_PARTSTAT[input.response],
      new Date(),
      note,
    ),
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
