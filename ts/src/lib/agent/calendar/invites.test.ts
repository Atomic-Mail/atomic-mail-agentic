import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  buildBlobGetOps,
  buildCalendarSend,
  buildCancelIcs,
  buildReplyIcs,
  buildRequestIcs,
  buildScanOps,
  CALENDAR_UID_HEADER,
  checkAllDayStart,
  checkStart,
  composeBody,
  deriveInviteState,
  findCalendarBlobId,
  formatWhen,
  messageSubject,
  type OutgoingEvent,
  outgoingFromParsed,
  parseAttendees,
  parseCalendar,
  parseMeetingUrl,
  parsePerson,
  parseScanResponse,
  parseUserDate,
  parseUserDateTime,
  primaryEvent,
  resolveAllDayEnd,
  resolveEnd,
  type ScannedMessage,
} from "./invites.ts";
import { escapeText, unfoldLines } from "./ical.ts";

const ME = "calagenta@atomicmail.ai";
const crlf = (lines: string[]) => lines.join("\r\n") + "\r\n";

// --- Fixtures shaped like what Google Calendar and Exchange send ------------

const GOOGLE_REQUEST = crlf([
  "BEGIN:VCALENDAR",
  "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "VERSION:2.0",
  "CALSCALE:GREGORIAN",
  "METHOD:REQUEST",
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Moscow",
  "X-LIC-LOCATION:Europe/Moscow",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0300",
  "TZOFFSETTO:+0300",
  "TZNAME:MSK",
  "DTSTART:19700101T000000",
  "END:STANDARD",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Moscow:20261020T150000",
  "DTEND;TZID=Europe/Moscow:20261020T160000",
  "DTSTAMP:20261012T101500Z",
  "ORGANIZER;CN=Egor Rybkov:mailto:egor@gmail.com",
  "UID:7kukuqrfedgmqn2ap5e8v1s8bq@google.com",
  "ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=TRUE",
  " ;CN=Egor Rybkov;X-NUM-GUESTS=0:mailto:egor@gmail.com",
  "ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=",
  " TRUE;CN=calagenta@atomicmail.ai;X-NUM-GUESTS=0:mailto:calagenta@atomicmail.ai",
  "X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij",
  "DESCRIPTION:Let's talk\\, finally.\\n\\nJoin: https://meet.google.com/abc-defg-hij",
  "LOCATION:",
  "SEQUENCE:0",
  "STATUS:CONFIRMED",
  "SUMMARY:Sync with agent",
  "TRANSP:OPAQUE",
  "END:VEVENT",
  "END:VCALENDAR",
]);

const OUTLOOK_REQUEST = crlf([
  "BEGIN:VCALENDAR",
  "METHOD:REQUEST",
  "PRODID:Microsoft Exchange Server 2010",
  "VERSION:2.0",
  "BEGIN:VTIMEZONE",
  "TZID:Russian Standard Time",
  "BEGIN:STANDARD",
  "DTSTART:16010101T000000",
  "TZOFFSETFROM:+0300",
  "TZOFFSETTO:+0300",
  "END:STANDARD",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "ORGANIZER;CN=Egor Rybkov:mailto:egor.rybkov@hotmail.com",
  "ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=calagenta@a",
  " tomicmail.ai:mailto:calagenta@atomicmail.ai",
  "DESCRIPTION;LANGUAGE=en-US:Quarterly review\\n",
  "UID:040000008200E00074C5B7101A82E00800000000F0A3C2D1A55BDC0100000000000000001",
  " 0000000A1B2C3D4E5F6",
  "SUMMARY;LANGUAGE=en-US:Q4 review",
  "DTSTART;TZID=Russian Standard Time:20261021T110000",
  "DTEND;TZID=Russian Standard Time:20261021T113000",
  "DTSTAMP:20261012T102000Z",
  "STATUS:CONFIRMED",
  "SEQUENCE:0",
  "LOCATION;LANGUAGE=en-US:Microsoft Teams Meeting",
  "X-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.microsoft.com/l/meetup-join/xyz",
  "END:VEVENT",
  "END:VCALENDAR",
]);

function ourEvent(over: Partial<OutgoingEvent> = {}): OutgoingEvent {
  return {
    uid: "u-1@atomicmail.ai",
    sequence: 0,
    title: "Demo, part 1; Q&A",
    description: "Agenda:\n- intro\n- демо",
    location: "https://meet.example.com/x",
    start: new Date("2026-10-16T12:00:00Z"),
    end: new Date("2026-10-16T12:30:00Z"),
    organizer: { email: ME },
    attendees: [{ email: "anna@gmail.com", name: "Anna B" }, {
      email: "bob@outlook.com",
    }],
    ...over,
  };
}

const NOW = new Date("2026-10-12T10:00:00Z");

// --- Input parsing -----------------------------------------------------------

Deno.test("parseUserDateTime: offsets, local + time zone, and refusals", () => {
  assertEquals(
    parseUserDateTime("2026-10-16T15:00:00+03:00", undefined, "start")
      .toISOString(),
    "2026-10-16T12:00:00.000Z",
  );
  assertEquals(
    parseUserDateTime("2026-10-16T12:00Z", undefined, "start").toISOString(),
    "2026-10-16T12:00:00.000Z",
  );
  assertEquals(
    parseUserDateTime("2026-10-16T15:00", "Europe/Moscow", "start")
      .toISOString(),
    "2026-10-16T12:00:00.000Z",
  );
  assertEquals(
    parseUserDateTime("2026-10-16 15:00", "Europe/Moscow", "start")
      .toISOString(),
    "2026-10-16T12:00:00.000Z",
  );
  assertThrows(
    () => parseUserDateTime("2026-10-16T15:00", undefined, "start"),
    Error,
    "time_zone",
  );
  assertThrows(
    () => parseUserDateTime("2026-10-16T15:00", "Mars/Olympus", "start"),
    Error,
    "Unknown time_zone",
  );
  assertThrows(
    () => parseUserDateTime("tomorrow at 3", "UTC", "start"),
    Error,
    "ISO 8601",
  );
  assertThrows(
    () => parseUserDateTime("2026-13-01T10:00", "UTC", "start"),
    Error,
    "not a valid",
  );
});

