export interface IcalProperty {
    /** Upper-cased property name, e.g. `DTSTART`. */
    name: string;
    /** Upper-cased parameter names; values unquoted, multi-values comma-joined. */
    params: Record<string, string>;
    /** Raw (still escaped) value. Use `unescapeText` for TEXT values. */
    value: string;
}
export interface IcalComponent {
    /** Upper-cased component name, e.g. `VEVENT`. */
    name: string;
    props: IcalProperty[];
    components: IcalComponent[];
}
export declare function escapeText(text: string): string;
export declare function unescapeText(text: string): string;
/**
 * Fold one content line into CRLF-terminated physical lines of at most 75
 * octets, never splitting a UTF-8 sequence. Continuation lines start with a
 * single space, which counts toward their 75.
 */
export declare function foldLine(line: string): string;
/** Split text into logical (unfolded) content lines, dropping empty ones. */
export declare function unfoldLines(text: string): string[];
export declare function formatProperty(name: string, params: Record<string, string | undefined>, value: string): string;
/**
 * Parse one unfolded content line. Returns null for lines that are not
 * `name[;params]:value`. Quoted parameter values may contain `:` `;` `,`.
 */
export declare function parseContentLine(line: string): IcalProperty | null;
/**
 * Parse iCalendar text into its first VCALENDAR component. Lines outside any
 * component and unparsable lines are skipped. Returns null when no VCALENDAR
 * is found.
 */
export declare function parseIcal(text: string): IcalComponent | null;
export declare function getProp(comp: IcalComponent, name: string): IcalProperty | undefined;
export declare function getProps(comp: IcalComponent, name: string): IcalProperty[];
export declare function getText(comp: IcalComponent, name: string): string | undefined;
/** `20261016T120000Z` */
export declare function formatUtc(date: Date): string;
/** `20261016` — a VALUE=DATE value, from the UTC calendar date of `date`. */
export declare function formatDate(date: Date): string;
interface WallTime {
    y: number;
    mo: number;
    d: number;
    h: number;
    mi: number;
    s: number;
}
/** True when `tz` is an IANA time zone name this runtime knows. */
export declare function isValidTimeZone(tz: string): boolean;
/** Offset of `tz` from UTC at the instant `utcMs`, in milliseconds. */
export declare function zoneOffsetMs(utcMs: number, tz: string): number;
/**
 * The UTC instant of a wall-clock time in `tz`. In an overlap (clocks go
 * back) the first occurrence wins; in a gap (clocks jump forward, the reading
 * does not exist) the time moves forward by the jump, like most calendars do.
 */
export declare function zonedWallTimeToUtc(w: WallTime, tz: string): Date;
/** Map a TZID to an IANA zone when possible ("/mozilla.org/.../Europe/Berlin" too). */
export declare function tzidToIana(tzid: string): string | null;
export interface ParsedTime {
    /** The instant, when it could be resolved (UTC, offset or known zone). */
    instant: Date | null;
    /** `YYYY-MM-DD` for VALUE=DATE (all-day) values. */
    date?: string;
    /** The TZID as given, if any. */
    tzid?: string;
    /** IANA zone the TZID resolved to, if any. */
    timeZone?: string;
    /** True when a local time could not be anchored and UTC was assumed. */
    assumedUtc?: boolean;
}
/**
 * Resolve a DTSTART/DTEND/RECURRENCE-ID property. `vtimezones` maps TZID →
 * VTIMEZONE component from the same object.
 */
/** Does y-mo-d exist (no February 31 silently rolling into March)? */
export declare function isRealDate(y: number, mo: number, d: number): boolean;
export declare function parseTimeProp(prop: IcalProperty, vtimezones: Map<string, IcalComponent>): ParsedTime;
/** ISO 8601 duration (`PT30M`, `P1D`, `-PT15M`) in ms, or null. */
export declare function parseDurationMs(value: string): number | null;
/** Collect a VCALENDAR's VTIMEZONEs by TZID. */
export declare function collectTimeZones(cal: IcalComponent): Map<string, IcalComponent>;
/** `mailto:Anna@Example.com` → `anna@example.com`; null when not a mailto. */
export declare function mailtoToEmail(value: string): string | null;
export declare function emailToMailto(email: string): string;
export {};
//# sourceMappingURL=ical.d.ts.map