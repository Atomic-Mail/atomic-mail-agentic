// UTM install-attribution parsing (shared by the CLI + MCP register paths).
//
// A landing page bakes a URL-query-style UTM string into the copy-paste install
// snippet (CLI `--utm` flag / `ATOMICMAIL_UTM` env). On username signup the
// parsed fields ride along in the auth-service session-exchange body and the
// backend forwards them to PostHog. Parsing never throws: any problem yields an
// empty object so registration never fails over UTM.
/** Known UTM keys, in wire order. Everything else in the string is ignored. */
export const UTM_KEYS = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
];
/** Backend caps each value at 64 chars; we truncate client-side to match. */
export const UTM_MAX_VALUE_LENGTH = 64;
/**
 * Parse a URL-query-style UTM string (e.g.
 * `utm_source=blog&utm_medium=cpc&utm_campaign=launch`) into the five known
 * `utm_*` fields. Unknown keys are ignored, each value is truncated to 64
 * chars, and empty values are dropped. Never throws — any parse problem (or an
 * empty/garbage input) yields an empty object.
 */
export function parseUtm(raw) {
    if (!raw)
        return {};
    try {
        const params = new URLSearchParams(raw);
        const out = {};
        for (const key of UTM_KEYS) {
            const value = params.get(key);
            if (value === null)
                continue;
            const truncated = value.slice(0, UTM_MAX_VALUE_LENGTH);
            if (truncated.length === 0)
                continue;
            out[key] = truncated;
        }
        return out;
    }
    catch {
        return {};
    }
}
/** True when the parsed UTM object carries at least one field. */
export function hasUtm(utm) {
    return !!utm && Object.keys(utm).length > 0;
}
