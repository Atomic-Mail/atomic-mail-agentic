// iCalendar (RFC 5545) building and parsing for meeting invitations sent and
// received by email (iMIP, RFC 6047; iTIP methods, RFC 5546). Pure, no
// dependencies, no I/O — the same file is carried by the client repo.
//
// Scope is what invitations need, not a general calendar library:
//   - build: one VEVENT per VCALENDAR, times in UTC (no VTIMEZONE needed),
//     all-day events as VALUE=DATE;
//   - parse: tolerant of what Google, Outlook/Exchange and Apple send — folded
//     lines, quoted parameters, TZID times (IANA names, Windows names, or a
//     VTIMEZONE with yearly RRULEs), all-day dates, DURATION instead of DTEND.
// Recurrence rules are reported (`recurring: true`) but never expanded.
// ---------------------------------------------------------------------------
// TEXT escaping (RFC 5545 §3.3.11)
// ---------------------------------------------------------------------------
export function escapeText(text) {
    return text
        .replace(/\\/g, "\\\\")
        .replace(/;/g, "\\;")
        .replace(/,/g, "\\,")
        .replace(/\r\n|\r|\n/g, "\\n");
}
export function unescapeText(text) {
    return text.replace(/\\([\\;,nN])/g, (_m, c) => {
        if (c === "n" || c === "N")
            return "\n";
        return c;
    });
}
// ---------------------------------------------------------------------------
// Content lines: folding (§3.1) and parsing
// ---------------------------------------------------------------------------
const encoder = new TextEncoder();
/**
 * Fold one content line into CRLF-terminated physical lines of at most 75
 * octets, never splitting a UTF-8 sequence. Continuation lines start with a
 * single space, which counts toward their 75.
 */
export function foldLine(line) {
    if (encoder.encode(line).length <= 75)
        return line + "\r\n";
    const out = [];
    let current = "";
    let currentBytes = 0;
    let limit = 75;
    for (const ch of line) {
        const n = encoder.encode(ch).length;
        if (currentBytes + n > limit) {
            out.push(current);
            current = "";
            currentBytes = 0;
            limit = 74; // the leading space takes one octet
        }
        current += ch;
        currentBytes += n;
    }
    out.push(current);
    return out.map((l, i) => (i === 0 ? l : " " + l)).join("\r\n") + "\r\n";
}
/** Split text into logical (unfolded) content lines, dropping empty ones. */
export function unfoldLines(text) {
    return text
        .replace(/\r\n|\r/g, "\n")
        .replace(/\n[ \t]/g, "")
        .split("\n")
        .filter((l) => l.trim().length > 0);
}
function needsQuoting(value) {
    return /[:;,]/.test(value);
}
/** Parameter values may not contain DQUOTE; quote when they hold : ; or ,. */
function formatParamValue(value) {
    const clean = value.replace(/["\r\n]/g, "");
    return needsQuoting(clean) ? `"${clean}"` : clean;
}
export function formatProperty(name, params, value) {
    let head = name;
    for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === "")
            continue;
        head += `;${k}=${formatParamValue(v)}`;
    }
    return foldLine(`${head}:${value}`);
}
/**
 * Parse one unfolded content line. Returns null for lines that are not
 * `name[;params]:value`. Quoted parameter values may contain `:` `;` `,`.
 */
export function parseContentLine(line) {
    let i = 0;
    const len = line.length;
    while (i < len && line[i] !== ";" && line[i] !== ":")
        i++;
    if (i === 0 || i >= len)
        return null;
    const name = line.slice(0, i).trim().toUpperCase();
    const params = {};
    while (i < len && line[i] === ";") {
        i++;
        const eq = line.indexOf("=", i);
        if (eq < 0)
            return null;
        const pname = line.slice(i, eq).trim().toUpperCase();
        i = eq + 1;
        const values = [];
        for (;;) {
            let v = "";
            if (line[i] === '"') {
                const close = line.indexOf('"', i + 1);
                if (close < 0)
                    return null;
                v = line.slice(i + 1, close);
                i = close + 1;
            }
            else {
                const start = i;
                while (i < len && line[i] !== "," && line[i] !== ";" && line[i] !== ":") {
                    i++;
                }
                v = line.slice(start, i);
            }
            values.push(v);
            if (line[i] === ",") {
                i++;
                continue;
            }
            break;
        }
        params[pname] = values.join(",");
    }
    if (line[i] !== ":")
        return null;
    return { name, params, value: line.slice(i + 1) };
}
/**
 * Parse iCalendar text into its first VCALENDAR component. Lines outside any
 * component and unparsable lines are skipped. Returns null when no VCALENDAR
 * is found.
 */
