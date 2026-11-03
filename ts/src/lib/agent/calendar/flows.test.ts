// The calendar flows against an in-memory mailbox that answers the JMAP
// batches the flows send. The hosted MCP server carries the same tests.

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import {
  CalendarError,
  type CalendarRunner,
  cancelInvite,
  listInvites,
  respondToInvite,
  sendInvite,
  updateInvite,
} from "./flows.ts";
import { buildRequestIcs, CALENDAR_UID_HEADER } from "./invites.ts";
import { unfoldLines } from "./ical.ts";

const ME = "calagenta@atomicmail.ai";
const Y = new Date().getUTCFullYear() + 1;

interface Stored {
  id: string;
  box: "sent" | "inbox";
  uid?: string;
  ics: string;
  to: string[];
  from: string;
  at: string;
  messageId: string;
  inReplyTo?: string;
}

/** A tiny JMAP mailbox: enough of Email/query|get, Blob/upload|get, EmailSubmission. */
function fakeMailbox(self = ME) {
  const store: Stored[] = [];
  /** Make the next EmailSubmission/set fail like the mail server does on a refusal. */
  const state = { failSubmission: false };
  let n = 0;
  const tick = () => new Date(Date.UTC(Y - 1, 9, 12, 10, 0, n++)).toISOString();
  const sub = (v: unknown, vars: Record<string, string>) =>
    typeof v === "string"
      ? v.replace(/\$([A-Z][A-Z0-9_]*)/g, (m, k) => vars[k] ?? m)
      : v;
  const toJmap = (m: Stored) => ({
    id: m.id,
    messageId: [m.messageId],
    subject: "s",
    from: [{ email: m.from }],
    sentAt: m.at,
    receivedAt: m.at,
    [`header:${CALENDAR_UID_HEADER}:asText`]: m.uid ?? null,
    bodyStructure: { type: "text/calendar", blobId: `B-${m.id}` },
  });

  const runner: CalendarRunner = {
    self,
    run(opsJson, vars = {}) {
      const env = JSON.parse(opsJson) as {
        methodCalls: [string, Record<string, unknown>, string][];
      };
      const out: unknown[] = [];
      let lastQuery: Stored[] = [];
      let uploaded = "";
      for (const [name, args, id] of env.methodCalls) {
        if (name === "Email/query") {
          const f = args.filter as { inMailbox: string; header?: string[] };
          const box = f.inMailbox === "$SENT_MAILBOX_ID" ? "sent" : "inbox";
          const want = f.header?.[1] ? sub(f.header[1], vars) : undefined;
          lastQuery = store
            .filter((m) => m.box === box)
            .filter((m) => !f.header || (m.uid && (!want || m.uid === want)))
            .reverse()
            .slice(0, Number(args.limit ?? 100));
          out.push([name, { ids: lastQuery.map((m) => m.id) }, id]);
        } else if (name === "Email/get") {
          const ids = args.ids as string[] | undefined;
          const list = ids
            ? store.filter((m) => m.id === sub(ids[0], vars))
            : lastQuery;
          out.push([name, { list: list.map(toJmap) }, id]);
        } else if (name === "Blob/get") {
          const list = (args.ids as string[]).map((raw) => {
            const blob = String(sub(raw, vars));
            const m = store.find((s) => `B-${s.id}` === blob);
            return { id: blob, "data:asText": m?.ics };
          });
          out.push([name, { list }, id]);
        } else if (name === "Blob/upload") {
          const create = args.create as {
            ics: { data: { "data:asText": string }[] };
          };
          uploaded = String(sub(create.ics.data[0]["data:asText"], vars));
          out.push([name, { created: { ics: { blobId: "Bnew" } } }, id]);
        } else if (name === "Email/set") {
          const c = (args.create as { m1: Record<string, unknown> }).m1;
          const msg: Stored = {
            id: `M${store.length}`,
            box: "sent",
            uid: String(sub(c[`header:${CALENDAR_UID_HEADER}:asText`], vars)),
            ics: uploaded,
            to: (c.to as { email: string }[]).map((t) =>
              String(sub(t.email, vars))
            ),
            from: self,
            at: tick(),
            messageId: `m${store.length}@atomicmail.ai`,
            inReplyTo: c["header:In-Reply-To:asMessageIds"]
              ? String(
                sub(
                  (c["header:In-Reply-To:asMessageIds"] as string[])[0],
                  vars,
                ),
              )
              : undefined,
          };
          store.push(msg);
          out.push([name, { created: { m1: { id: msg.id } } }, id]);
        } else if (name === "EmailSubmission/set") {
          out.push(
            state.failSubmission
              ? [name, {
                notCreated: {
                  s1: { type: "forbiddenToSend", description: "refused" },
                },
              }, id]
              : [name, { created: { s1: { id: "S" } } }, id],
          );
        }
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        bodyText: JSON.stringify({ methodResponses: out }),
      });
    },
  };

  /** Deliver a message from outside into the inbox. */
  const deliver = (from: string, ics: string) => {
    const msg: Stored = {
      id: `M${store.length}`,
      box: "inbox",
      ics,
      to: [self],
      from,
      at: tick(),
      messageId: `in${store.length}@example.com`,
    };
    store.push(msg);
    return msg.id;
  };
  return { runner, store, deliver, state };
}

