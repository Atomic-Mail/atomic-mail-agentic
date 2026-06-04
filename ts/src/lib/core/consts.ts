/**
 * Fixed proof-of-work scrypt salt. The auth-service passes this string (UTF-8
 * bytes of the hex text, not decoded binary) to `scrypt` as the `salt`
 * argument; all PoW clients must use the same value.
 */
export const DEFAULT_POW_SCRYPT_SALT_HEX =
  "0b980734412c292d6549110276b604ab1dea4883bd460d77d1b984adf8bca083";

/** Production auth-service base URL when unset in env and credentials.json. */
export const DEFAULT_AUTH_URL = "https://auth.atomicmail.ai";

/** Production JMAP / API base URL when unset in env and credentials.json. */
export const DEFAULT_API_URL = "https://api.atomicmail.ai";

export const ONE_SEC_MS = 1000;
export const ONE_MIN_MS = ONE_SEC_MS * 60;
export const ONE_HOUR_MS = ONE_MIN_MS * 60;
export const ONE_DAY_MS = ONE_HOUR_MS * 24;
export const ONE_MONTH_MS = ONE_DAY_MS * 30;
export const ONE_YEAR_MS = ONE_DAY_MS * 365;