export function parseIcal(text) {
    const stack = [];
    let root = null;
    for (const line of unfoldLines(text)) {
        const prop = parseContentLine(line);
        if (!prop)
            continue;
        if (prop.name === "BEGIN") {
            const comp = {
                name: prop.value.trim().toUpperCase(),
                props: [],
                components: [],
            };
            if (stack.length > 0)
                stack[stack.length - 1].components.push(comp);
            else if (comp.name === "VCALENDAR" && !root)
                root = comp;
            else
                continue; // stray top-level component that is not a VCALENDAR
            stack.push(comp);
            continue;
        }
        if (prop.name === "END") {
            const top = stack.pop();
            if (top === root)
                break;
            continue;
        }
        if (stack.length > 0)
            stack[stack.length - 1].props.push(prop);
    }
    return root;
}
export function getProp(comp, name) {
    return comp.props.find((p) => p.name === name);
}
export function getProps(comp, name) {
    return comp.props.filter((p) => p.name === name);
}
export function getText(comp, name) {
    const p = getProp(comp, name);
    return p ? unescapeText(p.value) : undefined;
}
// ---------------------------------------------------------------------------
// Date-times
// ---------------------------------------------------------------------------
const pad2 = (n) => String(n).padStart(2, "0");
/** `20261016T120000Z` */
export function formatUtc(date) {
    return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`;
}
/** `20261016` — a VALUE=DATE value, from the UTC calendar date of `date`. */
export function formatDate(date) {
    return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}`;
}
const dtfCache = new Map();
function zoneFormatter(tz) {
    let dtf = dtfCache.get(tz);
    if (!dtf) {
        dtf = new Intl.DateTimeFormat("en-US", {
            timeZone: tz,
            hourCycle: "h23",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
        dtfCache.set(tz, dtf);
    }
    return dtf;
}
/** True when `tz` is an IANA time zone name this runtime knows. */
export function isValidTimeZone(tz) {
    if (!tz || tz.length > 64)
        return false;
    try {
        zoneFormatter(tz);
        return true;
    }
    catch {
        return false;
    }
}
/** Offset of `tz` from UTC at the instant `utcMs`, in milliseconds. */
export function zoneOffsetMs(utcMs, tz) {
    const parts = {};
    for (const p of zoneFormatter(tz).formatToParts(new Date(utcMs))) {
        parts[p.type] = p.value;
    }
    const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    return asUtc - Math.floor(utcMs / 1000) * 1000;
}
/**
 * The UTC instant of a wall-clock time in `tz`. In an overlap (clocks go
 * back) the first occurrence wins; in a gap (clocks jump forward, the reading
 * does not exist) the time moves forward by the jump, like most calendars do.
 */
export function zonedWallTimeToUtc(w, tz) {
    const guess = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
    const halfDay = 12 * 60 * 60_000;
    const offsets = [
        ...new Set([
            zoneOffsetMs(guess - halfDay, tz),
            zoneOffsetMs(guess, tz),
            zoneOffsetMs(guess + halfDay, tz),
        ]),
    ];
    const consistent = offsets
        .map((off) => guess - off)
        .filter((t) => guess - t === zoneOffsetMs(t, tz));
    if (consistent.length > 0)
        return new Date(Math.min(...consistent));
    // Gap: apply the offset in force before the jump.
    return new Date(guess - Math.min(...offsets));
}
// Windows time zone names Outlook/Exchange put in TZID, mapped to IANA. The
// VTIMEZONE in the same object is the fallback for names not listed here.
const WINDOWS_ZONES = {
    "UTC": "UTC",
    "Coordinated Universal Time": "UTC",
    "GMT Standard Time": "Europe/London",
    "Greenwich Standard Time": "Atlantic/Reykjavik",
    "W. Europe Standard Time": "Europe/Berlin",
    "Central Europe Standard Time": "Europe/Budapest",
    "Central European Standard Time": "Europe/Warsaw",
    "Romance Standard Time": "Europe/Paris",
    "E. Europe Standard Time": "Europe/Chisinau",
    "FLE Standard Time": "Europe/Kiev",
    "GTB Standard Time": "Europe/Bucharest",
    "Kaliningrad Standard Time": "Europe/Kaliningrad",
    "Russian Standard Time": "Europe/Moscow",
    "Belarus Standard Time": "Europe/Minsk",
    "Turkey Standard Time": "Europe/Istanbul",
    "Russia Time Zone 3": "Europe/Samara",
    "Ekaterinburg Standard Time": "Asia/Yekaterinburg",
    "N. Central Asia Standard Time": "Asia/Novosibirsk",
    "North Asia Standard Time": "Asia/Krasnoyarsk",
    "North Asia East Standard Time": "Asia/Irkutsk",
    "Yakutsk Standard Time": "Asia/Yakutsk",
    "Vladivostok Standard Time": "Asia/Vladivostok",
    "Georgian Standard Time": "Asia/Tbilisi",
    "Caucasus Standard Time": "Asia/Yerevan",
    "Azerbaijan Standard Time": "Asia/Baku",
    "West Asia Standard Time": "Asia/Tashkent",
    "Central Asia Standard Time": "Asia/Almaty",
    "Israel Standard Time": "Asia/Jerusalem",
    "Arabian Standard Time": "Asia/Dubai",
    "Arab Standard Time": "Asia/Riyadh",
    "Iran Standard Time": "Asia/Tehran",
    "Pakistan Standard Time": "Asia/Karachi",
    "India Standard Time": "Asia/Kolkata",
    "Bangladesh Standard Time": "Asia/Dhaka",
    "SE Asia Standard Time": "Asia/Bangkok",
    "China Standard Time": "Asia/Shanghai",
    "Taipei Standard Time": "Asia/Taipei",
    "Singapore Standard Time": "Asia/Singapore",
    "Korea Standard Time": "Asia/Seoul",
    "Tokyo Standard Time": "Asia/Tokyo",
    "AUS Eastern Standard Time": "Australia/Sydney",
    "New Zealand Standard Time": "Pacific/Auckland",
    "Egypt Standard Time": "Africa/Cairo",
    "South Africa Standard Time": "Africa/Johannesburg",
    "E. South America Standard Time": "America/Sao_Paulo",
    "Argentina Standard Time": "America/Buenos_Aires",
    "SA Pacific Standard Time": "America/Bogota",
    "Atlantic Standard Time": "America/Halifax",
    "Eastern Standard Time": "America/New_York",
    "Central Standard Time": "America/Chicago",
    "Canada Central Standard Time": "America/Regina",
    "Mountain Standard Time": "America/Denver",
    "US Mountain Standard Time": "America/Phoenix",
    "Pacific Standard Time": "America/Los_Angeles",
    "Alaskan Standard Time": "America/Anchorage",
    "Hawaiian Standard Time": "Pacific/Honolulu",
};
/** Map a TZID to an IANA zone when possible ("/mozilla.org/.../Europe/Berlin" too). */
export function tzidToIana(tzid) {
    const t = tzid.trim();
    if (isValidTimeZone(t))
        return t;
    // Own keys only: `TZID=toString` must not reach Object.prototype.
    if (Object.hasOwn(WINDOWS_ZONES, t))
        return WINDOWS_ZONES[t];
    const m = t.match(/([A-Za-z_]+\/[A-Za-z_+\-]+(?:\/[A-Za-z_+\-]+)?)$/);
    if (m && isValidTimeZone(m[1]))
        return m[1];
    return null;
}
function parseBasicDateTime(value) {
    const m = value.trim().match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/i);
    if (!m)
        return null;
    return {
        y: Number(m[1]),
        mo: Number(m[2]),
        d: Number(m[3]),
        h: Number(m[4]),
        mi: Number(m[5]),
        s: Number(m[6] ?? "0"),
        utc: Boolean(m[7]),
    };
}
function parseOffset(value) {
    const m = value.trim().match(/^([+-])(\d{2})(\d{2})(\d{2})?$/);
    if (!m)
        return null;
    const sign = m[1] === "-" ? -1 : 1;
    return sign *
        ((Number(m[2]) * 60 + Number(m[3])) * 60 + Number(m[4] ?? "0")) * 1000;
}
const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
/** Day of month for e.g. `2SU` / `-1SU` in a month (1-based month). */
function nthWeekdayOfMonth(y, mo, nth, weekday) {
    const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    if (nth > 0) {
        const first = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();
        const day = 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7;
        return day <= daysInMonth ? day : null;
    }
    const last = new Date(Date.UTC(y, mo - 1, daysInMonth)).getUTCDay();
    const day = daysInMonth - ((last - weekday + 7) % 7) + (nth + 1) * 7;
    return day >= 1 ? day : null;
}
/**
 * Onsets (as local wall-clock ms, i.e. Date.UTC of the local reading) of one
 * STANDARD/DAYLIGHT observance in `year`, from its DTSTART and an optional
 * yearly RRULE (BYMONTH + BYDAY or BYMONTHDAY) or RDATEs.
 */
function observanceOnsets(obs, year) {
    const dtstart = parseBasicDateTime(getProp(obs, "DTSTART")?.value ?? "");
    if (!dtstart)
        return [];
    const startMs = Date.UTC(dtstart.y, dtstart.mo - 1, dtstart.d, dtstart.h, dtstart.mi, dtstart.s);
    const out = [];
    const rrule = getProp(obs, "RRULE")?.value;
    if (rrule) {
        const parts = {};
        for (const kv of rrule.split(";")) {
            const [k, v] = kv.split("=");
            if (k && v)
                parts[k.toUpperCase()] = v.toUpperCase();
        }
        if (parts.FREQ === "YEARLY") {
            const month = Number(parts.BYMONTH ?? dtstart.mo);
            let day = null;
            const byday = parts.BYDAY?.match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
            if (byday) {
                const nth = byday[1] ? Number(byday[1]) : 1;
                day = nthWeekdayOfMonth(year, month, nth, WEEKDAYS.indexOf(byday[2]));
            }
            else if (parts.BYMONTHDAY) {
                day = Number(parts.BYMONTHDAY);
            }
            else {
                day = dtstart.d;
            }
            if (day !== null) {
                const ms = Date.UTC(year, month - 1, day, dtstart.h, dtstart.mi, dtstart.s);
                const until = parts.UNTIL ? parseBasicDateTime(parts.UNTIL) : null;
                const untilMs = until
                    ? Date.UTC(until.y, until.mo - 1, until.d, until.h, until.mi, until.s)
                    : Infinity;
                if (ms >= startMs && ms <= untilMs)
                    out.push(ms);
            }
        }
    }
    else if (dtstart.y === year) {
        out.push(startMs);
    }
    for (const rdate of getProps(obs, "RDATE")) {
        for (const v of rdate.value.split(",")) {
            const r = parseBasicDateTime(v);
            if (r && r.y === year) {
                out.push(Date.UTC(r.y, r.mo - 1, r.d, r.h, r.mi, r.s));
            }
        }
    }
    return out;
}
/** UTC offset (ms) a VTIMEZONE applies to a local wall-clock reading. */
function vtimezoneOffsetMs(vtz, wall) {
    const localMs = Date.UTC(wall.y, wall.mo - 1, wall.d, wall.h, wall.mi, wall.s);
    let best = null;
    let earliest = null;
    for (const obs of vtz.components) {
        if (obs.name !== "STANDARD" && obs.name !== "DAYLIGHT")
            continue;
        const offset = parseOffset(getProp(obs, "TZOFFSETTO")?.value ?? "");
        if (offset === null)
            continue;
        for (const year of [wall.y - 1, wall.y]) {
            for (const onset of observanceOnsets(obs, year)) {
                if (onset <= localMs && (!best || onset > best.onset)) {
                    best = { onset, offset };
                }
                if (!earliest || onset < earliest.onset)
                    earliest = { onset, offset };
            }
        }
        if (!getProp(obs, "RRULE") && getProp(obs, "DTSTART")) {
            // A single-onset observance older than last year still applies.
            const d = parseBasicDateTime(getProp(obs, "DTSTART").value);
            if (d) {
                const onset = Date.UTC(d.y, d.mo - 1, d.d, d.h, d.mi, d.s);
                if (onset <= localMs && (!best || onset > best.onset)) {
                    best = { onset, offset };
                }
            }
        }
    }
    return (best ?? earliest)?.offset ?? null;
}
/**
 * Resolve a DTSTART/DTEND/RECURRENCE-ID property. `vtimezones` maps TZID →
 * VTIMEZONE component from the same object.
 */
/** Does y-mo-d exist (no February 31 silently rolling into March)? */
export function isRealDate(y, mo, d) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31)
        return false;
    const t = new Date(Date.UTC(y, mo - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 &&
        t.getUTCDate() === d;
}
export function parseTimeProp(prop, vtimezones) {
    const value = prop.value.trim();
    const dateOnly = value.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (prop.params.VALUE === "DATE" || dateOnly) {
        if (!dateOnly ||
            !isRealDate(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3])))
            return { instant: null };
        return {
            instant: new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))),
            date: `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`,
        };
    }
    const dt = parseBasicDateTime(value);
    // Date.UTC would roll an impossible date or time over (Feb 31 → Mar 3).
    if (!dt || !isRealDate(dt.y, dt.mo, dt.d) || dt.h > 23 || dt.mi > 59 ||
        dt.s > 60)
        return { instant: null };
    if (dt.utc) {
        return {
            instant: new Date(Date.UTC(dt.y, dt.mo - 1, dt.d, dt.h, dt.mi, dt.s)),
        };
    }
    const tzid = prop.params.TZID;
    if (tzid) {
        const vtz = vtimezones.get(tzid);
        const iana = tzidToIana(tzid);
        if (iana) {
            return { instant: zonedWallTimeToUtc(dt, iana), tzid, timeZone: iana };
        }
        if (vtz) {
            const off = vtimezoneOffsetMs(vtz, dt);
            if (off !== null) {
                const local = Date.UTC(dt.y, dt.mo - 1, dt.d, dt.h, dt.mi, dt.s);
                return { instant: new Date(local - off), tzid };
            }
        }
        return {
            instant: new Date(Date.UTC(dt.y, dt.mo - 1, dt.d, dt.h, dt.mi, dt.s)),
            tzid,
            assumedUtc: true,
        };
    }
    // Floating time: no zone at all. Treat as UTC and say so.
    return {
        instant: new Date(Date.UTC(dt.y, dt.mo - 1, dt.d, dt.h, dt.mi, dt.s)),
        assumedUtc: true,
    };
}
/** ISO 8601 duration (`PT30M`, `P1D`, `-PT15M`) in ms, or null. */
export function parseDurationMs(value) {
    const m = value.trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
    if (!m || value.trim() === "P" || value.trim().endsWith("T"))
        return null;
    const sign = m[1] === "-" ? -1 : 1;
    const [w, d, h, mi, s] = [m[2], m[3], m[4], m[5], m[6]].map((x) => Number(x ?? "0"));
    const ms = sign * ((((w * 7 + d) * 24 + h) * 60 + mi) * 60 + s) * 1000;
    // A huge DURATION from someone else's invitation must not become an
    // Invalid Date that throws later; 8.64e15 ms is the Date range limit.
    return Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? ms : null;
}
/** Collect a VCALENDAR's VTIMEZONEs by TZID. */
export function collectTimeZones(cal) {
    const map = new Map();
    for (const c of cal.components) {
        if (c.name !== "VTIMEZONE")
            continue;
        const id = getProp(c, "TZID")?.value.trim();
        if (id)
            map.set(id, c);
    }
    return map;
}
// ---------------------------------------------------------------------------
// Calendar user addresses
// ---------------------------------------------------------------------------
/** `mailto:Anna@Example.com` → `anna@example.com`; null when not a mailto. */
export function mailtoToEmail(value) {
    const v = value.trim();
    const m = v.match(/^mailto:(.+)$/i);
    const addr = (m ? m[1] : v).trim();
    if (!/^[^\s@]+@[^\s@]+$/.test(addr))
        return null;
    return addr.toLowerCase();
}
export function emailToMailto(email) {
    return `mailto:${email.trim()}`;
}