const sentIcs = (m: { store: Stored[] }, i = -1) =>
  unfoldLines(m.store.filter((s) => s.box === "sent").at(i)!.ics);

/** What a guest's calendar sends back. */
function replyFrom(guest: string, uid: string, partstat: string, seq: number) {
  return [
    "BEGIN:VCALENDAR",
    "METHOD:REPLY",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `SEQUENCE:${seq}`,
    `DTSTAMP:${Y - 1}1012T120000Z`,
    `ORGANIZER:mailto:${ME}`,
    `ATTENDEE;PARTSTAT=${partstat}:mailto:${guest}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

Deno.test("flow: send → guest accepts → update (one guest dropped) → cancel", async () => {
  const box = fakeMailbox();
  const sent = await sendInvite(box.runner, {
    title: "Demo",
    start: `${Y}-03-10T15:00`,
    timeZone: "Europe/Moscow",
    attendees: "anna@gmail.com, bob@outlook.com",
  });
  assertEquals(sent.status, "sent");
  assertEquals(sent.start, `${Y}-03-10T12:00:00.000Z`);
  assertEquals(sent.end, `${Y}-03-10T12:30:00.000Z`);
  assertEquals(box.store[0].to, ["anna@gmail.com", "bob@outlook.com"]);

  box.deliver(
    "anna@gmail.com",
    replyFrom("anna@gmail.com", sent.invite_id, "ACCEPTED", 0),
  );
  let list = await listInvites(box.runner, {});
  assertEquals(
    list.organized[0].attendees.map((a) => [a.email, a.response]),
    [["anna@gmail.com", "accepted"], ["bob@outlook.com", "no_response"]],
  );

  const upd = await updateInvite(box.runner, {
    inviteId: sent.invite_id,
    start: `${Y}-03-10T17:00:00+03:00`,
    attendees: ["anna@gmail.com"],
  });
  assertEquals(upd.version, 1);
  assertEquals(upd.end, `${Y}-03-10T14:30:00.000Z`);
  assertEquals(upd.removed_attendees, ["bob@outlook.com"]);
  // Bob got a partial CANCEL, Anna the new REQUEST.
  const cancelToBob = box.store.find((s) =>
    s.box === "sent" && s.to[0] === "bob@outlook.com" &&
    s.ics.includes("METHOD:CANCEL")
  )!;
  assert(!unfoldLines(cancelToBob.ics).some((l) => l.startsWith("STATUS:")));
  assert(sentIcs(box).includes("SEQUENCE:1"));

  list = await listInvites(box.runner, {});
  const o = list.organized[0];
  assertEquals(o.status, "scheduled");
  assertEquals(o.version, 1);
  assertEquals(o.attendees.map((a) => a.email), ["anna@gmail.com"]);
  assertEquals(o.attendees[0].answered_earlier_version, true);

  await cancelInvite(box.runner, { inviteId: sent.invite_id, note: "Sorry" });
  assert(sentIcs(box).includes("STATUS:CANCELLED"));
  assert(sentIcs(box).includes("SEQUENCE:2"));
  list = await listInvites(box.runner, { inviteId: sent.invite_id });
  assertEquals(list.organized[0].status, "cancelled");

  await assertRejects(
    () => cancelInvite(box.runner, { inviteId: sent.invite_id }),
    CalendarError,
    "already cancelled",
  );
  await assertRejects(
    () => updateInvite(box.runner, { inviteId: sent.invite_id, title: "x" }),
    CalendarError,
    "cancelled",
  );
});

Deno.test("flow: agent B answers agent A's invitation; A sees the answer", async () => {
  const a = fakeMailbox("calagenta@atomicmail.ai");
  const b = fakeMailbox("calagentb@atomicmail.ai");
  const sent = await sendInvite(a.runner, {
    title: "Agents sync",
    start: `${Y}-05-01T09:00:00Z`,
    durationMinutes: 15,
    attendees: ["calagentb@atomicmail.ai"],
  });
  const invitationId = b.deliver("calagenta@atomicmail.ai", a.store[0].ics);

  let bList = await listInvites(b.runner, {});
  assertEquals(bList.received.length, 1);
  assertEquals(bList.received[0].your_response, "no_response");
  assertEquals(bList.received[0].organizer_matches_sender, true);

  const r = await respondToInvite(b.runner, {
    messageId: invitationId,
    response: "declined",
    note: "Busy then",
  });
  assertEquals(r.organizer, "calagenta@atomicmail.ai");
  const reply = b.store.at(-1)!;
  assertEquals(reply.to, ["calagenta@atomicmail.ai"]);
  assertEquals(reply.inReplyTo, `in0@example.com`);
  bList = await listInvites(b.runner, {});
  assertEquals(bList.received[0].your_response, "declined");

  a.deliver("calagentb@atomicmail.ai", reply.ics);
  const aList = await listInvites(a.runner, { inviteId: sent.invite_id });
  assertEquals(aList.organized[0].attendees[0].response, "declined");
  assertEquals(aList.organized[0].attendees[0].comment, "Busy then");
});

Deno.test("flow: refusals carry a clear message and send nothing", async () => {
  const box = fakeMailbox();
  await assertRejects(
    () =>
      sendInvite(box.runner, {
        title: "X",
        start: `${Y}-01-10T15:00`,
        attendees: "anna@gmail.com",
      }),
    CalendarError,
    "time_zone",
  );
  await assertRejects(
    () =>
      sendInvite(box.runner, {
        title: "X",
        start: `${Y}-01-10T15:00:00Z`,
        attendees: ME,
      }),
    CalendarError,
    "other than this inbox",
  );
  await assertRejects(
    () => updateInvite(box.runner, { inviteId: "nope", title: "Y" }),
    CalendarError,
    "no invitation",
  );
  const own = await sendInvite(box.runner, {
    title: "Mine",
    start: `${Y}-01-10T15:00:00Z`,
    attendees: "anna@gmail.com",
  });
  // Answering your own invitation, or a message that is not one, is refused.
  const ownCopy = box.deliver(
    ME,
    box.store.find((s) => s.uid === own.invite_id)!.ics,
  );
  await assertRejects(
    () =>
      respondToInvite(box.runner, { messageId: ownCopy, response: "accepted" }),
    CalendarError,
    "you organize",
  );
  const junk = box.deliver("x@y.io", "not a calendar");
  await assertRejects(
    () =>
      respondToInvite(box.runner, { messageId: junk, response: "accepted" }),
    CalendarError,
    "could not be read",
  );
  assertEquals(box.store.filter((s) => s.box === "sent").length, 1);
});

Deno.test("flow: meeting link + all-day round-trip; timed <-> all-day bumps SEQUENCE", async () => {
  const LINK = "https://meet.google.com/abc-defg-hij";
  const a = fakeMailbox("calagenta@atomicmail.ai");
  const b = fakeMailbox("calagentb@atomicmail.ai");
  const sent = await sendInvite(a.runner, {
    title: "Offsite",
    start: `${Y}-06-01`,
    end: `${Y}-06-03`,
    allDay: true,
    meetingUrl: LINK,
    description: "Bring laptops",
    attendees: "calagentb@atomicmail.ai",
  });
  const id = sent.invite_id;
  assertEquals(sent.all_day, true);
  assertEquals(sent.meeting_url, LINK);
  assertEquals(sent.start, `${Y}-06-01T00:00:00.000Z`);
  assertEquals(sent.end, `${Y}-06-04T00:00:00.000Z`);
  assertStringIncludes(sent.when, "(all day)");
  let ics = sentIcs(a);
  assert(ics.includes(`DTSTART;VALUE=DATE:${Y}0601`));
  assert(ics.includes(`DTEND;VALUE=DATE:${Y}0604`));
  assert(ics.includes("TRANSP:TRANSPARENT"));
  assert(ics.includes(`URL:${LINK}`));
  assert(ics.includes(`LOCATION:${LINK}`));

  const o = (await listInvites(a.runner, {})).organized[0];
  assertEquals(
    [o.meeting_url, o.all_day, o.all_day_date, o.all_day_last_date],
    [LINK, true, `${Y}-06-01`, `${Y}-06-03`],
  );
  // The guest's side parses our link and dates like any other invitation.
  b.deliver("calagenta@atomicmail.ai", a.store[0].ics);
  const r = (await listInvites(b.runner, {})).received[0];
  assertEquals(
    [r.meeting_url, r.all_day, r.all_day_date, r.all_day_last_date],
    [LINK, true, `${Y}-06-01`, `${Y}-06-03`],
  );

  // A new link replaces the old one everywhere; the agenda stays the agenda.
  const LINK2 = "https://zoom.us/j/123?pwd=x";
  let upd = await updateInvite(a.runner, { inviteId: id, meetingUrl: LINK2 });
  assertEquals([upd.version, upd.all_day, upd.meeting_url], [1, true, LINK2]);
  ics = sentIcs(a);
  assert(ics.includes(`URL:${LINK2}`));
  assert(ics.includes(`LOCATION:${LINK2}`));
  assert(ics.includes("DESCRIPTION:Bring laptops"));
  assertEquals(ics.some((l) => l.includes(LINK)), false);

  // all-day -> timed: a DTSTART change, so SEQUENCE+1; 30 minutes by default.
  upd = await updateInvite(a.runner, {
    inviteId: id,
    allDay: false,
    start: `${Y}-06-01T10:00:00Z`,
  });
  assertEquals([upd.version, upd.all_day], [2, undefined]);
  assertEquals(upd.end, `${Y}-06-01T10:30:00.000Z`);
  ics = sentIcs(a);
  assert(ics.includes("SEQUENCE:2"));
  assert(ics.includes(`DTSTART:${Y}0601T100000Z`));
  assert(ics.includes("TRANSP:OPAQUE"));

  // timed -> all-day.
  upd = await updateInvite(a.runner, {
    inviteId: id,
    allDay: true,
    start: `${Y}-06-05`,
  });
  assertEquals([upd.version, upd.all_day], [3, true]);
  assertEquals(upd.end, `${Y}-06-06T00:00:00.000Z`);
  ics = sentIcs(a);
  assert(ics.includes("SEQUENCE:3"));
  assert(ics.includes(`DTSTART;VALUE=DATE:${Y}0605`));
  assert(ics.includes(`DTEND;VALUE=DATE:${Y}0606`));

  // end is the last day; moving an all-day event keeps its length in days.
  upd = await updateInvite(a.runner, { inviteId: id, end: `${Y}-06-06` });
  assertEquals(upd.end, `${Y}-06-07T00:00:00.000Z`);
  upd = await updateInvite(a.runner, { inviteId: id, start: `${Y}-06-10` });
  assertEquals(upd.end, `${Y}-06-12T00:00:00.000Z`);
  assertEquals(upd.version, 5);

  // "" clears the link: no URL, CONFERENCE, LOCATION or Join line is left.
  upd = await updateInvite(a.runner, { inviteId: id, meetingUrl: "" });
  assertEquals(upd.meeting_url, undefined);
  ics = sentIcs(a);
  assertEquals(
    ics.some((l) => /^(URL|CONFERENCE|LOCATION)[:;]/.test(l)),
    false,
  );
  assert(ics.includes("DESCRIPTION:Bring laptops"));
  const last = (await listInvites(a.runner, { inviteId: id })).organized[0];
  assertEquals([last.version, last.meeting_url], [6, undefined]);
  assertEquals([last.all_day_date, last.all_day_last_date], [
    `${Y}-06-10`,
    `${Y}-06-11`,
  ]);
});

Deno.test("flow: all-day and meeting-link refusals are clear and send nothing", async () => {
  const box = fakeMailbox();
  const base = { title: "X", attendees: "anna@gmail.com" };
  const refused = async (
    p: Promise<unknown>,
    msg: string,
  ) => await assertRejects(() => p, CalendarError, msg);

  await refused(
    sendInvite(box.runner, {
      ...base,
      start: `${Y}-06-01`,
      allDay: true,
      timeZone: "Europe/Moscow",
    }),
    "time_zone does not apply",
  );
  await refused(
    sendInvite(box.runner, {
      ...base,
      start: `${Y}-06-01`,
      allDay: true,
      durationMinutes: 60,
    }),
    "duration_minutes does not apply",
  );
  await refused(
    sendInvite(box.runner, {
      ...base,
      start: `${Y}-06-01T10:00:00Z`,
      allDay: true,
    }),
    "must be a date",
  );
  await refused(
    sendInvite(box.runner, { ...base, start: `${Y}-06-01` }),
    "all_day: true",
  );
  await refused(
    sendInvite(box.runner, {
      ...base,
      start: `${Y}-06-01T10:00:00Z`,
      meetingUrl: "http://zoom.us/j/1",
    }),
    "https://",
  );

  const timed = await sendInvite(box.runner, {
    ...base,
    start: `${Y}-06-01T10:00:00Z`,
  });
  await refused(
    updateInvite(box.runner, { inviteId: timed.invite_id, allDay: true }),
    "pass start as a date",
  );
  await refused(
    updateInvite(box.runner, {
      inviteId: timed.invite_id,
      allDay: true,
      start: `${Y}-06-02`,
      timeZone: "Europe/Moscow",
    }),
    "time_zone does not apply",
  );
  const allDay = await sendInvite(box.runner, {
    ...base,
    start: `${Y}-06-01`,
    allDay: true,
  });
  await refused(
    updateInvite(box.runner, { inviteId: allDay.invite_id, allDay: false }),
    "pass start",
  );
  await refused(
    updateInvite(box.runner, {
      inviteId: allDay.invite_id,
      durationMinutes: 60,
    }),
    "duration_minutes does not apply",
  );
  await refused(
    updateInvite(box.runner, {
      inviteId: allDay.invite_id,
      start: `${Y}-06-02T10:00:00Z`,
    }),
    "must be a date",
  );
  await refused(
    updateInvite(box.runner, {
      inviteId: allDay.invite_id,
      meetingUrl: "https://zoom.us/j/1 x",
    }),
    "without spaces",
  );
  assertEquals(box.store.filter((s) => s.box === "sent").length, 2);
});

// --- edge cases ------------------------------------------------------------

Deno.test("flow: a refused submission is reported, not shown as sent", async () => {
  const { runner, state } = fakeMailbox();
  state.failSubmission = true;
  await assertRejects(
    () =>
      sendInvite(runner, {
        title: "Sync",
        start: `${Y}-03-10T15:00:00+03:00`,
        attendees: ["anna@example.com"],
      }),
    Error,
  );
});

Deno.test("flow: respond_to_invite refuses invites that don't list us or whose organizer didn't send them", async () => {
  const { runner, deliver } = fakeMailbox();
  const req = (organizer: string, attendees: string[]) =>
    buildRequestIcs({
      uid: crypto.randomUUID(),
      sequence: 0,
      title: "Planning",
      start: new Date(Date.UTC(Y, 2, 10, 12)),
      end: new Date(Date.UTC(Y, 2, 10, 13)),
      organizer: { email: organizer },
      attendees: attendees.map((email) => ({
        email,
        partstat: "NEEDS-ACTION" as const,
      })),
    });
  const notListed = deliver(
    "boss@example.com",
    req("boss@example.com", ["anna@example.com"]),
  );
  await assertRejects(
    () =>
      respondToInvite(runner, { messageId: notListed, response: "accepted" }),
    Error,
    "does not list this inbox",
  );
  const forged = deliver(
    "stranger@evil.example",
    req("victim@example.com", [ME]),
  );
  await assertRejects(
    () => respondToInvite(runner, { messageId: forged, response: "accepted" }),
    Error,
    "not answering",
  );
});

Deno.test("flow: a REPLY from a stranger's domain does not change a guest's answer", async () => {
  const { runner, store, deliver } = fakeMailbox();
  const sent = await sendInvite(runner, {
    title: "Sync",
    start: `${Y}-03-10T15:00:00+03:00`,
    attendees: ["anna@example.com"],
  });
  const ours = store.find((m) => m.uid === sent.invite_id)!;
  const reply = (ours.ics ?? "")
    .replace("METHOD:REQUEST", "METHOD:REPLY")
    .replace(/PARTSTAT=NEEDS-ACTION/g, "PARTSTAT=ACCEPTED");
  deliver("mallory@evil.example", reply);
  const list = await listInvites(runner, {});
  const anna = list.organized[0].attendees.find((a) =>
    a.email === "anna@example.com"
  );
  assertEquals(anna?.response, "no_response");
});

Deno.test("flow: update and cancel keep showing the organizer's time zone", async () => {
  const { runner, store } = fakeMailbox();
  const sent = await sendInvite(runner, {
    title: "Demo",
    start: `${Y}-03-10T15:00`,
    timeZone: "Europe/Moscow",
    attendees: ["anna@example.com"],
  });
  assertStringIncludes(sent.when, "15:00 – 15:30 (Europe/Moscow)");
  assertStringIncludes(
    store.at(-1)!.ics ?? "",
    "X-ATOMIC-TIMEZONE:Europe/Moscow",
  );
  const upd = await updateInvite(runner, {
    inviteId: sent.invite_id,
    description: "New agenda",
  });
  assertStringIncludes(upd.when, "15:00 – 15:30 (Europe/Moscow)");
  const moved = await updateInvite(runner, {
    inviteId: sent.invite_id,
    start: `${Y}-03-10T16:00:00+03:00`,
  });
  assertStringIncludes(moved.when, "16:00 – 16:30 (+03:00)");
  const cancelled = await cancelInvite(runner, { inviteId: sent.invite_id });
  assertStringIncludes(cancelled.when, "(+03:00)");
});

Deno.test("flow: an unknown time_zone on update is refused, not shown as UTC", async () => {
  const { runner, store } = fakeMailbox();
  const sent = await sendInvite(runner, {
    title: "Demo",
    start: `${Y}-03-10T15:00`,
    timeZone: "Europe/Moscow",
    attendees: ["anna@example.com"],
  });
  const before = store.length;
  for (const tz of ["Europe/NoSuchZone", ""]) {
    await assertRejects(
      () => updateInvite(runner, { inviteId: sent.invite_id, timeZone: tz }),
      Error,
      "Unknown time_zone",
    );
  }
  assertEquals(store.length, before);
});

Deno.test("flow: time_zone UTC on update clears the remembered zone", async () => {
  const { runner, store } = fakeMailbox();
  const sent = await sendInvite(runner, {
    title: "Demo",
    start: `${Y}-03-10T15:00`,
    timeZone: "Europe/Moscow",
    attendees: ["anna@example.com"],
  });
  const upd = await updateInvite(runner, {
    inviteId: sent.invite_id,
    timeZone: "UTC",
    description: "x",
  });
  assertStringIncludes(upd.when, "12:00 – 12:30 (UTC)");
  assertEquals(
    (store.at(-1)!.ics ?? "").includes("X-ATOMIC-TIMEZONE"),
    false,
  );
});
