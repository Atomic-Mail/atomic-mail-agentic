"""Calendar invitations: iCalendar building/parsing, time rules and the JMAP round trips (no network)."""

from __future__ import annotations

import base64
import importlib.util
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

if "atomicmail_plugin" not in sys.modules:  # normally done by conftest
    _dir = Path(__file__).resolve().parent.parent
    _spec = importlib.util.spec_from_file_location("atomicmail_plugin", _dir / "__init__.py",
                                                   submodule_search_locations=[str(_dir)])
    _mod = importlib.util.module_from_spec(_spec)
    sys.modules["atomicmail_plugin"] = _mod
    _spec.loader.exec_module(_mod)

from atomicmail_plugin import calendar_invites as cal  # noqa: E402

UTC = timezone.utc
ME = "agent@atomicmail.ai"


def future(days: int = 10, hour: int = 15) -> datetime:
    base = datetime.now(UTC) + timedelta(days=days)
    return base.replace(hour=hour, minute=0, second=0, microsecond=0)


def lines(ics: str) -> list[str]:
    return cal.unfold_lines(ics)


def event(**overrides) -> cal.Event:
    start = future()
    values = dict(uid="uid-1", sequence=0, title="Q4 plan; budget, risks", start=start,
                  end=start + timedelta(minutes=30), organizer={"email": ME},
                  attendees=[{"email": "bob@example.com", "name": "Bob B"}, {"email": "ann@example.com"}])
    values.update(overrides)
    return cal.Event(**values)


class FakeClient:
    """Answers the JMAP calls the calendar module makes, from an in-memory mailbox."""

    address, account_id = ME, "acc1"

    def __init__(self, emails=None, blobs=None):
        self.emails, self.blobs, self.calls, self.sent = list(emails or []), dict(blobs or {}), [], []

    def mailbox_id(self, role):
        return {"sent": "mb-sent", "inbox": "mb-inbox"}[role]

    def call(self, method_calls, using=(cal.CORE, cal.MAIL)):
        self.calls.append((method_calls, tuple(using)))
        out, queried, pending_ics = [], {}, None
        for name, args, tag in method_calls:
            if name == "Blob/upload":
                pending_ics = args["create"]["ics"]["data"][0]["data:asText"]
                out.append([name, {"created": {"ics": {"id": "up1"}}}, tag])
            elif name == "Email/set":
                self.sent.append({"create": args["create"]["m1"], "ics": pending_ics})
                out.append([name, {"created": {"m1": {"id": f"sent-{len(self.sent)}"}}}, tag])
            elif name == "EmailSubmission/set":
                out.append([name, {"created": {"s1": {"id": "sub1"}}}, tag])
            elif name == "Email/query":
                flt = args["filter"]
                box = "sent" if flt.get("inMailbox") == "mb-sent" else "inbox"
                rows = [e for e in self.emails if e["box"] == box]
                if len(flt.get("header") or []) == 2:
                    rows = [e for e in rows if e.get(cal.UID_PROP) == flt["header"][1]]
                queried[tag] = [e["id"] for e in rows][: args.get("limit", 50)]
                out.append([name, {"ids": queried[tag]}, tag])
            elif name == "Email/get":
                ids = args.get("ids") or queried.get(args.get("#ids", {}).get("resultOf"), [])
                out.append([name, {"list": [{k: v for k, v in e.items() if k != "box"}
                                            for e in self.emails if e["id"] in ids]}, tag])
            elif name == "Blob/get":
                out.append([name, {"list": [{"id": i, "data:asText": self.blobs[i]}
                                            for i in args["ids"] if i in self.blobs]}, tag])
        return out


def mail(msg_id, box, sender, ics, *, uid=None, received="2026-11-10T10:00:00Z"):
    blob = f"blob-{msg_id}"
    return ({"id": msg_id, "box": box, "messageId": [f"<{msg_id}@x>"], "subject": "s",
             "from": [{"email": sender}], "receivedAt": received, "sentAt": received, cal.UID_PROP: uid,
             "bodyStructure": {"type": "multipart/mixed", "subParts": [
                 {"type": "multipart/alternative", "subParts": [
                     {"type": "text/plain", "partId": "1"}, {"type": "text/calendar", "blobId": blob}]}]}},
            blob, ics)


