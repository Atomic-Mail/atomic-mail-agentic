import { assert, assertEquals } from "@std/assert";
import {
  collectTimeZones,
  escapeText,
  foldLine,
  formatUtc,
  getProp,
  mailtoToEmail,
  parseContentLine,
  parseDurationMs,
  parseIcal,
  parseTimeProp,
  tzidToIana,
  unescapeText,
  unfoldLines,
  zonedWallTimeToUtc,
} from "./ical.ts";

const enc = new TextEncoder();

Deno.test("escapeText/unescapeText round-trip commas, semicolons, backslashes, newlines", () => {
  const raw = "Agenda: a, b; c\\d\nline 2";
  const esc = escapeText(raw);
  assertEquals(esc, "Agenda: a\\, b\\; c\\\\d\\nline 2");
  assertEquals(unescapeText(esc), raw);
  assertEquals(unescapeText("x\\Ny"), "x\ny");
});

Deno.test("foldLine: physical lines <= 75 octets, UTF-8 never split, unfold restores", () => {
  const line = "SUMMARY:" + "Встреча по проекту Atomic Mail — ".repeat(6);
  const folded = foldLine(line);
  const physical = folded.split("\r\n").filter((l) => l.length > 0);
  assert(physical.length > 1);
  for (const p of physical) assert(enc.encode(p).length <= 75, p);
  for (const p of physical.slice(1)) assert(p.startsWith(" "));
  // No replacement characters: every chunk is valid UTF-8 on its own.
  for (const p of physical) assertEquals(p.includes("�"), false);
  assertEquals(unfoldLines(folded), [line]);
});

Deno.test("foldLine: 4-byte characters (emoji) are never split across lines", () => {
  const line = "SUMMARY:" + "Встреча 🎉🚀 Atomic ".repeat(10);
  const folded = foldLine(line);
  const physical = folded.split("\r\n").filter((l) => l.length > 0);
  for (const p of physical) {
    assert(enc.encode(p).length <= 75, p);
    // Each physical line survives a UTF-8 round trip on its own.
    assertEquals(new TextDecoder().decode(enc.encode(p)), p);
    assertEquals(/[\uD800-\uDBFF]$|^ ?[\uDC00-\uDFFF]/.test(p), false, p);
  }
  assertEquals(unfoldLines(folded), [line]);
});

Deno.test("tzidToIana ignores Object.prototype names; huge DURATION is not a date", () => {
  assertEquals(tzidToIana("toString"), null);
  assertEquals(tzidToIana("constructor"), null);
  assertEquals(parseDurationMs("P99999999999999999999W"), null);
  assertEquals(parseDurationMs("PT30M"), 30 * 60_000);
});

Deno.test("foldLine: a short line is left alone", () => {
  assertEquals(foldLine("VERSION:2.0"), "VERSION:2.0\r\n");
});

Deno.test("parseContentLine: quoted parameter values may hold : ; ,", () => {
  const p = parseContentLine(
    'ATTENDEE;CN="Doe, John: CEO";PARTSTAT=ACCEPTED;DELEGATED-TO="mailto:a@x.com","mailto:b@x.com":mailto:john@x.com',
  );
  assertEquals(p?.name, "ATTENDEE");
  assertEquals(p?.params.CN, "Doe, John: CEO");
  assertEquals(p?.params.PARTSTAT, "ACCEPTED");
  assertEquals(p?.params["DELEGATED-TO"], "mailto:a@x.com,mailto:b@x.com");
  assertEquals(p?.value, "mailto:john@x.com");
  assertEquals(parseContentLine("no colon here"), null);
});

Deno.test("parseIcal: nested components, folded params, stray lines ignored", () => {
  const text = [
    "junk before",
    "BEGIN:VCALENDAR",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    "UID:u1",
    "ATTENDEE;CUTYPE=INDIVIDUAL;PARTSTAT=NEEDS-ACTION;RSVP=",
    " TRUE;CN=Anna:mailto:anna@x.com",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
    "trailing",
  ].join("\r\n");
  const cal = parseIcal(text)!;
  assertEquals(cal.name, "VCALENDAR");
  assertEquals(getProp(cal, "METHOD")?.value, "REQUEST");
  const ev = cal.components[0];
  assertEquals(ev.name, "VEVENT");
  assertEquals(getProp(ev, "ATTENDEE")?.params.RSVP, "TRUE");
  assertEquals(ev.components[0].name, "VALARM");
  assertEquals(parseIcal("not a calendar"), null);
});

Deno.test("formatUtc", () => {
  assertEquals(formatUtc(new Date("2026-10-16T12:05:09Z")), "20261016T120509Z");
});

