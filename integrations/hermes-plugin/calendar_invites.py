"""Meeting invitations over email (iMIP, RFC 6047; iTIP, RFC 5546).

A Python port of the Atomic Mail client's calendar module (ts/src/lib/agent/
calendar). No calendar is stored anywhere: every invitation, update,
cancellation and reply we send carries the event UID in the
``X-Atomic-Calendar-Uid`` header, so the Sent mailbox is the record, and the
guests' answers are the REPLY objects that come back to the inbox. Times are
sent in UTC (no VTIMEZONE needed); all-day events use VALUE=DATE.
"""

from __future__ import annotations

import html as _html
import re
import uuid
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from .jmap import BLOB, CORE, MAIL, SUBMISSION, JmapError

CALENDAR_UID_HEADER = "X-Atomic-Calendar-Uid"
PRODID = "-//Atomic Mail//Agent Calendar 1.0//EN"
MAX_ATTENDEES = 25
MAX_START_AHEAD = timedelta(days=2 * 366)
MAX_START_PAST = timedelta(minutes=10)
MAX_DURATION = timedelta(days=31)
DAY = timedelta(days=1)
MAX_TITLE, MAX_DESCRIPTION, MAX_LOCATION, MAX_COMMENT, MAX_URL = 200, 8000, 500, 1000, 2000
SCAN_DEFAULT, SCAN_MAX = 50, 200
UTC = timezone.utc
UID_PROP = f"header:{CALENDAR_UID_HEADER}:asText"
SCAN_PROPS = ["id", "threadId", "messageId", "subject", "from", "to", "receivedAt", "sentAt", UID_PROP, "bodyStructure"]
BODY_PROPS = ["partId", "blobId", "type", "name", "disposition", "subParts"]
RESPONSE_TO_PARTSTAT = {"accepted": "ACCEPTED", "declined": "DECLINED", "tentative": "TENTATIVE"}
PARTSTAT_VIEW = {"ACCEPTED": "accepted", "DECLINED": "declined", "TENTATIVE": "tentative",
                 "NEEDS-ACTION": "no_response", "DELEGATED": "no_response"}
SUBJECT_PREFIX = {"invite": "Invitation", "update": "Updated invitation", "cancel": "Canceled event",
                  "reply-accepted": "Accepted", "reply-declined": "Declined",
                  "reply-tentative": "Tentatively accepted"}
WINDOWS_ZONES = {
    "UTC": "UTC", "GMT Standard Time": "Europe/London", "W. Europe Standard Time": "Europe/Berlin",
    "Romance Standard Time": "Europe/Paris", "Central Europe Standard Time": "Europe/Budapest",
    "Central European Standard Time": "Europe/Warsaw", "E. Europe Standard Time": "Europe/Chisinau",
    "FLE Standard Time": "Europe/Kiev", "GTB Standard Time": "Europe/Bucharest",
    "Russian Standard Time": "Europe/Moscow", "Belarus Standard Time": "Europe/Minsk",
    "Turkey Standard Time": "Europe/Istanbul", "Israel Standard Time": "Asia/Jerusalem",
    "Arabian Standard Time": "Asia/Dubai", "India Standard Time": "Asia/Kolkata",
    "China Standard Time": "Asia/Shanghai", "Singapore Standard Time": "Asia/Singapore",
    "Tokyo Standard Time": "Asia/Tokyo", "Korea Standard Time": "Asia/Seoul",
    "AUS Eastern Standard Time": "Australia/Sydney", "E. South America Standard Time": "America/Sao_Paulo",
    "Atlantic Standard Time": "America/Halifax", "Eastern Standard Time": "America/New_York",
    "Central Standard Time": "America/Chicago", "Mountain Standard Time": "America/Denver",
    "US Mountain Standard Time": "America/Phoenix", "Pacific Standard Time": "America/Los_Angeles",
    "Alaskan Standard Time": "America/Anchorage", "Hawaiian Standard Time": "Pacific/Honolulu",
}
_WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def _now() -> datetime:
    return datetime.now(UTC)


# --------------------------------------------------------------------------- iCalendar text

def escape_text(text: str) -> str:
    return (text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
            .replace("\r\n", "\\n").replace("\r", "\\n").replace("\n", "\\n"))


def unescape_text(text: str) -> str:
    return re.sub(r"\\([\\;,nN])", lambda m: "\n" if m.group(1) in "nN" else m.group(1), text)


def fold_line(line: str) -> str:
    """CRLF-terminated physical lines of at most 75 octets, never splitting a UTF-8 sequence."""
    if len(line.encode()) <= 75:
        return line + "\r\n"
    out, current, size, limit = [], "", 0, 75
    for ch in line:
        n = len(ch.encode())
        if size + n > limit:
            out.append(current)
            current, size, limit = "", 0, 74  # the leading space takes one octet
        current += ch
        size += n
    out.append(current)
    return "\r\n ".join(out) + "\r\n"


def unfold_lines(text: str) -> list[str]:
    text = re.sub(r"\n[ \t]", "", text.replace("\r\n", "\n").replace("\r", "\n"))
    return [line for line in text.split("\n") if line.strip()]


def format_property(name: str, params: dict, value: str) -> str:
    head = name
    for key, val in params.items():
        if val is None or val == "":
            continue
        clean = re.sub(r'["\r\n]', "", str(val))
        head += f";{key}=" + (f'"{clean}"' if re.search(r"[:;,]", clean) else clean)
    return fold_line(f"{head}:{value}")


@dataclass
class Prop:
    name: str
    params: dict
    value: str


@dataclass
class Comp:
    name: str
    props: list = field(default_factory=list)
    components: list = field(default_factory=list)

    def get(self, name: str) -> Optional[Prop]:
        return next((p for p in self.props if p.name == name), None)

    def all(self, name: str) -> list:
        return [p for p in self.props if p.name == name]

    def text(self, name: str) -> Optional[str]:
        prop = self.get(name)
        return unescape_text(prop.value) if prop else None


def parse_content_line(line: str) -> Optional[Prop]:
    i, n = 0, len(line)
    while i < n and line[i] not in ";:":
        i += 1
    if i == 0 or i >= n:
        return None
    name, params = line[:i].strip().upper(), {}
    while i < n and line[i] == ";":
        i += 1
        eq = line.find("=", i)
        if eq < 0:
            return None
        pname, i, values = line[i:eq].strip().upper(), eq + 1, []
        while True:
            if i < n and line[i] == '"':
                close = line.find('"', i + 1)
                if close < 0:
                    return None
                values.append(line[i + 1:close])
                i = close + 1
            else:
                start = i
                while i < n and line[i] not in ",;:":
                    i += 1
                values.append(line[start:i])
            if i < n and line[i] == ",":
                i += 1
                continue
            break
        params[pname] = ",".join(values)
    if i >= n or line[i] != ":":
        return None
    return Prop(name, params, line[i + 1:])


def parse_ical(text: str) -> Optional[Comp]:
    """The first VCALENDAR in *text*; unparsable and stray lines are skipped."""
    stack: list[Comp] = []
    root: Optional[Comp] = None
    for line in unfold_lines(text):
        prop = parse_content_line(line)
        if prop is None:
            continue
        if prop.name == "BEGIN":
            comp = Comp(prop.value.strip().upper())
            if stack:
                stack[-1].components.append(comp)
            elif comp.name == "VCALENDAR" and root is None:
                root = comp
            else:
                continue
            stack.append(comp)
        elif prop.name == "END":
            if stack and stack.pop() is root:
                break
        elif stack:
            stack[-1].props.append(prop)
    return root


