// JWT helpers for capability/session expiry checks.

export const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
export const CAPABILITY_TTL_MS = 2 * 60 * 1000;

export const SESSION_SAFETY_MARGIN_MS = 60_000;
export const CAPABILITY_SAFETY_MARGIN_MS = 20_000;

export interface JwtPayload {
  exp?: number;
  iat?: number;
  jti?: string;
  inboxId?: string;
  [key: string]: unknown;
}

export function decodeJwtPayload<T = JwtPayload>(jwt: string): T {
  const parts = jwt.split(".");
  if (parts.length < 2) {
    throw new Error(
      "Malformed JWT: expected at least 2 dot-separated segments.",
    );
  }
  const payloadB64Url = parts[1];
  const padLen = (4 - (payloadB64Url.length % 4)) % 4;
  const base64 = payloadB64Url
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(payloadB64Url.length + padLen, "=");
  return JSON.parse(atob(base64)) as T;
}

export function isJwtExpired(jwt: string, marginMs: number): boolean {
  try {
    const { exp } = decodeJwtPayload<JwtPayload>(jwt);
    if (typeof exp !== "number") return true;
    return Date.now() >= exp * 1000 - marginMs;
  } catch {
    return true;
  }
}