def fake_with(*mails) -> FakeClient:
    return FakeClient([m[0] for m in mails], {m[1]: m[2] for m in mails})


# --------------------------------------------------------------------------- text

def test_fold_escape_round_trip():
    title = "Встреча по бюджету; итоги, планы\nи риски " * 4
    prop = cal.format_property("SUMMARY", {"CN": "Bob: Smith"}, cal.escape_text(title))
    physical = prop.split("\r\n")[:-1]
    assert all(len(p.encode()) <= 75 for p in physical) and all(p.startswith(" ") for p in physical[1:])
    parsed = cal.parse_content_line(cal.unfold_lines(prop)[0])
    assert parsed.params == {"CN": "Bob: Smith"} and cal.unescape_text(parsed.value) == title


def test_request_ics_key_lines():
    ev = event(meeting_url="https://meet.example.com/abc", display_time_zone="Europe/Berlin", description="Agenda")
    got = lines(cal.build_request_ics(ev, now=datetime(2026, 11, 10, 12, tzinfo=UTC)))
    assert got[:5] == ["BEGIN:VCALENDAR", f"PRODID:{cal.PRODID}", "VERSION:2.0", "CALSCALE:GREGORIAN",
                       "METHOD:REQUEST"]
    assert f"DTSTART:{cal.format_utc(ev.start)}" in got and f"DTEND:{cal.format_utc(ev.end)}" in got
    assert "DTSTAMP:20261110T120000Z" in got and "SEQUENCE:0" in got
    assert "SUMMARY:Q4 plan\\; budget\\, risks" in got
    assert "LOCATION:https://meet.example.com/abc" in got and "URL:https://meet.example.com/abc" in got
    assert "CONFERENCE;VALUE=URI;FEATURE=VIDEO;LABEL=Join:https://meet.example.com/abc" in got
    assert "X-ATOMIC-TIMEZONE:Europe/Berlin" in got and f"ORGANIZER:mailto:{ME}" in got
    assert ("ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Bob B:"
            "mailto:bob@example.com") in got
    assert got[-4:] == ["STATUS:CONFIRMED", "TRANSP:OPAQUE", "END:VEVENT", "END:VCALENDAR"]
    day = event(all_day=True, start=datetime(2026, 12, 1, tzinfo=UTC), end=datetime(2026, 12, 3, tzinfo=UTC))
    got = lines(cal.build_request_ics(day))
    assert "DTSTART;VALUE=DATE:20261201" in got and "DTEND;VALUE=DATE:20261203" in got
    assert "TRANSP:TRANSPARENT" in got and not any(x.startswith("X-ATOMIC") for x in got)


def test_cancel_and_reply_ics():
    full = lines(cal.build_cancel_ics(event(sequence=2), comment="Sorry, moved"))
    assert "METHOD:CANCEL" in full and "STATUS:CANCELLED" in full and "COMMENT:Sorry\\, moved" in full
    assert not any("RSVP" in x for x in full) and "SEQUENCE:2" in full
    partial = lines(cal.build_cancel_ics(event(attendees=[{"email": "ann@example.com"}]), partial=True))
    assert "STATUS:CANCELLED" not in partial and sum(x.startswith("ATTENDEE") for x in partial) == 1
    method, events = cal.parse_calendar(cal.build_request_ics(event(sequence=3)))
    invite = cal.primary_event(events)
    reply = lines(cal.build_reply_ics(invite, {"email": "bob@example.com", "name": "Bob"}, "ACCEPTED"))
    assert "METHOD:REPLY" in reply and "SEQUENCE:3" in reply and f"ORGANIZER:mailto:{ME}" in reply
    assert "ATTENDEE;PARTSTAT=ACCEPTED;CN=Bob:mailto:bob@example.com" in reply