Deno.test("zonedWallTimeToUtc: summer and winter offsets, DST gap moves forward", () => {
  const w = (y: number, mo: number, d: number, h: number, mi = 0) => ({
    y,
    mo,
    d,
    h,
    mi,
    s: 0,
  });
  assertEquals(
    zonedWallTimeToUtc(w(2026, 7, 15, 10), "Europe/Berlin").toISOString(),
    "2026-07-15T08:00:00.000Z",
  );
  assertEquals(
    zonedWallTimeToUtc(w(2026, 12, 15, 10), "Europe/Berlin").toISOString(),
    "2026-12-15T09:00:00.000Z",
  );
  assertEquals(
    zonedWallTimeToUtc(w(2026, 10, 16, 15), "Europe/Moscow").toISOString(),
    "2026-10-16T12:00:00.000Z",
  );
  // 2026-03-08 02:30 does not exist in New York (clocks jump 02:00 -> 03:00).
  const gap = zonedWallTimeToUtc(w(2026, 3, 8, 2, 30), "America/New_York");
  assertEquals(gap.toISOString(), "2026-03-08T07:30:00.000Z");
  // 2026-10-25 02:30 happens twice in Berlin: the first one (CEST) wins.
  const overlap = zonedWallTimeToUtc(w(2026, 10, 25, 2, 30), "Europe/Berlin");
  assertEquals(overlap.toISOString(), "2026-10-25T00:30:00.000Z");
});

Deno.test("tzidToIana: IANA, Windows names, mozilla-style prefixes, unknown", () => {
  assertEquals(tzidToIana("Europe/Moscow"), "Europe/Moscow");
  assertEquals(tzidToIana("Russian Standard Time"), "Europe/Moscow");
  assertEquals(tzidToIana("W. Europe Standard Time"), "Europe/Berlin");
  assertEquals(
    tzidToIana("/mozilla.org/20050126_1/Europe/Berlin"),
    "Europe/Berlin",
  );
  assertEquals(tzidToIana("Custom Berlin"), null);
});

const CUSTOM_TZ = [
  "BEGIN:VCALENDAR",
  "BEGIN:VTIMEZONE",
  "TZID:Custom Berlin",
  "BEGIN:STANDARD",
  "DTSTART:16011028T030000",
  "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:16010325T020000",
  "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
  "END:VCALENDAR",
].join("\r\n");

Deno.test("parseTimeProp: UTC, IANA TZID, Windows TZID, VTIMEZONE rules, all-day, floating", () => {
  const tzs = collectTimeZones(parseIcal(CUSTOM_TZ)!);
  const t = (line: string) => parseTimeProp(parseContentLine(line)!, tzs);

  assertEquals(
    t("DTSTART:20261016T120000Z").instant?.toISOString(),
    "2026-10-16T12:00:00.000Z",
  );

  const moscow = t("DTSTART;TZID=Europe/Moscow:20261020T150000");
  assertEquals(moscow.instant?.toISOString(), "2026-10-20T12:00:00.000Z");
  assertEquals(moscow.timeZone, "Europe/Moscow");

  assertEquals(
    t("DTSTART;TZID=Russian Standard Time:20261021T110000").instant
      ?.toISOString(),
    "2026-10-21T08:00:00.000Z",
  );

  // Not a known name: the VTIMEZONE's yearly rules decide.
  assertEquals(
    t("DTSTART;TZID=Custom Berlin:20260715T100000").instant?.toISOString(),
    "2026-07-15T08:00:00.000Z",
  );
  assertEquals(
    t("DTSTART;TZID=Custom Berlin:20261215T100000").instant?.toISOString(),
    "2026-12-15T09:00:00.000Z",
  );
  // Last Sunday of October 2026 is the 25th: before 03:00 summer time holds.
  assertEquals(
    t("DTSTART;TZID=Custom Berlin:20261025T010000").instant?.toISOString(),
    "2026-10-24T23:00:00.000Z",
  );

  const allDay = t("DTSTART;VALUE=DATE:20261020");
  assertEquals(allDay.date, "2026-10-20");

  const floating = t("DTSTART:20261020T150000");
  assertEquals(floating.assumedUtc, true);

  const unknown = t("DTSTART;TZID=Nowhere/Zone:20261020T150000");
  assertEquals(unknown.assumedUtc, true);
});

Deno.test("parseDurationMs", () => {
  assertEquals(parseDurationMs("PT30M"), 30 * 60_000);
  assertEquals(parseDurationMs("P1DT2H"), 26 * 3600_000);
  assertEquals(parseDurationMs("P1W"), 7 * 24 * 3600_000);
  assertEquals(parseDurationMs("-PT15M"), -15 * 60_000);
  assertEquals(parseDurationMs("P"), null);
  assertEquals(parseDurationMs("PT"), null);
  assertEquals(parseDurationMs("30 minutes"), null);
});

Deno.test("mailtoToEmail", () => {
  assertEquals(mailtoToEmail("mailto:Anna@Example.com"), "anna@example.com");
  assertEquals(mailtoToEmail("MAILTO:bob@x.org"), "bob@x.org");
  assertEquals(mailtoToEmail("anna@example.com"), "anna@example.com");
  assertEquals(mailtoToEmail("urn:uuid:123"), null);
});