def format_utc(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


def format_date(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y%m%d")


def iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z") if dt else None


def iso_date(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%d")


def zone(name: Optional[str]):
    """tzinfo for an IANA name, ``UTC`` or a ``+03:00`` offset; None when unknown."""
    if not name or len(name) > 64:
        return None
    n = name.strip()
    if n.upper() in ("UTC", "Z", "GMT", "ETC/UTC"):
        return UTC
    m = re.fullmatch(r"([+-])(\d{2}):?(\d{2})", n)
    if m:
        delta = timedelta(hours=int(m.group(2)), minutes=int(m.group(3)))
        return timezone(-delta if m.group(1) == "-" else delta) if delta < timedelta(hours=24) else None
    try:
        return ZoneInfo(n)
    except Exception:  # noqa: BLE001 - unknown key, bad path, missing tzdata
        return None


def tzid_zone(tzid: str):
    tzid = tzid.strip()
    found = zone(tzid) or (zone(WINDOWS_ZONES[tzid]) if tzid in WINDOWS_ZONES else None)
    if found:
        return found, (tzid if zone(tzid) else WINDOWS_ZONES.get(tzid))
    m = re.search(r"([A-Za-z_]+/[A-Za-z_+\-]+(?:/[A-Za-z_+\-]+)?)$", tzid)
    if m and zone(m.group(1)):
        return zone(m.group(1)), m.group(1)
    return None, None


def parse_time_prop(prop: Prop) -> dict:
    """``{instant, date?, time_zone?, assumed_utc?}`` for DTSTART/DTEND/DTSTAMP (VTIMEZONE not expanded)."""
    value = prop.value.strip()
    date_only = re.fullmatch(r"(\d{4})(\d{2})(\d{2})", value)
    if prop.params.get("VALUE") == "DATE" or date_only:
        if not date_only:
            return {"instant": None}
        try:
            day = datetime(int(date_only[1]), int(date_only[2]), int(date_only[3]), tzinfo=UTC)
        except ValueError:
            return {"instant": None}
        return {"instant": day, "date": f"{date_only[1]}-{date_only[2]}-{date_only[3]}"}
    m = re.fullmatch(r"(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?", value, re.I)
    if not m:
        return {"instant": None}
    try:
        wall = datetime(int(m[1]), int(m[2]), int(m[3]), int(m[4]), int(m[5]), min(int(m[6] or 0), 59))
    except ValueError:
        return {"instant": None}
    if m[7]:
        return {"instant": wall.replace(tzinfo=UTC)}
    tzid = prop.params.get("TZID")
    if tzid:
        tz, name = tzid_zone(tzid)
        if tz is not None:
            return {"instant": wall.replace(tzinfo=tz).astimezone(UTC), "time_zone": name}
    return {"instant": wall.replace(tzinfo=UTC), "assumed_utc": True}


def parse_duration(value: str) -> Optional[timedelta]:
    v = value.strip()
    m = re.fullmatch(r"([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?", v)
    if not m or v == "P" or v.endswith("T"):
        return None
    w, d, h, mi, s = (int(x or 0) for x in m.groups()[1:])
    try:
        delta = timedelta(weeks=w, days=d, hours=h, minutes=mi, seconds=s)
    except OverflowError:
        return None
    return -delta if m[1] == "-" else delta


def mailto_to_email(value: str) -> Optional[str]:
    v = value.strip()
    addr = (v[7:] if v.lower().startswith("mailto:") else v).strip()
    return addr.lower() if re.fullmatch(r"[^\s@]+@[^\s@]+", addr) else None


# --------------------------------------------------------------------------- tool input

_OFFSET_RE = re.compile(r"(Z|[+-]\d{2}:?\d{2})$", re.I)
_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_LOCAL_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$")


def parse_user_datetime(value: str, time_zone: Optional[str], field_name: str) -> datetime:
    v = value.strip()
    if _OFFSET_RE.search(v):
        if not re.match(r"^\d{4}-\d{2}-\d{2}T", v):
            raise ValueError(f"{field_name} must be ISO 8601, e.g. 2026-10-16T15:00:00+03:00.")
        norm = re.sub(r"[zZ]$", "+00:00", v)
        norm = re.sub(r"([+-]\d{2})(\d{2})$", r"\1:\2", norm)
        try:
            return datetime.fromisoformat(norm).astimezone(UTC)
        except ValueError:
            raise ValueError(f"{field_name} is not a valid date and time.") from None
    m = _LOCAL_RE.match(v)
    if not m and _DATE_RE.match(v):
        raise ValueError(f"{field_name} has no time. Add one (e.g. {v}T15:00:00+03:00), or pass all_day: true "
                         "for an all-day event.")
    if not m:
        raise ValueError(f"{field_name} must be ISO 8601, e.g. 2026-10-16T15:00:00+03:00, or a local time like "
                         "2026-10-16T15:00 together with time_zone.")
    if not time_zone:
        raise ValueError(f"{field_name} has no UTC offset. Add one (e.g. +03:00) or pass time_zone (an IANA name "
                         "such as Europe/Moscow). Ask the user which time zone they mean rather than guessing.")
    tz = zone(time_zone)
    if tz is None:
        raise ValueError(f"Unknown time_zone '{time_zone}'. Use an IANA name.")
    try:
        wall = datetime(*(int(x) for x in m.groups(default="0")[:6]))
    except ValueError:
        raise ValueError(f"{field_name} is not a valid date and time.") from None
    return wall.replace(tzinfo=tz).astimezone(UTC)  # fold=0: first in an overlap, forward in a gap


def check_start(start: datetime, now: Optional[datetime] = None) -> None:
    now = now or _now()
    if start < now - MAX_START_PAST:
        raise ValueError(f"start {iso(start)} is in the past. Check the date and the time zone.")
    if start > now + MAX_START_AHEAD:
        raise ValueError("start is more than two years ahead.")


def resolve_end(start: datetime, end: Optional[str], duration_minutes: Optional[int],
                time_zone: Optional[str]) -> datetime:
    if end:
        stop = parse_user_datetime(end, time_zone, "end")
    else:
        stop = start + timedelta(minutes=int(duration_minutes if duration_minutes is not None else 30))
    if stop <= start:
        raise ValueError("end must be after start.")
    if stop - start > MAX_DURATION:
        raise ValueError("An invitation can span at most 31 days.")
    return stop


def parse_user_date(value: str, field_name: str) -> datetime:
    m = _DATE_RE.match(value.strip())
    if not m:
        raise ValueError(f"with all_day, {field_name} must be a date like 2026-10-16 (no time).")
    try:
        return datetime(int(m[1]), int(m[2]), int(m[3]), tzinfo=UTC)
    except ValueError:
        raise ValueError(f"{field_name} is not a valid date.") from None


def check_all_day_start(start: datetime, now: Optional[datetime] = None) -> None:
    now = now or _now()
    today = datetime(now.year, now.month, now.day, tzinfo=UTC)
    if start < today - DAY:
        raise ValueError(f"start {iso_date(start)} is in the past. Check the date.")
    if start > now + MAX_START_AHEAD:
        raise ValueError("start is more than two years ahead.")


def resolve_all_day_end(start: datetime, last_day: Optional[str]) -> datetime:
    end = parse_user_date(last_day, "end") + DAY if last_day else start + DAY
    if end <= start:
        raise ValueError("end (the last day) must not be before start.")
    if end - start > MAX_DURATION:
        raise ValueError("An invitation can span at most 31 days.")
    return end


def parse_meeting_url(raw: str) -> str:
    v = raw.strip()
    if len(v) > MAX_URL:
        raise ValueError(f"meeting_url is longer than {MAX_URL} characters.")
    if re.search(r'[\s"<>\\`]', v) or any(ord(c) < 0x20 or ord(c) == 0x7F for c in v):
        raise ValueError("meeting_url must be one https:// link without spaces or quotes.")
    try:
        parts = urlsplit(v)
    except ValueError:
        raise ValueError("meeting_url is not a valid link, e.g. https://meet.google.com/abc-defg-hij.") from None
    if parts.scheme.lower() != "https" or not parts.hostname:
        raise ValueError("meeting_url must start with https://.")
    if parts.username or parts.password:
        raise ValueError("meeting_url must not contain a user name or password.")
    return v


def parse_person(raw: str) -> Optional[dict]:
    v = raw.strip()
    m = re.fullmatch(r"(.*)<([^<>\s]+@[^<>\s]+)>", v)
    if m:
        name = m[1].strip().strip('"').strip()
        return {"email": m[2].strip().lower(), **({"name": name} if name else {})}
    if re.fullmatch(r'[^\s@<>",;:]+@[^\s@<>",;:]+\.[^\s@<>",;:]+', v):
        return {"email": v.lower()}
    return None


def as_list(value: Any) -> list[str]:
    if value is None:
        return []
    items = value if isinstance(value, (list, tuple)) else [value]
    return [s.strip() for item in items for s in re.split(r"[,;\n]", str(item)) if s.strip()]


def parse_attendees(raw: list[str]) -> list[dict]:
    out, seen = [], set()
    for item in raw:
        person = parse_person(item)
        if person is None:
            raise ValueError(f"'{item}' is not an email address.")
        if person["email"] not in seen:
            seen.add(person["email"])
            out.append(person)
    if not out:
        raise ValueError("Invite at least one attendee.")
    if len(out) > MAX_ATTENDEES:
        raise ValueError(f"At most {MAX_ATTENDEES} attendees per invitation.")
    return out


def check_length(value: Optional[str], limit: int, field_name: str) -> None:
    if value is not None and len(value) > limit:
        raise ValueError(f"{field_name} is longer than {limit} characters.")


# --------------------------------------------------------------------------- building iTIP objects

@dataclass
class Event:
    uid: str
    sequence: int
    title: str
    start: datetime
    end: datetime
    organizer: dict
    attendees: list
    description: Optional[str] = None
    location: Optional[str] = None
    meeting_url: Optional[str] = None
    all_day: bool = False
    display_time_zone: Optional[str] = None


def _vcal_head(method: str) -> str:
    return ("BEGIN:VCALENDAR\r\n" + format_property("PRODID", {}, PRODID)
            + f"VERSION:2.0\r\nCALSCALE:GREGORIAN\r\nMETHOD:{method}\r\n")


def _organizer_line(person: dict) -> str:
    return format_property("ORGANIZER", {"CN": person.get("name")}, "mailto:" + person["email"].strip())


def _attendee_line(att: dict, rsvp: bool) -> str:
    return format_property("ATTENDEE", {"CUTYPE": "INDIVIDUAL", "ROLE": "REQ-PARTICIPANT",
                                        "PARTSTAT": att.get("partstat") or "NEEDS-ACTION",
                                        "RSVP": "TRUE" if rsvp else None, "CN": att.get("name")},
                           "mailto:" + att["email"].strip())


def _event_core(ev: Event, now: datetime) -> str:
    s = format_property("UID", {}, ev.uid) + f"DTSTAMP:{format_utc(now)}\r\nSEQUENCE:{ev.sequence}\r\n"
    if ev.all_day:
        s += f"DTSTART;VALUE=DATE:{format_date(ev.start)}\r\nDTEND;VALUE=DATE:{format_date(ev.end)}\r\n"
    else:
        s += f"DTSTART:{format_utc(ev.start)}\r\nDTEND:{format_utc(ev.end)}\r\n"
    s += format_property("SUMMARY", {}, escape_text(ev.title))
    if ev.description:
        s += format_property("DESCRIPTION", {}, escape_text(ev.description))
    location = ev.location or ev.meeting_url
    if location:
        s += format_property("LOCATION", {}, escape_text(location))
    if ev.meeting_url:
        s += format_property("URL", {}, ev.meeting_url)
        s += format_property("CONFERENCE", {"VALUE": "URI", "FEATURE": "VIDEO", "LABEL": "Join"}, ev.meeting_url)
    if ev.display_time_zone and not ev.all_day:
        s += format_property("X-ATOMIC-TIMEZONE", {}, escape_text(ev.display_time_zone))
    return s + _organizer_line(ev.organizer)


def build_request_ics(ev: Event, now: Optional[datetime] = None) -> str:
    s = _vcal_head("REQUEST") + "BEGIN:VEVENT\r\n" + _event_core(ev, now or _now())
    s += "".join(_attendee_line(a, True) for a in ev.attendees)
    s += "STATUS:CONFIRMED\r\n" + ("TRANSP:TRANSPARENT\r\n" if ev.all_day else "TRANSP:OPAQUE\r\n")
    return s + "END:VEVENT\r\nEND:VCALENDAR\r\n"


def build_cancel_ics(ev: Event, now: Optional[datetime] = None, comment: Optional[str] = None,
                     partial: bool = False) -> str:
    """Whole meeting: every guest + STATUS:CANCELLED. ``partial``: only the dropped guests, no STATUS."""
    s = _vcal_head("CANCEL") + "BEGIN:VEVENT\r\n" + _event_core(ev, now or _now())
    s += "".join(_attendee_line(a, False) for a in ev.attendees)
    if comment:
        s += format_property("COMMENT", {}, escape_text(comment))
    if not partial:
        s += "STATUS:CANCELLED\r\n"
    return s + "END:VEVENT\r\nEND:VCALENDAR\r\n"


def build_reply_ics(invite: "ParsedEvent", me: dict, partstat: str, now: Optional[datetime] = None,
                    comment: Optional[str] = None) -> str:
    if not invite.organizer:
        raise ValueError("The invitation has no organizer to answer.")
    s = _vcal_head("REPLY") + "BEGIN:VEVENT\r\n" + format_property("UID", {}, invite.uid)
    s += f"DTSTAMP:{format_utc(now or _now())}\r\nSEQUENCE:{invite.sequence}\r\n" + (invite.recurrence_id_raw or "")
    if invite.all_day_date and invite.start:
        s += f"DTSTART;VALUE=DATE:{invite.all_day_date.replace('-', '')}\r\n"
    elif invite.start:
        s += f"DTSTART:{format_utc(invite.start)}\r\n" + (f"DTEND:{format_utc(invite.end)}\r\n" if invite.end else "")
    if invite.title:
        s += format_property("SUMMARY", {}, escape_text(invite.title))
    s += _organizer_line(invite.organizer)
    s += format_property("ATTENDEE", {"PARTSTAT": partstat, "CN": me.get("name")}, "mailto:" + me["email"].strip())
    if comment:
        s += format_property("COMMENT", {}, escape_text(comment))
    return s + "END:VEVENT\r\nEND:VCALENDAR\r\n"


# --------------------------------------------------------------------------- parsing what arrives

@dataclass
class ParsedEvent:
    uid: str
    sequence: int = 0
    stamp: Optional[datetime] = None
    title: Optional[str] = None
    description: Optional[str] = None
    location: Optional[str] = None
    meeting_url: Optional[str] = None
    meeting_url_guessed: bool = False
    start: Optional[datetime] = None
    end: Optional[datetime] = None
    all_day_date: Optional[str] = None
    time_zone: Optional[str] = None
    display_time_zone: Optional[str] = None
    time_uncertain: bool = False
    organizer: Optional[dict] = None
    attendees: list = field(default_factory=list)
    status: Optional[str] = None
    comment: Optional[str] = None
    recurring: bool = False
    recurrence_id_raw: Optional[str] = None


def _person(prop: Optional[Prop]) -> Optional[dict]:
    if prop is None:
        return None
    email = mailto_to_email(prop.value)
    if not email:
        return None
    name = (prop.params.get("CN") or "").strip('"').strip()
    return {"email": email, **({"name": name} if name else {})}


def _meeting_url(ev: Comp) -> tuple[Optional[str], bool]:
    for name in ("X-GOOGLE-CONFERENCE", "X-MICROSOFT-SKYPETEAMSMEETINGURL",
                 "X-MICROSOFT-ONLINEMEETINGEXTERNALLINK", "URL"):
        prop = ev.get(name)
        if prop and prop.value.strip().lower().startswith("https://"):
            return prop.value.strip(), False
    for prop in ev.all("CONFERENCE"):
        if prop.value.strip().lower().startswith("https://"):
            return prop.value.strip(), False
    found = re.search(r"https://\S+", ev.text("LOCATION") or "")
    return (found.group(0), True) if found else (None, False)


def parse_calendar(text: str) -> Optional[tuple[str, list]]:
    """``(METHOD, [ParsedEvent, ...])`` or None when *text* is not iCalendar."""
    cal = parse_ical(text)
    if cal is None:
        return None
    method = (cal.get("METHOD").value if cal.get("METHOD") else "PUBLISH").strip().upper()
    events = []
    for comp in cal.components:
        uid = comp.get("UID").value.strip() if comp.name == "VEVENT" and comp.get("UID") else ""
        if not uid:
            continue
        start = parse_time_prop(comp.get("DTSTART")) if comp.get("DTSTART") else {"instant": None}
        end, end_uncertain = None, False
        if comp.get("DTEND"):
            parsed_end = parse_time_prop(comp.get("DTEND"))
            end, end_uncertain = parsed_end["instant"], bool(parsed_end.get("assumed_utc"))
        elif start["instant"]:
            duration = parse_duration(comp.get("DURATION").value) if comp.get("DURATION") else None
            if duration is not None:
                end = start["instant"] + duration
            else:
                end = start["instant"] + DAY if start.get("date") else start["instant"]
        attendees = []
        for prop in comp.all("ATTENDEE"):
            person = _person(prop)
            if person:
                note = prop.params.get("X-RESPONSE-COMMENT")
                attendees.append({**person, "partstat": (prop.params.get("PARTSTAT") or "NEEDS-ACTION").upper(),
                                  **({"comment": unescape_text(note)} if note else {})})
        seq = re.fullmatch(r"\s*(\d+)\s*", comp.get("SEQUENCE").value) if comp.get("SEQUENCE") else None
        url, guessed = _meeting_url(comp)
        display = (comp.text("X-ATOMIC-TIMEZONE") or "").strip()
        rid = comp.get("RECURRENCE-ID")
        events.append(ParsedEvent(
            uid=uid, sequence=int(seq[1]) if seq else 0,
            stamp=parse_time_prop(comp.get("DTSTAMP"))["instant"] if comp.get("DTSTAMP") else None,
            title=comp.text("SUMMARY"), description=comp.text("DESCRIPTION"), location=comp.text("LOCATION"),
            meeting_url=url, meeting_url_guessed=guessed, start=start["instant"], end=end,
            all_day_date=start.get("date"), time_zone=start.get("time_zone"),
            display_time_zone=display if zone(display) else None,
            time_uncertain=bool(start.get("assumed_utc")) or end_uncertain,
            organizer=_person(comp.get("ORGANIZER")), attendees=attendees,
            status=comp.get("STATUS").value.strip().upper() if comp.get("STATUS") else None,
            comment=comp.text("COMMENT") or next((a["comment"] for a in attendees if a.get("comment")), None),
            recurring=bool(comp.get("RRULE") or comp.get("RDATE") or rid),
            recurrence_id_raw=format_property("RECURRENCE-ID", rid.params, rid.value) if rid else None,
        ))
    return method, events


def primary_event(events: list) -> Optional[ParsedEvent]:
    return next((e for e in events if not e.recurrence_id_raw), events[0] if events else None)


# --------------------------------------------------------------------------- the message around it

def _fmt_day(dt: datetime) -> str:
    return f"{_WEEKDAYS[dt.weekday()]}, {_MONTHS[dt.month - 1]} {dt.day}, {dt.year}"


def format_when(start: datetime, end: datetime, tz_name: str = "UTC", all_day: bool = False) -> str:
    if all_day:
        last = max(start, end - DAY)
        first, final = start.astimezone(UTC), last.astimezone(UTC)
        if iso_date(first) == iso_date(final):
            return f"{_fmt_day(first)} (all day)"
        return f"{_fmt_day(first)} – {_fmt_day(final)} (all day)"
    tz = zone(tz_name)
    label = tz_name if tz is not None else "UTC"
    tz = tz or UTC
    a, b = start.astimezone(tz), end.astimezone(tz)
    if _fmt_day(a) == _fmt_day(b):
        return f"{_fmt_day(a)} {a:%H:%M} – {b:%H:%M} ({label})"
    return f"{_fmt_day(a)} {a:%H:%M} – {_fmt_day(b)} {b:%H:%M} ({label})"


def message_subject(kind: str, title: str, when: str) -> str:
    def clean(x: str) -> str:
        return re.sub(r"[\x00-\x1f\x7f]+", " ", x)
    return f"{SUBJECT_PREFIX[kind]}: {clean(title)} @ {clean(when)}"[:250]


def compose_body(kind: str, title: str, when: str, organizer: dict, *, location: Optional[str] = None,
                 description: Optional[str] = None, meeting_url: Optional[str] = None,
                 attendees: Optional[list] = None, responder: Optional[dict] = None,
                 comment: Optional[str] = None) -> tuple[str, str]:
    def who(p: dict) -> str:
        return f"{p['name']} <{p['email']}>" if p.get("name") else p["email"]
    verbs = {"invite": "invited you to", "update": "updated", "cancel": "canceled"}
    if kind in verbs:
        lead = f'{who(organizer)} {verbs[kind]} "{title}".'
    else:
        verb = {"reply-accepted": "accepted", "reply-declined": "declined"}.get(kind, "tentatively accepted")
        lead = f'{who(responder or organizer)} {verb} "{title}".'
    rows = [("When", when)]
    if meeting_url:
        rows.append(("Join", meeting_url))
    if location and location != meeting_url:
        rows.append(("Where", location))
    if attendees:
        rows.append(("Guests", ", ".join(who(p) for p in attendees)))
    if comment:
        rows.append(("Note", comment))
    text = "\n".join([lead, "", *(f"{k}: {v}" for k, v in rows), *(["", description] if description else []), ""])
    esc = lambda s: _html.escape(s, quote=True).replace("&#x27;", "'")  # noqa: E731
    cells = "".join(
        f'<tr><td style="padding:2px 12px 2px 0;color:#666;vertical-align:top">{esc(k)}</td><td style="padding:2px 0">'
        + (f'<a href="{esc(v)}" style="word-break:break-all">{esc(v)}</a>' if k == "Join" else esc(v))
        + "</td></tr>" for k, v in rows)
    desc = f'<p style="white-space:pre-wrap">{esc(description)}</p>' if description else ""
    return text, f'<div><p>{esc(lead)}</p><table style="border-collapse:collapse">{cells}</table>{desc}</div>'


# --------------------------------------------------------------------------- JMAP round trips

def _pick(responses: list, tag: str) -> dict:
    for name, args, resp_tag in responses:
        if resp_tag == tag:
            return args
    raise JmapError(f"JMAP reply is missing {tag}")


def send_calendar_message(client: Any, *, to: list, subject: str, body: tuple[str, str], ics: str, uid: str,
                          in_reply_to: Optional[str] = None) -> Optional[str]:
    """Blob/upload the iCalendar object and send it inline + as invite.ics (Google Calendar's MIME shape)."""
    account = client.account_id
    alternative = [{"partId": "t", "type": "text/plain"}, {"partId": "h", "type": "text/html"},
                   {"blobId": "#ics", "type": "text/calendar", "charset": "utf-8"}]
    create = {
        "mailboxIds": {client.mailbox_id("sent"): True},
        "from": [{"email": client.address}],
        "to": [{"email": p["email"], **({"name": p["name"]} if p.get("name") else {})} for p in to],
        "subject": subject,
        UID_PROP: uid,
        "bodyStructure": {"type": "multipart/mixed", "subParts": [
            {"type": "multipart/alternative", "subParts": alternative},
            {"blobId": "#ics", "type": "application/ics", "name": "invite.ics", "disposition": "attachment"}]},
        "bodyValues": {"t": {"value": body[0]}, "h": {"value": body[1]}},
        "keywords": {"$draft": True, "$seen": True},
    }
    if in_reply_to:
        create["header:In-Reply-To:asMessageIds"] = [in_reply_to]
        create["header:References:asMessageIds"] = [in_reply_to]
    responses = client.call([
        ["Blob/upload", {"accountId": account,
                         "create": {"ics": {"data": [{"data:asText": ics}], "type": "text/calendar"}}}, "b0"],
        ["Email/set", {"accountId": account, "create": {"m1": create}}, "c0"],
        ["EmailSubmission/set", {"accountId": account, "create": {"s1": {"emailId": "#m1"}},
                                 "onSuccessUpdateEmail": {"#s1": {"keywords/$draft": None,
                                                                  "keywords/$sent": True}}}, "c1"],
    ], using=(CORE, MAIL, SUBMISSION, BLOB))
    for name, args, _tag in responses:
        failed = args.get("notCreated") if isinstance(args, dict) else None
        if failed:
            first = next(iter(failed.values()), {}) or {}
            raise JmapError(f"{name} rejected: {first.get('type', 'error')} {first.get('description', '')}".strip())
    return ((_pick(responses, "c0").get("created") or {}).get("m1") or {}).get("id")


def _calendar_blob_id(part: Optional[dict]) -> Optional[str]:
    """The calendar object in a body structure: inline text/calendar first, else an .ics file."""
    inline = file = None

    def walk(p: Optional[dict]) -> None:
        nonlocal inline, file
        if not isinstance(p, dict):
            return
        ctype, blob = (p.get("type") or "").lower(), p.get("blobId")
        if ctype == "text/calendar" and blob and not inline:
            inline = blob
        elif blob and not file and (ctype == "application/ics" or (
                (p.get("name") or "").lower().endswith(".ics") and ctype in ("application/octet-stream", ""))):
            file = blob
        for sub in p.get("subParts") or []:
            walk(sub)
    walk(part)
    return inline or file


def _scanned(raw: dict, box: str) -> dict:
    ids = raw.get("messageId") or []
    return {"id": str(raw.get("id")), "message_id": ids[0] if ids else None, "subject": raw.get("subject"),
            "from": [a for a in raw.get("from") or [] if isinstance(a, dict) and a.get("email")],
            "received_at": raw.get("receivedAt"), "sent_at": raw.get("sentAt"),
            "calendar_blob_id": _calendar_blob_id(raw.get("bodyStructure")), "box": box}


def _get_scanned(client: Any, method_calls: list) -> list:
    responses = client.call(method_calls)
    return [_scanned(raw, "sent" if tag == "gs" else "inbox")
            for name, args, tag in responses if name == "Email/get" for raw in args.get("list") or []]


def _scan_calls(client: Any, limit: int, uid: Optional[str] = None, *, inbox: bool = True) -> list:
    account = client.account_id
    sent_filter = {"inMailbox": client.mailbox_id("sent"), "notKeyword": "$draft",
                   "header": [CALENDAR_UID_HEADER, uid] if uid else [CALENDAR_UID_HEADER]}
    calls = [["Email/query", {"accountId": account, "filter": sent_filter,
                              "sort": [{"property": "sentAt", "isAscending": False}], "limit": limit}, "qs"],
             ["Email/get", {"accountId": account, "#ids": {"resultOf": "qs", "name": "Email/query", "path": "/ids"},
                            "properties": SCAN_PROPS, "bodyProperties": BODY_PROPS}, "gs"]]
    if inbox:
        calls += [["Email/query", {"accountId": account, "filter": {"inMailbox": client.mailbox_id("inbox")},
                                   "sort": [{"property": "receivedAt", "isAscending": False}], "limit": limit}, "qi"],
                  ["Email/get", {"accountId": account,
                                 "#ids": {"resultOf": "qi", "name": "Email/query", "path": "/ids"},
                                 "properties": SCAN_PROPS, "bodyProperties": BODY_PROPS}, "gi"]]
    return calls


def _fetch_calendars(client: Any, messages: list) -> dict:
    ids = list(dict.fromkeys(m["calendar_blob_id"] for m in messages if m.get("calendar_blob_id")))
    if not ids:
        return {}
    calls = [["Blob/get", {"accountId": client.account_id, "ids": ids[i:i + 100], "properties": ["data:asText"]},
              f"bg{i // 100}"] for i in range(0, len(ids), 100)]
    out = {}
    for name, args, _tag in client.call(calls, using=(CORE, MAIL, BLOB)):
        if name == "Blob/get":
            for blob in args.get("list") or []:
                if isinstance(blob.get("id"), str) and isinstance(blob.get("data:asText"), str):
                    out[blob["id"]] = blob["data:asText"]
    return out


# --------------------------------------------------------------------------- list_invites state

def _items(messages: list, calendars: dict) -> list:
    items = []
    for msg in messages:
        parsed = parse_calendar(calendars.get(msg.get("calendar_blob_id") or "", "")) if msg.get(
            "calendar_blob_id") else None
        ev = primary_event(parsed[1]) if parsed else None
        if ev:
            items.append({"msg": msg, "method": parsed[0], "ev": ev})
    return items


def _sender(it: dict) -> Optional[str]:
    first = (it["msg"].get("from") or [{}])[0]
    return (first.get("email") or "").lower() or None


def _time_of(it: dict) -> float:
    if it["ev"].stamp:
        return it["ev"].stamp.timestamp()
    raw = it["msg"].get("sent_at") or it["msg"].get("received_at") or ""
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def _full_cancel(it: dict) -> bool:
    return it["ev"].status == "CANCELLED" or (it["method"] == "CANCEL" and it["msg"]["box"] == "inbox")


def _newer(a: dict, b: dict) -> bool:
    if a["ev"].sequence != b["ev"].sequence:
        return a["ev"].sequence > b["ev"].sequence
    if _full_cancel(a) != _full_cancel(b):
        return _full_cancel(a)
    if a["method"] != b["method"] and {a["method"], b["method"]} == {"REQUEST", "CANCEL"}:
        return a["method"] == "REQUEST"
    return _time_of(a) > _time_of(b)


def _latest_ours(items: list, me: str) -> dict:
    ours: dict = {}
    for it in items:
        if it["msg"]["box"] != "sent" or it["method"] not in ("REQUEST", "CANCEL"):
            continue
        if (it["method"] == "CANCEL" and not _full_cancel(it)) or (it["ev"].organizer or {}).get("email") != me:
            continue
        prev = ours.get(it["ev"].uid)
        if prev is None or _newer(it, prev):
            ours[it["ev"].uid] = it
    return ours


def _responder(it: dict, me: str) -> Optional[str]:
    """The guest who answered: the ATTENDEE matching the sender (or the single one on the sender's domain)."""
    sender = _sender(it)
    if not sender:
        return None
    others = [a for a in it["ev"].attendees if a["email"] != me]
    if any(a["email"] == sender for a in others):
        return sender
    if len(others) == 1 and others[0]["email"].rsplit("@", 1)[-1] == sender.rsplit("@", 1)[-1]:
        return others[0]["email"]
    return None


def _all_day_view(ev: ParsedEvent) -> dict:
    if not ev.all_day_date:
        return {}
    last = iso_date(ev.end - DAY) if ev.end and ev.start and ev.end - DAY > ev.start else ev.all_day_date
    return {"all_day": True, "all_day_date": ev.all_day_date, "all_day_last_date": last}


def derive_invite_state(messages: list, calendars: dict, me: str) -> dict:
    me = me.lower()
    items = _items(messages, calendars)
    ours = _latest_ours(items, me)
    answers: dict = {}
    for it in items:
        if it["msg"]["box"] != "inbox" or it["method"] not in ("REPLY", "COUNTER") or it["ev"].uid not in ours:
            continue
        who = _responder(it, me)
        if who:
            per = answers.setdefault(it["ev"].uid, {})
            if who not in per or _time_of(it) >= _time_of(per[who]):
                per[who] = it
    organized = []
    for uid, it in ours.items():
        guests = []
        for att in (a for a in it["ev"].attendees if a["email"] != me):
            view = {"email": att["email"], **({"name": att["name"]} if att.get("name") else {}),
                    "response": "no_response"}
            ans = answers.get(uid, {}).get(att["email"])
            if ans:
                if ans["method"] == "COUNTER":
                    view.update(response="proposed_new_time", proposed_start=iso(ans["ev"].start),
                                proposed_end=iso(ans["ev"].end))
                else:
                    ps = next((x["partstat"] for x in ans["ev"].attendees if x["email"] == att["email"]),
                              "NEEDS-ACTION")
                    view["response"] = PARTSTAT_VIEW.get(ps, "no_response")
                view["responded_at"] = iso(ans["ev"].stamp) or ans["msg"].get("received_at")
                if ans["ev"].comment:
                    view["comment"] = ans["ev"].comment
                if ans["ev"].sequence < it["ev"].sequence:
                    view["answered_earlier_version"] = True
            guests.append(view)
        ev = it["ev"]
        organized.append({"invite_id": uid, "title": ev.title or "(no title)", "start": iso(ev.start),
                          "end": iso(ev.end), **_all_day_view(ev), **({"location": ev.location} if ev.location else {}),
                          **({"meeting_url": ev.meeting_url} if ev.meeting_url else {}),
                          "status": "cancelled" if _full_cancel(it) else "scheduled", "version": ev.sequence,
                          "attendees": guests, "last_sent_message_id": it["msg"]["id"]})
    # Invitations others sent us: the first message pins a UID's organizer; mail from the organizer's own
    # address is never replaced by one that is not.
    theirs: dict = {}
    for it in sorted((i for i in items if i["msg"]["box"] == "inbox"), key=lambda i: i["msg"].get("received_at") or ""):
        org = (it["ev"].organizer or {}).get("email")
        if it["method"] not in ("REQUEST", "CANCEL") or not org or org == me:
            continue
        prev = theirs.get(it["ev"].uid)
        from_org = lambda x: _sender(x) == (x["ev"].organizer or {}).get("email")  # noqa: E731
        if prev is None:
            theirs[it["ev"].uid] = it
        elif org == (prev["ev"].organizer or {}).get("email"):
            if from_org(it) != from_org(prev):
                if from_org(it):
                    theirs[it["ev"].uid] = it
            elif _newer(it, prev):
                theirs[it["ev"].uid] = it
    mine: dict = {}
    for it in items:
        if it["msg"]["box"] == "sent" and it["method"] == "REPLY":
            prev = mine.get(it["ev"].uid)
            if prev is None or _newer(it, prev):
                mine[it["ev"].uid] = it
    received = []
    for uid, it in theirs.items():
        ev, yours = it["ev"], "no_response"
        if uid in mine:
            atts = mine[uid]["ev"].attendees
            ps = next((a["partstat"] for a in atts if a["email"] == me), atts[0]["partstat"] if atts else "")
            yours = PARTSTAT_VIEW.get(ps, "no_response")
        else:
            listed = next((a for a in ev.attendees if a["email"] == me), None)
            if listed:
                yours = PARTSTAT_VIEW.get(listed["partstat"], "no_response")
        received.append({"invite_id": uid, "message_id": it["msg"]["id"], "title": ev.title or "(no title)",
                         "start": iso(ev.start), "end": iso(ev.end), **_all_day_view(ev),
                         **({"time_zone": ev.time_zone} if ev.time_zone else {}),
                         **({"time_uncertain": True} if ev.time_uncertain else {}),
                         **({"location": ev.location} if ev.location else {}),
                         **({"meeting_url": ev.meeting_url} if ev.meeting_url else {}),
                         "organizer": ev.organizer, "organizer_matches_sender": _sender(it) == (ev.organizer or {}).get(
                             "email"), "status": "cancelled" if _full_cancel(it) else "scheduled",
                         "recurring": ev.recurring, "your_response": yours})
    organized.sort(key=lambda o: o["start"] or "")
    received.sort(key=lambda r: r["start"] or "")
    return {"organized": organized, "received": received}


# --------------------------------------------------------------------------- public operations

def display_zone(time_zone: Optional[str] = None, raw: Optional[str] = None) -> str:
    if time_zone and zone(time_zone):
        return time_zone
    m = re.search(r"([+-]\d{2}):?(\d{2})$", (raw or "").strip())
    return f"{m[1]}:{m[2]}" if m and zone(f"{m[1]}:{m[2]}") else "UTC"


def _zone_to_keep(time_zone: Optional[str], raw_start: Optional[str], all_day: bool) -> Optional[str]:
    if all_day or (not time_zone and not raw_start):
        return None
    found = display_zone(time_zone, raw_start)
    return None if found == "UTC" else found


def _when(ev: Event, time_zone: Optional[str] = None, raw: Optional[str] = None) -> str:
    return format_when(ev.start, ev.end, display_zone(time_zone, raw), ev.all_day)


def _result(status: str, ev: Event, when: str, message_id: Optional[str]) -> dict:
    return {"status": status, "invite_id": ev.uid, "version": ev.sequence, "title": ev.title,
            "start": iso(ev.start), "end": iso(ev.end), **({"all_day": True} if ev.all_day else {}),
            "when": when, **({"meeting_url": ev.meeting_url} if ev.meeting_url else {}),
            "attendees": [a["email"] for a in ev.attendees], "message_id": message_id}


def _guests(raw: Any, me: str, empty_message: str) -> list:
    guests = [a for a in parse_attendees(as_list(raw)) if a["email"] != me]
    if not guests:
        raise ValueError(empty_message)
    return guests


def send_invite(client: Any, *, title: str, start: str, attendees: Any, duration_minutes: Optional[int] = None,
                end: Optional[str] = None, time_zone: Optional[str] = None, all_day: bool = False,
                meeting_url: Optional[str] = None, location: Optional[str] = None,
                description: Optional[str] = None) -> dict:
    me = client.address.lower()
    title = (title or "").strip()
    if not title:
        raise ValueError("title is empty.")
    for value, limit, name in ((title, MAX_TITLE, "title"), (location, MAX_LOCATION, "location"),
                               (description, MAX_DESCRIPTION, "description")):
        check_length(value, limit, name)
    url = parse_meeting_url(meeting_url) if meeting_url and meeting_url.strip() else None
    if all_day:
        if duration_minutes is not None:
            raise ValueError("all_day events take no duration_minutes: pass end as the last day instead.")
        if time_zone:
            raise ValueError("all_day events take no time_zone: their dates are the same everywhere.")
        first = parse_user_date(start, "start")
        check_all_day_start(first)
        last = resolve_all_day_end(first, end)
    else:
        first = parse_user_datetime(start, time_zone, "start")
        check_start(first)
        last = resolve_end(first, end, duration_minutes, time_zone)
    ev = Event(uid=str(uuid.uuid4()), sequence=0, title=title, start=first, end=last, organizer={"email": me},
               attendees=_guests(attendees, me, "invite at least one address other than this inbox."),
               description=(description or "").strip() or None, location=(location or "").strip() or None,
               meeting_url=url, all_day=bool(all_day), display_time_zone=_zone_to_keep(time_zone, start, all_day))
    when = _when(ev, time_zone, start)
    message_id = send_calendar_message(
        client, to=ev.attendees, subject=message_subject("invite", ev.title, when),
        body=compose_body("invite", ev.title, when, ev.organizer, location=ev.location, description=ev.description,
                          meeting_url=ev.meeting_url, attendees=ev.attendees),
        ics=build_request_ics(ev), uid=ev.uid)
    return _result("sent", ev, when, message_id)


def _load_ours(client: Any, uid: str) -> tuple[Event, bool]:
    messages = _get_scanned(client, _scan_calls(client, 25, uid, inbox=False))
    latest = _latest_ours(_items(messages, _fetch_calendars(client, messages)), client.address.lower()).get(uid)
    if latest is None:
        raise ValueError(f"no invitation with invite_id '{uid}' was sent from this inbox. "
                         "Use list_invites to see the ones you organize.")
    pe = latest["ev"]
    if not (pe.start and pe.end and pe.organizer):
        raise ValueError("The stored invitation is incomplete; send a new one.")
    url = None if pe.meeting_url_guessed else pe.meeting_url
    ev = Event(uid=pe.uid, sequence=pe.sequence, title=pe.title or "", start=pe.start, end=pe.end,
               organizer=pe.organizer, attendees=[{k: v for k, v in a.items() if k in ("email", "name")}
                                                  for a in pe.attendees],
               description=pe.description, location=None if url and pe.location == url else pe.location,
               meeting_url=url, all_day=bool(pe.all_day_date), display_time_zone=pe.display_time_zone)
    return ev, latest["method"] == "CANCEL" or pe.status == "CANCELLED"


def _updated_times(prev: Event, start: Optional[str], end: Optional[str], duration_minutes: Optional[int],
                   time_zone: Optional[str], all_day: Optional[bool]) -> tuple[datetime, datetime, bool]:
    day_kind = prev.all_day if all_day is None else bool(all_day)
    length = prev.end - prev.start
    if day_kind:
        if duration_minutes is not None:
            raise ValueError("all_day events take no duration_minutes: pass end as the last day instead.")
        if time_zone and (all_day is not None or start or end):
            raise ValueError("all_day events take no time_zone: their dates are the same everywhere.")
        if not prev.all_day and not start:
            raise ValueError("to make this meeting all-day, pass start as a date (YYYY-MM-DD).")
        if start:
            first = parse_user_date(start, "start")
            check_all_day_start(first)
            return first, (resolve_all_day_end(first, end) if end or not prev.all_day else first + length), True
        return prev.start, (resolve_all_day_end(prev.start, end) if end else prev.end), True
    if prev.all_day and not start:
        raise ValueError("to give this all-day event a time, pass start, e.g. 2026-10-16T15:00:00+03:00 "
                         "(length: duration_minutes, default 30).")
    if start:
        first = parse_user_datetime(start, time_zone, "start")
        check_start(first)
        if end or duration_minutes or prev.all_day:
            return first, resolve_end(first, end, duration_minutes, time_zone), False
        return first, first + length, False
    if end or duration_minutes:
        return prev.start, resolve_end(prev.start, end, duration_minutes, time_zone), False
    return prev.start, prev.end, False


def update_invite(client: Any, invite_id: str, *, title: Optional[str] = None, start: Optional[str] = None,
                  end: Optional[str] = None, duration_minutes: Optional[int] = None, time_zone: Optional[str] = None,
                  attendees: Any = None, all_day: Optional[bool] = None, meeting_url: Optional[str] = None,
                  location: Optional[str] = None, description: Optional[str] = None) -> dict:
    me = client.address.lower()
    prev, cancelled = _load_ours(client, (invite_id or "").strip())
    if cancelled:
        raise ValueError("this invitation was cancelled. Send a new one with send_invite.")
    if time_zone is not None and not zone(time_zone):
        raise ValueError(f"Unknown time_zone '{time_zone}'. Use an IANA name, e.g. Europe/Moscow.")
    for value, limit, name in ((title, MAX_TITLE, "title"), (location, MAX_LOCATION, "location"),
                               (description, MAX_DESCRIPTION, "description")):
        check_length(value, limit, name)
    url = prev.meeting_url if meeting_url is None else (parse_meeting_url(meeting_url) if meeting_url.strip() else None)
    first, last, day_kind = _updated_times(prev, start, end, duration_minutes, time_zone, all_day)
    guests = prev.attendees if attendees is None else _guests(
        attendees, me, "the guest list would be empty. Use cancel_invite to call the meeting off.")
    keep_zone = (None if day_kind else _zone_to_keep(time_zone, start, False)
                 if time_zone is not None or start is not None else prev.display_time_zone)
    nxt = replace(prev, sequence=prev.sequence + 1, title=(title or "").strip() or prev.title,
                  description=prev.description if description is None else (description.strip() or None),
                  location=prev.location if location is None else (location.strip() or None),
                  meeting_url=url, all_day=day_kind, start=first, end=last, display_time_zone=keep_zone,
                  attendees=guests)
    kept = {a["email"] for a in nxt.attendees}
    removed = [a for a in prev.attendees if a["email"] not in kept]
    when = _when(nxt, time_zone or nxt.display_time_zone, start)
    if removed:  # RFC 5546 §3.2.5: dropped guests get a CANCEL listing only them, no STATUS
        send_calendar_message(client, to=removed, subject=message_subject("cancel", nxt.title, when),
                              body=compose_body("cancel", nxt.title, when, nxt.organizer),
                              ics=build_cancel_ics(replace(nxt, attendees=removed), _now() - timedelta(seconds=1),
                                                   partial=True), uid=nxt.uid)
    message_id = send_calendar_message(
        client, to=nxt.attendees, subject=message_subject("update", nxt.title, when),
        body=compose_body("update", nxt.title, when, nxt.organizer, location=nxt.location,
                          description=nxt.description, meeting_url=nxt.meeting_url, attendees=nxt.attendees),
        ics=build_request_ics(nxt), uid=nxt.uid)
    return {**_result("updated", nxt, when, message_id), "removed_attendees": [a["email"] for a in removed]}


def cancel_invite(client: Any, invite_id: str, *, note: Optional[str] = None, time_zone: Optional[str] = None) -> dict:
    check_length(note, MAX_COMMENT, "note")
    if time_zone is not None and not zone(time_zone):
        raise ValueError(f"Unknown time_zone '{time_zone}'. Use an IANA name, e.g. Europe/Moscow.")
    prev, cancelled = _load_ours(client, (invite_id or "").strip())
    if cancelled:
        raise ValueError("this invitation is already cancelled.")
    ev = replace(prev, sequence=prev.sequence + 1)
    when = _when(ev, time_zone or ev.display_time_zone)
    note = (note or "").strip() or None
    message_id = send_calendar_message(
        client, to=ev.attendees, subject=message_subject("cancel", ev.title, when),
        body=compose_body("cancel", ev.title, when, ev.organizer, comment=note),
        ics=build_cancel_ics(ev, comment=note), uid=ev.uid)
    return _result("cancelled", ev, when, message_id)


def list_invites(client: Any, *, invite_id: Optional[str] = None, limit: int = SCAN_DEFAULT) -> dict:
    limit = min(max(int(limit or SCAN_DEFAULT), 1), SCAN_MAX)
    uid = (invite_id or "").strip() or None
    messages = _get_scanned(client, _scan_calls(client, limit, uid))
    state = derive_invite_state(messages, _fetch_calendars(client, messages), client.address)
    if uid:
        state = {key: [x for x in rows if x["invite_id"] == uid] for key, rows in state.items()}
    state["scanned"] = {"sent": sum(m["box"] == "sent" for m in messages),
                        "inbox": sum(m["box"] == "inbox" for m in messages)}
    return state


def _organizer_sent_by(ics: str) -> Optional[str]:
    line = next((x for x in re.sub(r"\r?\n[ \t]", "", ics).splitlines() if re.match(r"ORGANIZER[;:]", x, re.I)), "")
    m = re.search(r';SENT-BY="?(?:mailto:)?([^";:]+)"?', line, re.I)
    return m[1].strip().lower() if m else None


def _domain(address: Optional[str]) -> Optional[str]:
    if not address or address.count("@") != 1 or address.startswith("@") or address.endswith("@"):
        return None
    return address.split("@")[1]


def respond_to_invite(client: Any, message_id: str, response: str, *, note: Optional[str] = None) -> dict:
    if response not in RESPONSE_TO_PARTSTAT:
        raise ValueError("response must be accepted, declined or tentative.")
    check_length(note, MAX_COMMENT, "note")
    me = client.address.lower()
    calls = [["Email/get", {"accountId": client.account_id, "ids": [(message_id or "").strip()],
                            "properties": SCAN_PROPS, "bodyProperties": BODY_PROPS}, "g0"]]
    found = _get_scanned(client, calls)
    if not found:
        raise ValueError("message not found.")
    msg = found[0]
    if not msg["calendar_blob_id"]:
        raise ValueError("this message carries no calendar invitation.")
    ics = _fetch_calendars(client, [msg]).get(msg["calendar_blob_id"], "")
    parsed = parse_calendar(ics)
    invite = primary_event(parsed[1]) if parsed else None
    if not parsed or not invite:
        raise ValueError("the calendar part could not be read.")
    if parsed[0] != "REQUEST":
        raise ValueError(f"this message is a {parsed[0]}, not an invitation you can answer.")
    if not invite.organizer or invite.organizer["email"] == me:
        raise ValueError("you organize this meeting; there is nothing to answer.")
    listed = next((a for a in invite.attendees if a["email"] == me), None)
    if not listed:
        raise ValueError("this invitation does not list this inbox as a guest, so there is nothing to answer "
                         "(a reply would speak for an address it wasn't sent to).")
    sender = (msg["from"][0]["email"].lower() if msg["from"] else None)
    delegate = (_domain(sender) is not None and sender == _organizer_sent_by(ics)
                and _domain(sender) == _domain(invite.organizer["email"]))
    if sender != invite.organizer["email"] and not delegate:
        raise ValueError(f"the invitation names {invite.organizer['email']} as organizer but the email came from "
                         f"{sender or 'an unknown sender'}; not answering. Ask the user whether to reply by email "
                         "instead.")
    note = (note or "").strip() or None
    kind = {"accepted": "reply-accepted", "declined": "reply-declined"}.get(response, "reply-tentative")
    when = (format_when(invite.start, invite.end, invite.time_zone or "UTC", bool(invite.all_day_date))
            if invite.start and invite.end else "time not given")
    title = invite.title or "(no title)"
    responder = {"email": me, **({"name": listed["name"]} if listed.get("name") else {})}
    sent_id = send_calendar_message(
        client, to=[invite.organizer], subject=message_subject(kind, title, when),
        body=compose_body(kind, title, when, invite.organizer, responder=responder, comment=note),
        ics=build_reply_ics(invite, responder, RESPONSE_TO_PARTSTAT[response], comment=note),
        uid=invite.uid, in_reply_to=msg["message_id"])
    return {"status": "sent", "invite_id": invite.uid, "response": response,
            "organizer": invite.organizer["email"], "title": title, "message_id": sent_id}