def test_parse_tolerates_outlook_style_objects():
    text = ("BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VTIMEZONE\r\nTZID:W. Europe Standard Time\r\nEND:VTIMEZONE\r\n"
            "BEGIN:VEVENT\r\nUID:abc\r\nSUMMARY;LANGUAGE=en-US:Board\r\n meeting\r\n"
            "DTSTART;TZID=W. Europe Standard Time:20270115T100000\r\nDURATION:PT45M\r\n"
            "ORGANIZER;CN=\"Kim, Lee\":mailto:Kim@Corp.example\r\nATTENDEE;PARTSTAT=TENTATIVE:mailto:agent@atomicmail.ai\r\n"
            "X-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.example/join\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n")
    method, events = cal.parse_calendar(text)
    ev = events[0]
    assert method == "REQUEST" and ev.title == "Boardmeeting" and ev.time_zone == "Europe/Berlin"
    assert cal.iso(ev.start) == "2027-01-15T09:00:00.000Z" and ev.end - ev.start == timedelta(minutes=45)
    assert ev.organizer == {"email": "kim@corp.example", "name": "Kim, Lee"} and not ev.time_uncertain
    assert ev.meeting_url == "https://teams.example/join" and ev.attendees[0]["partstat"] == "TENTATIVE"


# --------------------------------------------------------------------------- time rules

def test_time_parsing_rules():
    assert cal.iso(cal.parse_user_datetime("2027-01-15T15:00:00+03:00", None, "start")) == "2027-01-15T12:00:00.000Z"
    assert cal.iso(cal.parse_user_datetime("2027-01-15T15:00Z", None, "start")) == "2027-01-15T15:00:00.000Z"
    assert cal.iso(cal.parse_user_datetime("2027-01-15T15:00", "Europe/Berlin", "start")) == "2027-01-15T14:00:00.000Z"
    assert cal.iso(cal.parse_user_datetime("2027-07-15 15:00", "Europe/Berlin", "start")) == "2027-07-15T13:00:00.000Z"
    for value, tz, message in (("2027-01-15T15:00", None, "no UTC offset"), ("2027-01-15", None, "has no time"),
                               ("2027-01-15T15:00", "Mars/Base", "Unknown time_zone"),
                               ("2027-02-31T15:00+00:00", None, "not a valid date"),
                               ("next tuesday", None, "must be ISO 8601")):
        with pytest.raises(ValueError, match=message):
            cal.parse_user_datetime(value, tz, "start")
    with pytest.raises(ValueError, match="in the past"):
        cal.check_start(datetime.now(UTC) - timedelta(hours=1))
    with pytest.raises(ValueError, match="two years"):
        cal.check_start(datetime.now(UTC) + timedelta(days=800))
    start = future()
    assert cal.resolve_end(start, None, None, None) == start + timedelta(minutes=30)
    with pytest.raises(ValueError, match="after start"):
        cal.resolve_end(start, cal.iso(start - timedelta(hours=1)).replace(".000Z", "Z"), None, None)
    with pytest.raises(ValueError, match="31 days"):
        cal.resolve_end(start, None, 60 * 24 * 40, None)
    first = cal.parse_user_date("2027-03-01", "start")
    assert cal.resolve_all_day_end(first, "2027-03-03") == datetime(2027, 3, 4, tzinfo=UTC)
    with pytest.raises(ValueError, match="no time"):
        cal.parse_user_date("2027-03-01T10:00", "start")
    assert cal.format_when(first, datetime(2027, 3, 4, tzinfo=UTC), all_day=True) == \
        "Mon, Mar 1, 2027 – Wed, Mar 3, 2027 (all day)"
    assert cal.format_when(datetime(2027, 1, 15, 12, tzinfo=UTC), datetime(2027, 1, 15, 12, 30, tzinfo=UTC),
                           "Europe/Moscow") == "Fri, Jan 15, 2027 15:00 – 15:30 (Europe/Moscow)"