Deno.test("resolveEnd: default 30 min, duration, explicit end, ordering and cap", () => {
  const start = new Date("2026-10-16T12:00:00Z");
  assertEquals(resolveEnd({ start }).toISOString(), "2026-10-16T12:30:00.000Z");
  assertEquals(
    resolveEnd({ start, durationMinutes: 90 }).toISOString(),
    "2026-10-16T13:30:00.000Z",
  );
  assertEquals(
    resolveEnd({ start, end: "2026-10-16T16:00:00+03:00" }).toISOString(),
    "2026-10-16T13:00:00.000Z",
  );
  assertThrows(
    () => resolveEnd({ start, end: "2026-10-16T11:00:00Z" }),
    Error,
    "after start",
  );
  assertThrows(
    () => resolveEnd({ start, durationMinutes: 60 * 24 * 40 }),
    Error,
    "31 days",
  );
});

Deno.test("parsePerson / parseAttendees: names, case, dedupe, junk", () => {
  assertEquals(parsePerson("Anna B <Anna@Gmail.com>"), {
    email: "anna@gmail.com",
    name: "Anna B",
  });
  assertEquals(parsePerson('"Doe, John" <j@x.io>'), {
    email: "j@x.io",
    name: "Doe, John",
  });
  assertEquals(parsePerson("bob@outlook.com"), { email: "bob@outlook.com" });
  assertEquals(parsePerson("not an address"), null);
  assertEquals(
    parseAttendees(["a@x.io", "A@X.io", "b@y.io"]).map((p) => p.email),
    ["a@x.io", "b@y.io"],
  );
  assertThrows(() => parseAttendees([]), Error, "at least one");
  assertThrows(() => parseAttendees(["nope"]), Error, "not an email");
  assertThrows(
    () => parseAttendees(Array.from({ length: 26 }, (_, i) => `u${i}@x.io`)),
    Error,
    "At most 25",
  );
});

// --- Building ----------------------------------------------------------------

Deno.test("buildRequestIcs: RFC 5545 shape, escaped text, round-trips through the parser", () => {
  const ics = buildRequestIcs(ourEvent(), NOW);
  assert(ics.endsWith("\r\n"));
  assertEquals(
    ics.includes("\n") && !ics.split("\r\n").some((l) => l.includes("\n")),
    true,
  );
  for (const l of ics.split("\r\n")) {
    assert(new TextEncoder().encode(l).length <= 75, `too long: ${l}`);
  }
  const lines = unfoldLines(ics);
  assertEquals(lines[0], "BEGIN:VCALENDAR");
  assert(lines.includes("METHOD:REQUEST"));
  assert(lines.includes("DTSTART:20261016T120000Z"));
  assert(lines.includes("DTEND:20261016T123000Z"));
  assert(lines.includes("DTSTAMP:20261012T100000Z"));
  assert(lines.includes("SUMMARY:Demo\\, part 1\\; Q&A"));
  assert(lines.includes(`ORGANIZER:mailto:${ME}`));
  assert(
    lines.some((l) =>
      l.startsWith("ATTENDEE;") && l.includes("RSVP=TRUE") &&
      l.includes("PARTSTAT=NEEDS-ACTION") && l.includes("CN=Anna B") &&
      l.endsWith(":mailto:anna@gmail.com")
    ),
  );

  const cal = parseCalendar(ics)!;
  assertEquals(cal.method, "REQUEST");
  const ev = primaryEvent(cal)!;
  assertEquals(ev.uid, "u-1@atomicmail.ai");
  assertEquals(ev.title, "Demo, part 1; Q&A");
  assertEquals(ev.description, "Agenda:\n- intro\n- демо");
  assertEquals(ev.start?.toISOString(), "2026-10-16T12:00:00.000Z");
  assertEquals(ev.organizer, { email: ME });
  assertEquals(ev.attendees.map((a) => a.email), [
    "anna@gmail.com",
    "bob@outlook.com",
  ]);
  assertEquals(ev.meetingUrl, "https://meet.example.com/x");
});

Deno.test("buildCancelIcs partial: uninviting guests sends no STATUS", () => {
  const lines = unfoldLines(
    buildCancelIcs(ourEvent({ sequence: 2 }), NOW, undefined, true),
  );
  assert(lines.includes("METHOD:CANCEL"));
  assertEquals(lines.some((l) => l.startsWith("STATUS:")), false);
});

Deno.test("parseCalendar: Google puts the guest's note in X-RESPONSE-COMMENT", () => {
  const ev = primaryEvent(
    parseCalendar(crlf([
      "BEGIN:VCALENDAR",
      "METHOD:REPLY",
      "BEGIN:VEVENT",
      "UID:u-1",
      'ATTENDEE;CUTYPE=INDIVIDUAL;PARTSTAT=DECLINED;X-NUM-GUESTS=0;X-RESPONSE-COMMENT="Busy\\, sorry":mailto:anna@gmail.com',
      "END:VEVENT",
      "END:VCALENDAR",
    ]))!,
  )!;
  assertEquals(ev.attendees[0].comment, "Busy, sorry");
  assertEquals(ev.comment, "Busy, sorry");
});

Deno.test("checkStart: refuses the past and the far future", () => {
  const now = new Date("2026-10-12T10:00:00Z");
  checkStart(new Date("2026-10-12T09:55:00Z"), now);
  assertThrows(
    () => checkStart(new Date("2026-10-11T10:00:00Z"), now),
    Error,
    "in the past",
  );
  assertThrows(
    () => checkStart(new Date("2029-01-01T00:00:00Z"), now),
    Error,
    "two years",
  );
});

