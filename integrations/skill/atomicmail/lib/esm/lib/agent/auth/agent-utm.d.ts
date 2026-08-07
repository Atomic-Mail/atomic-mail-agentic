/** The five UTM fields forwarded to the backend on username signup. */
export interface UtmParams {
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_term?: string;
    utm_content?: string;
}
/** Known UTM keys, in wire order. Everything else in the string is ignored. */
export declare const UTM_KEYS: readonly ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
/** Backend caps each value at 64 chars; we truncate client-side to match. */
export declare const UTM_MAX_VALUE_LENGTH = 64;
/**
 * Parse a URL-query-style UTM string (e.g.
 * `utm_source=blog&utm_medium=cpc&utm_campaign=launch`) into the five known
 * `utm_*` fields. Unknown keys are ignored, each value is truncated to 64
 * chars, and empty values are dropped. Never throws — any parse problem (or an
 * empty/garbage input) yields an empty object.
 */
export declare function parseUtm(raw: string | undefined | null): UtmParams;
/** True when the parsed UTM object carries at least one field. */
export declare function hasUtm(utm: UtmParams | undefined | null): utm is UtmParams;
//# sourceMappingURL=agent-utm.d.ts.map