def test_input_validation():
    client = FakeClient()
    start = cal.iso(future()).replace(".000Z", "Z")
    with pytest.raises(ValueError, match="At most 25"):
        cal.send_invite(client, title="x", start=start, attendees=[f"g{i}@ex.com" for i in range(26)])
    with pytest.raises(ValueError, match="not an email"):
        cal.send_invite(client, title="x", start=start, attendees="not-an-address")
    with pytest.raises(ValueError, match="https"):
        cal.send_invite(client, title="x", start=start, attendees="a@ex.com", meeting_url="http://zoom.us/j/1")
    with pytest.raises(ValueError, match="user name"):
        cal.send_invite(client, title="x", start=start, attendees="a@ex.com",
                        meeting_url="https://google.com@evil.example/x")
    with pytest.raises(ValueError, match="other than this inbox"):
        cal.send_invite(client, title="x", start=start, attendees=ME)
    with pytest.raises(ValueError, match="title is empty"):
        cal.send_invite(client, title="  ", start=start, attendees="a@ex.com")
    assert client.calls == []


# --------------------------------------------------------------------------- JMAP round trips

def test_send_invite_jmap_shape():
    client = FakeClient()
    start = future()
    result = cal.send_invite(client, title="Sync", start=start.strftime("%Y-%m-%dT%H:%M"), time_zone="Europe/Berlin",
                             attendees="Bob <Bob@Example.com>, ann@example.com", meeting_url="https://meet.example/x")
    method_calls, using = client.calls[0]
    assert using == (cal.CORE, cal.MAIL, cal.SUBMISSION, cal.BLOB)
    assert [c[0] for c in method_calls] == ["Blob/upload", "Email/set", "EmailSubmission/set"]
    upload = method_calls[0][1]["create"]["ics"]
    assert upload["type"] == "text/calendar" and "METHOD:REQUEST" in upload["data"][0]["data:asText"]
    create = method_calls[1][1]["create"]["m1"]
    assert create["from"] == [{"email": ME}] and create["mailboxIds"] == {"mb-sent": True}
    assert create["to"] == [{"email": "bob@example.com", "name": "Bob"}, {"email": "ann@example.com"}]
    assert create["subject"].startswith("Invitation: Sync @ ") and create["subject"].endswith("(Europe/Berlin)")
    assert create[cal.UID_PROP] == result["invite_id"] and create["keywords"] == {"$draft": True, "$seen": True}
    assert create["bodyStructure"] == {"type": "multipart/mixed", "subParts": [
        {"type": "multipart/alternative", "subParts": [
            {"partId": "t", "type": "text/plain"}, {"partId": "h", "type": "text/html"},
            {"blobId": "#ics", "type": "text/calendar", "charset": "utf-8"}]},
        {"blobId": "#ics", "type": "application/ics", "name": "invite.ics", "disposition": "attachment"}]}
    assert "Join: https://meet.example/x" in create["bodyValues"]["t"]["value"]
    assert method_calls[2][1]["create"] == {"s1": {"emailId": "#m1"}}  # envelope comes from the headers
    assert result["status"] == "sent" and result["version"] == 0 and result["message_id"] == "sent-1"
    assert result["attendees"] == ["bob@example.com", "ann@example.com"] and result["meeting_url"]
    assert "X-ATOMIC-TIMEZONE:Europe/Berlin" in lines(client.sent[0]["ics"])