Deno.test("buildCancelIcs: METHOD:CANCEL, STATUS:CANCELLED, sequence as given, comment", () => {
  const ics = buildCancelIcs(ourEvent({ sequence: 3 }), NOW, "Sorry, ill");
  const lines = unfoldLines(ics);
  assert(lines.includes("METHOD:CANCEL"));
  assert(lines.includes("STATUS:CANCELLED"));
  assert(lines.includes("SEQUENCE:3"));
  assert(lines.includes("COMMENT:Sorry\\, ill"));
  assert(!lines.some((l) => l.includes("RSVP=TRUE")));
});

Deno.test("buildReplyIcs: answers a Google invitation the way iTIP expects", () => {
  const invite = primaryEvent(parseCalendar(GOOGLE_REQUEST)!)!;
  const ics = buildReplyIcs(invite, { email: ME }, "ACCEPTED", NOW, "See you");
  const reply = parseCalendar(ics)!;
  assertEquals(reply.method, "REPLY");
  const ev = primaryEvent(reply)!;
  assertEquals(ev.uid, "7kukuqrfedgmqn2ap5e8v1s8bq@google.com");
  assertEquals(ev.sequence, 0);
  assertEquals(ev.organizer?.email, "egor@gmail.com");
  assertEquals(ev.attendees, [{ email: ME, partstat: "ACCEPTED" }]);
  assertEquals(ev.start?.toISOString(), "2026-10-20T12:00:00.000Z");
  assertEquals(ev.comment, "See you");
});

// --- Parsing what clients send ------------------------------------------------

Deno.test("parseCalendar: Google invitation (TZID, folded attendees, Meet link)", () => {
  const cal = parseCalendar(GOOGLE_REQUEST)!;
  assertEquals(cal.method, "REQUEST");
  const ev = primaryEvent(cal)!;
  assertEquals(ev.title, "Sync with agent");
  assertEquals(ev.start?.toISOString(), "2026-10-20T12:00:00.000Z");
  assertEquals(ev.end?.toISOString(), "2026-10-20T13:00:00.000Z");
  assertEquals(ev.timeZone, "Europe/Moscow");
  assertEquals(ev.organizer, { email: "egor@gmail.com", name: "Egor Rybkov" });
  assertEquals(
    ev.attendees.find((a) => a.email === ME)?.partstat,
    "NEEDS-ACTION",
  );
  assertEquals(ev.meetingUrl, "https://meet.google.com/abc-defg-hij");
  assertEquals(
    ev.description,
    "Let's talk, finally.\n\nJoin: https://meet.google.com/abc-defg-hij",
  );
  assertEquals(ev.recurring, false);
});

Deno.test("parseCalendar: Outlook invitation (Windows zone name, folded UID, Teams link)", () => {
  const ev = primaryEvent(parseCalendar(OUTLOOK_REQUEST)!)!;
  assertEquals(
    ev.uid,
    "040000008200E00074C5B7101A82E00800000000F0A3C2D1A55BDC01000000000000000010000000A1B2C3D4E5F6",
  );
  assertEquals(ev.title, "Q4 review");
  assertEquals(ev.start?.toISOString(), "2026-10-21T08:00:00.000Z");
  assertEquals(ev.end?.toISOString(), "2026-10-21T08:30:00.000Z");
  assertEquals(ev.meetingUrl, "https://teams.microsoft.com/l/meetup-join/xyz");
  assertEquals(ev.attendees[0].email, ME);
});

Deno.test("parseCalendar: all-day and DURATION events, recurring flag", () => {
  const ev = primaryEvent(
    parseCalendar(crlf([
      "BEGIN:VCALENDAR",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:d1",
      "DTSTART;VALUE=DATE:20261020",
      "RRULE:FREQ=WEEKLY",
      "ORGANIZER:mailto:x@y.io",
      "END:VEVENT",
      "END:VCALENDAR",
    ]))!,
  )!;
  assertEquals(ev.allDayDate, "2026-10-20");
  assertEquals(ev.end?.toISOString(), "2026-10-21T00:00:00.000Z");
  assertEquals(ev.recurring, true);
  const dur = primaryEvent(
    parseCalendar(crlf([
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:d2",
      "DTSTART:20261020T100000Z",
      "DURATION:PT45M",
      "END:VEVENT",
      "END:VCALENDAR",
    ]))!,
  )!;
  assertEquals(dur.end?.toISOString(), "2026-10-20T10:45:00.000Z");
  assertEquals(parseCalendar("hello"), null);
});

// --- The send batch -------------------------------------------------------------

