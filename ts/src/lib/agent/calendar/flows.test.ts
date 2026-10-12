// The calendar flows against an in-memory mailbox that answers the JMAP
// batches the flows send. Same file in both repos (server: mcp-server/test/).

import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  CalendarError,
  type CalendarRunner,
  cancelInvite,
  listInvites,
  respondToInvite,
  sendInvite,
  updateInvite,
} from "./flows.ts";
import { CALENDAR_UID_HEADER } from "./invites.ts";
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
          out.push([name, { created: { s1: { id: "S" } } }, id]);
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
  return { runner, store, deliver };
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