def test_send_invite_through_the_real_jmap_client():
    from atomicmail_plugin.jmap import AtomicMailJmap

    def token(claims):
        enc = lambda o: base64.urlsafe_b64encode(json.dumps(o).encode()).decode().rstrip("=")  # noqa: E731
        return f"{enc({'alg': 'none'})}.{enc(claims)}.sig"

    class Sessions:
        def capability(self, force=False):
            return token({"inboxId": "agent", "allowedFromDomain": "atomicmail.ai", "exp": 9e9})

        def close(self):
            pass

    seen = []

    def handler(request):
        if request.url.path.endswith("/.well-known/jmap"):
            return httpx.Response(200, json={"apiUrl": "/jmap", "downloadUrl": "/dl/{blobId}", "uploadUrl": "/up",
                                             "primaryAccounts": {cal.MAIL: "acc1"}})
        body = json.loads(request.content)
        seen.append(body)
        responses = []
        for name, args, tag in body["methodCalls"]:
            if name == "Mailbox/query":
                responses.append([name, {"ids": ["mb-" + args["filter"]["role"]]}, tag])
            elif name == "Email/set":
                responses.append([name, {"created": {"m1": {"id": "e9"}}}, tag])
            else:
                responses.append([name, {"created": {}}, tag])
        return httpx.Response(200, json={"methodResponses": responses})

    client = AtomicMailJmap("11111111-2222-3333-4444-555555555555", "https://auth.test", "https://api.test",
                            sessions=Sessions(), transport=httpx.MockTransport(handler))
    result = cal.send_invite(client, title="Demo", start=cal.iso(future()).replace(".000Z", "Z"),
                             attendees=["bob@example.com"])
    send = seen[-1]
    assert send["using"] == [cal.CORE, cal.MAIL, cal.SUBMISSION, cal.BLOB]
    assert send["methodCalls"][1][1]["create"]["m1"]["from"] == [{"email": ME}]
    assert result["message_id"] == "e9"


def test_list_invites_merges_replies_and_received_invitations():
    ours = event(uid="u-ours", sequence=1)
    request = cal.build_request_ics(ours, now=datetime(2026, 11, 10, 9, tzinfo=UTC))
    reply = (cal.build_reply_ics(cal.primary_event(cal.parse_calendar(request)[1]),
                                 {"email": "bob@example.com"}, "ACCEPTED", now=datetime(2026, 11, 10, 11, tzinfo=UTC)))
    stranger_reply = cal.build_reply_ics(cal.primary_event(cal.parse_calendar(request)[1]),
                                         {"email": "ann@example.com"}, "DECLINED")
    theirs = event(uid="u-theirs", organizer={"email": "kim@corp.example", "name": "Kim"},
                   attendees=[{"email": ME}], title="Their sync")
    client = fake_with(
        mail("s1", "sent", ME, request, uid="u-ours"),
        mail("i1", "inbox", "bob@example.com", reply),
        mail("i2", "inbox", "mallory@evil.test", stranger_reply),  # a stranger cannot answer for Ann
        mail("i3", "inbox", "kim@corp.example", cal.build_request_ics(theirs)),
        mail("i4", "inbox", "fwd@other.example",
             cal.build_request_ics(event(uid="u-fwd", organizer={"email": "boss@corp.example"},
                                         attendees=[{"email": ME}]))),
    )
    state = cal.list_invites(client)
    organized = state["organized"]
    assert [o["invite_id"] for o in organized] == ["u-ours"] and organized[0]["version"] == 1
    guests = {g["email"]: g for g in organized[0]["attendees"]}
    assert guests["bob@example.com"]["response"] == "accepted" and guests["ann@example.com"]["response"] == "no_response"
    assert guests["bob@example.com"]["responded_at"] == "2026-11-10T11:00:00.000Z"
    received = {r["invite_id"]: r for r in state["received"]}
    assert received["u-theirs"]["organizer_matches_sender"] is True
    assert received["u-theirs"]["your_response"] == "no_response" and received["u-theirs"]["message_id"] == "i3"
    assert received["u-fwd"]["organizer_matches_sender"] is False
    assert state["scanned"] == {"sent": 1, "inbox": 4}
    blob_calls = [c for c in client.calls if c[0][0][0] == "Blob/get"]
    assert blob_calls and blob_calls[0][1] == (cal.CORE, cal.MAIL, cal.BLOB)