Deno.test("buildCalendarSend: Blob/upload + Email/set + EmailSubmission in one request", () => {
  const { opsJson, vars } = buildCalendarSend({
    to: [{ email: "anna@gmail.com", name: "Anna" }, {
      email: "bob@outlook.com",
    }],
    subject: "Invitation: Demo",
    body: { text: "t", html: "<p>h</p>" },
    ics: "BEGIN:VCALENDAR\r\n",
    uid: "u-1",
  });
  const env = JSON.parse(opsJson);
  assertEquals(env.methodCalls.map((c: unknown[]) => c[0]), [
    "Blob/upload",
    "Email/set",
    "EmailSubmission/set",
  ]);
  assert(env.using.includes("urn:ietf:params:jmap:blob"));
  assertEquals(env.methodCalls[0][1].create.ics.data[0]["data:asText"], "$ICS");
  const create = env.methodCalls[1][1].create.m1;
  assertEquals(create.mailboxIds, { "$SENT_MAILBOX_ID": true });
  assertEquals(create.from, [{ email: "$INBOX" }]);
  assertEquals(create.to, [
    { email: "$TO_0", name: "$TO_NAME_0" },
    { email: "$TO_1" },
  ]);
  assertEquals(create[`header:${CALENDAR_UID_HEADER}:asText`], "$UID");
  const mixed = create.bodyStructure;
  assertEquals(mixed.type, "multipart/mixed");
  const alt = mixed.subParts[0];
  assertEquals(alt.subParts.map((p: { type: string }) => p.type), [
    "text/plain",
    "text/html",
    "text/calendar",
  ]);
  assertEquals(alt.subParts[2], {
    blobId: "#ics",
    type: "text/calendar",
    charset: "utf-8",
  });
  assertEquals(mixed.subParts[1].name, "invite.ics");
  assertEquals(create.keywords, { $draft: true, $seen: true });
  assertEquals(env.methodCalls[2][1].onSuccessUpdateEmail, {
    "#s1": { "keywords/$draft": null, "keywords/$sent": true },
  });
  assertEquals(vars.TO_0, "anna@gmail.com");
  assertEquals(vars.TO_NAME_0, "Anna");
  assertEquals("TO_NAME_1" in vars, false);
  assertEquals("IN_REPLY_TO" in vars, false);
  // User text never sits in the template itself.
  assertEquals(opsJson.includes("anna@gmail.com"), false);
});

Deno.test("buildCalendarSend: a reply threads under the invitation", () => {
  const { opsJson, vars } = buildCalendarSend({
    to: [{ email: "egor@gmail.com" }],
    subject: "Accepted: X",
    body: { text: "t", html: "h" },
    ics: "x",
    uid: "u",
    inReplyTo: "abc@mail.gmail.com",
    fromName: "Agent A",
  });
  const create = JSON.parse(opsJson).methodCalls[1][1].create.m1;
  assertEquals(create["header:In-Reply-To:asMessageIds"], ["$IN_REPLY_TO"]);
  assertEquals(create.from, [{ email: "$INBOX", name: "$FROM_NAME" }]);
  assertEquals(vars.IN_REPLY_TO, "abc@mail.gmail.com");
  assertEquals(vars.FROM_NAME, "Agent A");
});

Deno.test("buildScanOps / buildBlobGetOps: header query on Sent, inbox window, chunked Blob/get", () => {
  const scan = JSON.parse(buildScanOps(50));
  assertEquals(scan.methodCalls[0][1].filter, {
    inMailbox: "$SENT_MAILBOX_ID",
    notKeyword: "$draft", // a refused send's copy is not a version
    header: [CALENDAR_UID_HEADER],
  });
  assertEquals(scan.methodCalls[0][1].limit, 50);
  assertEquals(scan.methodCalls[2][1].filter, {
    inMailbox: "$INBOX_MAILBOX_ID",
  });
  const one = JSON.parse(buildScanOps(10, "u-1"));
  assertEquals(one.methodCalls[0][1].filter.header, [
    CALENDAR_UID_HEADER,
    "$UID",
  ]);

  const ids = Array.from({ length: 150 }, (_, i) => `G${i}`);
  const { opsJson, vars } = buildBlobGetOps(ids);
  const env = JSON.parse(opsJson);
  assertEquals(env.methodCalls.length, 2);
  assertEquals(env.methodCalls[0][1].ids.length, 100);
  assertEquals(env.methodCalls[1][1].ids.length, 50);
  assertEquals(vars.BLOB_149, "G149");
});

Deno.test("findCalendarBlobId: inline text/calendar first, then an .ics file", () => {
  assertEquals(
    findCalendarBlobId({
      type: "multipart/mixed",
      subParts: [
        {
          type: "multipart/alternative",
          subParts: [
            { type: "text/plain", blobId: "T" },
            { type: "text/calendar", blobId: "C" },
          ],
        },
        { type: "application/ics", blobId: "F", name: "invite.ics" },
      ],
    }),
    "C",
  );
  assertEquals(
    findCalendarBlobId({
      type: "multipart/mixed",
      subParts: [
        { type: "text/plain", blobId: "T" },
        { type: "application/octet-stream", blobId: "F", name: "meeting.ics" },
      ],
    }),
    "F",
  );
  assertEquals(
    findCalendarBlobId({ type: "text/plain", blobId: "T" }),
    undefined,
  );
});

Deno.test("parseScanResponse: sent vs inbox, uid header, calendar blob", () => {
  const msgs = parseScanResponse(JSON.stringify({
    methodResponses: [
      ["Email/query", { ids: ["s1"] }, "qs"],
      ["Email/get", {
        list: [{
          id: "s1",
          messageId: ["m1@atomicmail.ai"],
          subject: "Invitation: Demo",
          [`header:${CALENDAR_UID_HEADER}:asText`]: " u-1 ",
          bodyStructure: { type: "text/calendar", blobId: "B1" },
        }],
      }, "gs"],
      ["Email/query", { ids: ["i1"] }, "qi"],
      ["Email/get", {
        list: [{ id: "i1", from: [{ email: "Anna@Gmail.com", name: null }] }],
      }, "gi"],
    ],
  }));
  assertEquals(msgs.length, 2);
  assertEquals(msgs[0].box, "sent");
  assertEquals(msgs[0].uidHeader, "u-1");
  assertEquals(msgs[0].messageId, "m1@atomicmail.ai");
  assertEquals(msgs[0].calendarBlobId, "B1");
  assertEquals(msgs[1].box, "inbox");
  assertEquals(msgs[1].from, [{ email: "Anna@Gmail.com" }]);
});

// --- State -----------------------------------------------------------------------