def test_update_keeps_length_and_cancels_dropped_guests():
    prev = event(uid="u1", sequence=0)
    client = fake_with(mail("s1", "sent", ME, cal.build_request_ics(prev), uid="u1"))
    new_start = prev.start + timedelta(days=1)
    result = cal.update_invite(client, "u1", start=cal.iso(new_start).replace(".000Z", "Z"),
                               attendees=["ann@example.com"])
    assert result["version"] == 1 and result["removed_attendees"] == ["bob@example.com"]
    assert result["end"] == cal.iso(new_start + timedelta(minutes=30))
    dropped, update = client.sent
    assert dropped["create"]["to"] == [{"email": "bob@example.com", "name": "Bob B"}]
    assert "METHOD:CANCEL" in dropped["ics"] and "STATUS:CANCELLED" not in dropped["ics"]
    assert dropped["create"]["subject"].startswith("Canceled event: ")
    assert "METHOD:REQUEST" in update["ics"] and "SEQUENCE:1" in update["ics"]
    assert update["create"]["subject"].startswith("Updated invitation: ")


def test_cancel_and_refuse_a_second_cancel():
    prev = event(uid="u2", sequence=4)
    client = fake_with(mail("s1", "sent", ME, cal.build_request_ics(prev), uid="u2"))
    result = cal.cancel_invite(client, "u2", note="Moved to next week")
    assert result["status"] == "cancelled" and result["version"] == 5
    assert "STATUS:CANCELLED" in client.sent[0]["ics"] and "COMMENT:Moved to next week" in lines(client.sent[0]["ics"])
    done = fake_with(mail("s1", "sent", ME, cal.build_request_ics(prev), uid="u2"),
                     mail("s2", "sent", ME, cal.build_cancel_ics(replace_seq(prev, 5)), uid="u2"))
    with pytest.raises(ValueError, match="already cancelled"):
        cal.cancel_invite(done, "u2")
    with pytest.raises(ValueError, match="no invitation with invite_id"):
        cal.cancel_invite(FakeClient(), "missing")


def replace_seq(ev, seq):
    from dataclasses import replace
    return replace(ev, sequence=seq)


def test_respond_to_invite_checks_organizer_and_guest_list():
    invite = event(uid="u3", organizer={"email": "kim@corp.example"}, attendees=[{"email": ME, "name": "Agent"}],
                   sequence=2)
    client = fake_with(mail("i1", "inbox", "kim@corp.example", cal.build_request_ics(invite)))
    result = cal.respond_to_invite(client, "i1", "declined", note="Busy")
    assert result == {"status": "sent", "invite_id": "u3", "response": "declined", "organizer": "kim@corp.example",
                      "title": invite.title, "message_id": "sent-1"}
    sent = client.sent[0]
    assert sent["create"]["to"] == [{"email": "kim@corp.example"}]
    assert sent["create"]["header:In-Reply-To:asMessageIds"] == ["<i1@x>"]
    reply = lines(sent["ics"])
    assert "METHOD:REPLY" in reply and "SEQUENCE:2" in reply and "COMMENT:Busy" in reply
    assert "ATTENDEE;PARTSTAT=DECLINED;CN=Agent:mailto:agent@atomicmail.ai" in reply
    spoof = fake_with(mail("i1", "inbox", "mallory@evil.test", cal.build_request_ics(invite)))
    with pytest.raises(ValueError, match="names kim@corp.example as organizer"):
        cal.respond_to_invite(spoof, "i1", "accepted")
    not_listed = fake_with(mail("i1", "inbox", "kim@corp.example",
                                cal.build_request_ics(replace_attendees(invite, [{"email": "x@corp.example"}]))))
    with pytest.raises(ValueError, match="does not list this inbox"):
        cal.respond_to_invite(not_listed, "i1", "accepted")
    with pytest.raises(ValueError, match="accepted, declined or tentative"):
        cal.respond_to_invite(client, "i1", "maybe")


def replace_attendees(ev, attendees):
    from dataclasses import replace
    return replace(ev, attendees=attendees)