function sent(id: string, blob: string, sentAt: string): ScannedMessage {
  return { id, box: "sent", calendarBlobId: blob, sentAt };
}
function inbox(
  id: string,
  blob: string,
  from: string,
  receivedAt: string,
): ScannedMessage {
  return {
    id,
    box: "inbox",
    calendarBlobId: blob,
    from: [{ email: from }],
    receivedAt,
  };
}

function replyIcs(
  uid: string,
  who: string,
  partstat: string,
  seq: number,
  stamp: string,
  comment?: string,
) {
  return crlf([
    "BEGIN:VCALENDAR",
    "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
    "METHOD:REPLY",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `SEQUENCE:${seq}`,
    `DTSTAMP:${stamp}`,
    "DTSTART:20261016T120000Z",
    `ORGANIZER:mailto:${ME}`,
    `ATTENDEE;PARTSTAT=${partstat};CN=X:mailto:${who}`,
    ...(comment ? [`COMMENT:${comment}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ]);
}

Deno.test("deriveInviteState: organizer view with answers, counters and re-confirmations", () => {
  const v0 = ourEvent();
  const v1 = ourEvent({
    sequence: 1,
    start: new Date("2026-10-16T13:00:00Z"),
    end: new Date("2026-10-16T13:30:00Z"),
  });
  const counter = crlf([
    "BEGIN:VCALENDAR",
    "METHOD:COUNTER",
    "BEGIN:VEVENT",
    "UID:u-1@atomicmail.ai",
    "SEQUENCE:1",
    "DTSTAMP:20261012T120000Z",
    "DTSTART:20261016T150000Z",
    "DTEND:20261016T153000Z",
    `ORGANIZER:mailto:${ME}`,
    "ATTENDEE;PARTSTAT=TENTATIVE:mailto:bob@outlook.com",
    "COMMENT:Later works better",
    "END:VEVENT",
    "END:VCALENDAR",
  ]);
  const calendars = new Map<string, string>([
    ["B0", buildRequestIcs(v0, new Date("2026-10-12T09:00:00Z"))],
    ["B1", buildRequestIcs(v1, new Date("2026-10-12T11:00:00Z"))],
    [
      "R1",
      replyIcs(
        "u-1@atomicmail.ai",
        "anna@gmail.com",
        "ACCEPTED",
        0,
        "20261012T100000Z",
        "Yes!",
      ),
    ],
    ["R2", counter],
    ["X", "not a calendar"],
  ]);
  const state = deriveInviteState(
    [
      sent("s0", "B0", "2026-10-12T09:00:00Z"),
      sent("s1", "B1", "2026-10-12T11:00:00Z"),
      inbox("i1", "R1", "anna@gmail.com", "2026-10-12T10:00:05Z"),
      inbox("i2", "R2", "bob@outlook.com", "2026-10-12T12:00:05Z"),
      inbox("i3", "X", "z@z.io", "2026-10-12T12:00:05Z"),
      { id: "i4", box: "inbox" },
    ],
    calendars,
    ME,
  );
  assertEquals(state.received, []);
  assertEquals(state.organized.length, 1);
  const o = state.organized[0];
  assertEquals(o.invite_id, "u-1@atomicmail.ai");
  assertEquals(o.version, 1);
  assertEquals(o.status, "scheduled");
  assertEquals(o.start, "2026-10-16T13:00:00.000Z");
  assertEquals(o.last_sent_message_id, "s1");
  const anna = o.attendees.find((a) => a.email === "anna@gmail.com")!;
  assertEquals(anna.response, "accepted");
  assertEquals(anna.comment, "Yes!");
  assertEquals(anna.answered_earlier_version, true);
  const bob = o.attendees.find((a) => a.email === "bob@outlook.com")!;
  assertEquals(bob.response, "proposed_new_time");
  assertEquals(bob.proposed_start, "2026-10-16T15:00:00.000Z");
  assertEquals(bob.comment, "Later works better");
});

Deno.test("deriveInviteState: a same-version CANCEL to removed guests does not cancel; a full CANCEL does", () => {
  const v1 = ourEvent({
    sequence: 1,
    attendees: [{ email: "anna@gmail.com" }],
  });
  const removed = ourEvent({
    sequence: 1,
    attendees: [{ email: "bob@outlook.com" }],
  });
  const calendars = new Map([
    [
      "A",
      buildCancelIcs(
        removed,
        new Date("2026-10-12T11:00:00Z"),
        undefined,
        true,
      ),
    ],
    ["B", buildRequestIcs(v1, new Date("2026-10-12T11:00:01Z"))],
  ]);
  let state = deriveInviteState(
    [
      sent("s1", "A", "2026-10-12T11:00:00Z"),
      sent("s2", "B", "2026-10-12T11:00:01Z"),
    ],
    calendars,
    ME,
  );
  assertEquals(state.organized[0].status, "scheduled");
  assertEquals(state.organized[0].attendees.map((a) => a.email), [
    "anna@gmail.com",
  ]);

  calendars.set(
    "C",
    buildCancelIcs(
      ourEvent({ sequence: 2, attendees: v1.attendees }),
      new Date("2026-10-12T12:00:00Z"),
    ),
  );
  state = deriveInviteState(
    [
      sent("s1", "A", "2026-10-12T11:00:00Z"),
      sent("s2", "B", "2026-10-12T11:00:01Z"),
      sent("s3", "C", "2026-10-12T12:00:00Z"),
    ],
    calendars,
    ME,
  );
  assertEquals(state.organized[0].status, "cancelled");
  assertEquals(state.organized[0].version, 2);
});

Deno.test("deriveInviteState: invitations received, our answer, organizer cancellation", () => {
  const google = primaryEvent(parseCalendar(GOOGLE_REQUEST)!)!;
  const calendars = new Map([
    ["G", GOOGLE_REQUEST],
    ["O", OUTLOOK_REQUEST],
    ["MY", buildReplyIcs(google, { email: ME }, "DECLINED", NOW)],
  ]);
  let state = deriveInviteState(
    [
      inbox("g1", "G", "egor@gmail.com", "2026-10-12T10:15:05Z"),
      inbox("o1", "O", "egor.rybkov@hotmail.com", "2026-10-12T10:20:05Z"),
      sent("r1", "MY", "2026-10-12T10:30:00Z"),
    ],
    calendars,
    ME,
  );
  assertEquals(state.organized, []);
  assertEquals(state.received.map((r) => r.title), [
    "Sync with agent",
    "Q4 review",
  ]);
  const g = state.received[0];
  assertEquals(g.message_id, "g1");
  assertEquals(g.your_response, "declined");
  assertEquals(g.meeting_url, "https://meet.google.com/abc-defg-hij");
  assertEquals(g.time_zone, "Europe/Moscow");
  assertEquals(g.organizer, { email: "egor@gmail.com", name: "Egor Rybkov" });
  assertEquals(g.organizer_matches_sender, true);
  assertEquals(state.received[1].your_response, "no_response");

  const cancel = GOOGLE_REQUEST
    .replace("METHOD:REQUEST", "METHOD:CANCEL")
    .replace("SEQUENCE:0", "SEQUENCE:1")
    .replace("STATUS:CONFIRMED", "STATUS:CANCELLED");
  calendars.set("GC", cancel);
  state = deriveInviteState(
    [
      inbox("g1", "G", "egor@gmail.com", "2026-10-12T10:15:05Z"),
      inbox("g2", "GC", "egor@gmail.com", "2026-10-13T10:15:05Z"),
    ],
    calendars,
    ME,
  );
  assertEquals(state.received[0].status, "cancelled");
  assertEquals(state.received[0].message_id, "g2");
});

// --- The message around the object -----------------------------------------------

Deno.test("formatWhen / messageSubject / composeBody", () => {
  const start = new Date("2026-10-16T12:00:00Z");
  const end = new Date("2026-10-16T12:30:00Z");
  const when = formatWhen(start, end, "Europe/Moscow");
  assertEquals(when, "Fri, Oct 16, 2026 15:00 – 15:30 (Europe/Moscow)");
  assertEquals(
    formatWhen(start, new Date("2026-10-17T09:00:00Z"), "UTC"),
    "Fri, Oct 16, 2026 12:00 – Sat, Oct 17, 2026 09:00 (UTC)",
  );
  assertEquals(formatWhen(start, end, "Not/AZone").endsWith("(UTC)"), true);
  assertEquals(
    messageSubject("invite", "Demo", when),
    `Invitation: Demo @ ${when}`,
  );
  assertEquals(
    messageSubject("reply-declined", "Demo", when).startsWith("Declined: "),
    true,
  );

  const body = composeBody({
    kind: "invite",
    title: "Demo <b>",
    when,
    location: "Room 1",
    organizer: { email: ME, name: "Agent" },
    attendees: [{ email: "anna@gmail.com" }],
  });
  assertStringIncludes(
    body.text,
    'Agent <calagenta@atomicmail.ai> invited you to "Demo <b>".',
  );
  assertStringIncludes(body.text, "Where: Room 1");
  assertStringIncludes(body.html, "Demo &lt;b&gt;");
  assertEquals(body.html.includes("<b>"), false);
});

// --- Meeting links -----------------------------------------------------------------

/** Long, with characters TEXT values escape (, ;) and a query string. */
const LINK = "https://zoom.us/j/81234567890?pwd=a1,b2;c3&uname=Anna&" +
  "x=" + "y".repeat(160);

Deno.test("parseMeetingUrl: one https link, length cap, no spaces/quotes/credentials", () => {
  assertEquals(parseMeetingUrl(`  ${LINK} `), LINK);
  assertEquals(
    parseMeetingUrl("https://meet.google.com/abc-defg-hij"),
    "https://meet.google.com/abc-defg-hij",
  );
  for (
    const [bad, why] of [
      ["http://zoom.us/j/1", "https://"],
      ["zoom.us/j/1", "not a valid link"],
      ["javascript:alert(1)", "https://"],
      ["https://zoom.us/j/1 https://evil.example", "without spaces"],
      ['https://zoom.us/j/1"onmouseover="x', "without spaces or quotes"],
      ["https://zoom.us/j/1\r\nATTENDEE:mailto:x@y.io", "without spaces"],
      ["https://google.com@evil.example/x", "user name or password"],
      ["https://" + "a".repeat(2_000) + ".io", "longer than 2000"],
    ]
  ) {
    assertThrows(() => parseMeetingUrl(bad), Error, why);
  }
});

Deno.test("buildRequestIcs with a meeting link: URL + CONFERENCE, LOCATION fallback, agenda untouched, folded and escaped", () => {
  const ics = buildRequestIcs(
    ourEvent({ location: undefined, meetingUrl: LINK }),
    NOW,
  );
  for (const l of ics.split("\r\n")) {
    assert(new TextEncoder().encode(l).length <= 75, `too long: ${l}`);
  }
  const lines = unfoldLines(ics);
  // URI values are not TEXT: the link goes in as is, only folded.
  assert(lines.includes(`URL:${LINK}`));
  assert(
    lines.includes(`CONFERENCE;VALUE=URI;FEATURE=VIDEO;LABEL=Join:${LINK}`),
  );
  // LOCATION and DESCRIPTION are TEXT: , and ; are escaped there.
  assert(lines.includes(`LOCATION:${escapeText(LINK)}`));
  assertStringIncludes(escapeText(LINK), "\\,");
  assertStringIncludes(escapeText(LINK), "\\;");
  // The link is shown once (LOCATION/URL/CONFERENCE); DESCRIPTION is the agenda.
  assert(
    lines.includes(`DESCRIPTION:${escapeText("Agenda:\n- intro\n- демо")}`),
  );

  // Our own invitation reads back with the same link, agenda and no location.
  const ev = primaryEvent(parseCalendar(ics)!)!;
  assertEquals(ev.meetingUrl, LINK);
  assertEquals(ev.meetingUrlGuessed, undefined);
  assertEquals(ev.location, LINK);
  const back = outgoingFromParsed(ev);
  assertEquals(back.meetingUrl, LINK);
  assertEquals(back.location, undefined);
  assertEquals(back.description, "Agenda:\n- intro\n- демо");
  // Rebuilding from what we read gives the same object.
  assertEquals(buildRequestIcs(back, NOW), ics);

  // An explicit place stays the LOCATION; no agenda means no DESCRIPTION.
  const withRoom = unfoldLines(
    buildRequestIcs(
      ourEvent({
        location: "Room 1",
        description: undefined,
        meetingUrl: LINK,
      }),
      NOW,
    ),
  );
  assert(withRoom.includes("LOCATION:Room 1"));
  assertEquals(withRoom.some((l) => l.startsWith("DESCRIPTION")), false);
  const roomBack = outgoingFromParsed(
    primaryEvent(parseCalendar(withRoom.join("\r\n"))!)!,
  );
  assertEquals(roomBack.location, "Room 1");
  assertEquals(roomBack.description, undefined);
});

Deno.test("outgoingFromParsed: a link only in LOCATION text stays a location, not a meeting_url", () => {
  const ev = primaryEvent(parseCalendar(buildRequestIcs(ourEvent(), NOW))!)!;
  assertEquals(ev.meetingUrl, "https://meet.example.com/x");
  assertEquals(ev.meetingUrlGuessed, true);
  const back = outgoingFromParsed(ev);
  assertEquals(back.meetingUrl, undefined);
  assertEquals(back.location, "https://meet.example.com/x");
  assertEquals(
    unfoldLines(buildRequestIcs(back, NOW)).some((l) => l.startsWith("URL:")),
    false,
  );
});

Deno.test("composeBody: the meeting link is one Join row in text and HTML, escaped", () => {
  const url = "https://meet.example.com/x?a=1&b=2";
  const body = composeBody({
    kind: "invite",
    title: "Demo",
    when: "Fri, Oct 16, 2026 15:00 – 15:30 (UTC)",
    meetingUrl: url,
    description: "Agenda",
    organizer: { email: ME },
  });
  assertStringIncludes(body.text, `\nWhen: `);
  assertStringIncludes(body.text, `\nJoin: ${url}\n`);
  assertEquals(body.text.split(url).length - 1, 1, "the link appears once");
  assertStringIncludes(
    body.html,
    `<a href="https://meet.example.com/x?a=1&amp;b=2"`,
  );
  assertEquals(body.html.includes("Join meeting"), false, "no button");
  assertEquals(body.html.split("meet.example.com").length - 1, 2); // href + text
  // The same link as LOCATION is not repeated as a Where row.
  const sameWhere = composeBody({
    kind: "invite",
    title: "Demo",
    when: "x",
    location: url,
    meetingUrl: url,
    organizer: { email: ME },
  });
  assertEquals(sameWhere.text.includes("Where:"), false);
  assertEquals(body.html.includes("a=1&b=2"), false);
  // Without a link nothing changes.
  const plain = composeBody({
    kind: "cancel",
    title: "Demo",
    when: "x",
    organizer: { email: ME },
  });
  assertEquals(plain.text.includes("Join"), false);
  assertEquals(plain.html.includes("<a "), false);
});

// --- All-day events ------------------------------------------------------------------

Deno.test("all-day input: dates only, end is the last day (exclusive DTEND), today counts", () => {
  const start = parseUserDate("2026-11-10", "start");
  assertEquals(start.toISOString(), "2026-11-10T00:00:00.000Z");
  // Default one day; end names the LAST day, DTEND is the day after it.
  assertEquals(
    resolveAllDayEnd(start).toISOString(),
    "2026-11-11T00:00:00.000Z",
  );
  assertEquals(
    resolveAllDayEnd(start, "2026-11-12").toISOString(),
    "2026-11-13T00:00:00.000Z",
  );
  assertEquals(
    resolveAllDayEnd(start, "2026-11-10").toISOString(),
    "2026-11-11T00:00:00.000Z",
  );
  assertThrows(() => resolveAllDayEnd(start, "2026-11-09"), Error, "before");
  assertThrows(() => resolveAllDayEnd(start, "2026-12-11"), Error, "31 days");
  assertThrows(
    () => parseUserDate("2026-11-10T09:00", "start"),
    Error,
    "must be a date",
  );
  assertThrows(() => parseUserDate("2026-02-30", "end"), Error, "not a valid");
  // A date without all_day points at all_day.
  assertThrows(
    () => parseUserDateTime("2026-11-10", "Europe/Moscow", "start"),
    Error,
    "all_day: true",
  );
  // Today is fine even late in the UTC day; two days back is not.
  const now = new Date("2026-11-10T23:30:00Z");
  checkAllDayStart(parseUserDate("2026-11-10", "start"), now);
  checkAllDayStart(parseUserDate("2026-11-09", "start"), now);
  assertThrows(
    () => checkAllDayStart(parseUserDate("2026-11-08", "start"), now),
    Error,
    "in the past",
  );
  assertThrows(
    () => checkAllDayStart(parseUserDate("2029-01-01", "start"), now),
    Error,
    "two years",
  );
});

Deno.test("buildRequestIcs all-day: VALUE=DATE, exclusive DTEND, TRANSPARENT; round-trips", () => {
  const ics = buildRequestIcs(
    ourEvent({
      allDay: true,
      start: new Date("2026-11-10T00:00:00Z"),
      end: new Date("2026-11-13T00:00:00Z"),
    }),
    NOW,
  );
  const lines = unfoldLines(ics);
  assert(lines.includes("DTSTART;VALUE=DATE:20261110"));
  assert(lines.includes("DTEND;VALUE=DATE:20261113"));
  assert(lines.includes("TRANSP:TRANSPARENT"));
  assertEquals(lines.some((l) => /^DT(START|END):/.test(l)), false);
  assertEquals(lines.includes("TRANSP:OPAQUE"), false);
  // A timed meeting stays OPAQUE.
  assert(
    unfoldLines(buildRequestIcs(ourEvent(), NOW)).includes("TRANSP:OPAQUE"),
  );

  const ev = primaryEvent(parseCalendar(ics)!)!;
  assertEquals(ev.allDayDate, "2026-11-10");
  assertEquals(ev.end?.toISOString(), "2026-11-13T00:00:00.000Z");
  const back = outgoingFromParsed(ev);
  assertEquals(back.allDay, true);
  assertEquals(buildRequestIcs(back, NOW), ics);
  // CANCEL describes the same all-day event.
  assert(
    unfoldLines(buildCancelIcs(back, NOW)).includes(
      "DTSTART;VALUE=DATE:20261110",
    ),
  );
});

Deno.test("formatWhen all-day: one day, a range, the zone is ignored", () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  assertEquals(
    formatWhen(d("2026-11-10"), d("2026-11-11"), "UTC", true),
    "Tue, Nov 10, 2026 (all day)",
  );
  assertEquals(
    formatWhen(d("2026-11-10"), d("2026-11-13"), "America/Los_Angeles", true),
    "Tue, Nov 10, 2026 – Thu, Nov 12, 2026 (all day)",
  );
  assertEquals(
    messageSubject(
      "invite",
      "Offsite",
      formatWhen(
        d("2026-11-10"),
        d("2026-11-11"),
        "UTC",
        true,
      ),
    ),
    "Invitation: Offsite @ Tue, Nov 10, 2026 (all day)",
  );
});

Deno.test("deriveInviteState: organized view shows meeting_url and the all-day dates", () => {
  const allDay = buildRequestIcs(
    ourEvent({
      uid: "ad-1",
      allDay: true,
      location: undefined,
      meetingUrl: LINK,
      start: new Date("2026-11-10T00:00:00Z"),
      end: new Date("2026-11-13T00:00:00Z"),
    }),
    NOW,
  );
  const timed = buildRequestIcs(ourEvent({ uid: "t-1" }), NOW);
  const state = deriveInviteState(
    [
      sent("s1", "b1", "2026-10-12T10:00:00Z"),
      sent("s2", "b2", "2026-10-12T10:01:00Z"),
    ],
    new Map([["b1", allDay], ["b2", timed]]),
    ME,
  );
  const ad = state.organized.find((o) => o.invite_id === "ad-1")!;
  assertEquals(ad.meeting_url, LINK);
  assertEquals(ad.location, LINK);
  assertEquals(ad.all_day, true);
  assertEquals(ad.all_day_date, "2026-11-10");
  assertEquals(ad.all_day_last_date, "2026-11-12");
  assertEquals(ad.end, "2026-11-13T00:00:00.000Z");
  const t = state.organized.find((o) => o.invite_id === "t-1")!;
  assertEquals(t.all_day, undefined);
  assertEquals(t.all_day_date, undefined);
  // A link pasted into location is still reported as the meeting link.
  assertEquals(t.meeting_url, "https://meet.example.com/x");
});

// --- edge cases ------------------------------------------------------------

Deno.test("impossible calendar dates are refused, not rolled into the next month", () => {
  assertThrows(
    () => parseUserDateTime("2027-02-31T10:00", "Europe/Moscow", "start"),
    Error,
    "not a valid date",
  );
  assertThrows(
    () => parseUserDateTime("2027-02-31T10:00:00+03:00", undefined, "start"),
    Error,
    "not a valid date",
  );
  assertThrows(() => parseUserDate("2027-04-31", "start"), Error);
  assertEquals(
    parseUserDateTime("2028-02-29T10:00:00Z", undefined, "start")
      .toISOString(),
    "2028-02-29T10:00:00.000Z",
  );
});

Deno.test("subjects carry no control characters from an invitation's title", () => {
  const s = messageSubject(
    "reply-accepted",
    "Sync\r\nBcc: victim@example.com",
    "Tue",
  );
  assertEquals(/[\r\n]/.test(s), false);
  assertStringIncludes(s, "Sync Bcc: victim@example.com");
});

Deno.test("deriveInviteState: another guest who knows the UID cannot cancel or replace a received invitation", () => {
  const cancel = GOOGLE_REQUEST
    .replace("METHOD:REQUEST", "METHOD:CANCEL")
    .replace("SEQUENCE:0", "SEQUENCE:5")
    .replace("STATUS:CONFIRMED", "STATUS:CANCELLED");
  // Their own ORGANIZER, sent from their own address.
  const ownOrganizer = cancel.replace(
    /ORGANIZER[^\r\n]*/,
    "ORGANIZER:mailto:mallory@example.com",
  );
  const calendars = new Map([
    ["G", GOOGLE_REQUEST],
    ["FORGED", cancel],
    ["OWN", ownOrganizer],
  ]);
  const state = deriveInviteState(
    [
      inbox("g2", "FORGED", "mallory@example.com", "2026-10-13T10:15:05Z"),
      inbox("g3", "OWN", "mallory@example.com", "2026-10-14T10:15:05Z"),
      inbox("g1", "G", "egor@gmail.com", "2026-10-12T10:15:05Z"),
    ],
    calendars,
    ME,
  );
  assertEquals(state.received.length, 1);
  assertEquals(state.received[0].status, "scheduled");
  assertEquals(state.received[0].message_id, "g1");
});
