// auth-service HTTP: challenge → session → capability.

import { decodeJwtPayload } from "./agent-jwt.ts";
import { solvePow } from "./agent-pow.ts";

export async function fetchChallenge(authUrl: string): Promise<{
  challengeJWT: string;
  challenge: string;
  difficulty: number;
}> {
  const res = await fetch(`${authUrl}/api/v1/challenge`, {
    method: "POST",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `auth-service /api/v1/challenge returned ${res.status}: ${text}`,
    );
  }
  const challengeJWT = readBearerToken(
    res.headers.get("Authorization"),
    "Challenge response missing Authorization bearer token.",
  );
  const payload = decodeJwtPayload<{ jti?: string; difficulty?: number }>(
    challengeJWT,
  );
  if (
    typeof payload.jti !== "string" ||
    typeof payload.difficulty !== "number"
  ) {
    throw new Error(
      "Challenge JWT payload malformed (missing jti or difficulty).",
    );
  }
  return {
    challengeJWT,
    challenge: payload.jti,
    difficulty: payload.difficulty,
  };
}

export interface SessionResponse {
  sessionJWT: string;
  apiKey?: string;
}

export async function exchangeSession(
  authUrl: string,
  body: {
    challengeJWT: string;
    powHex: string;
    nonce: string;
    apiKey?: string;
    username?: string;
  },
): Promise<SessionResponse> {
  const { challengeJWT, ...payload } = body;
  const res = await fetch(`${authUrl}/api/v1/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${challengeJWT}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`auth-service /api/v1/session returned ${res.status}: ${text}`);
  }
  const sessionJWT = readBearerToken(
    res.headers.get("Authorization"),
    "Session response missing Authorization bearer token.",
  );
  let data: Record<string, unknown> = {};
  if (text.trim().length > 0) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error("auth-service /api/v1/session returned non-JSON body.");
    }
  }
  return {
    sessionJWT,
    apiKey: typeof data.apiKey === "string" ? data.apiKey : undefined,
  };
}

export async function fetchCapability(
  authUrl: string,
  sessionJWT: string,
): Promise<string> {
  const res = await fetch(`${authUrl}/api/v1/capability`, {
    method: "POST",
    headers: { Authorization: `Bearer ${sessionJWT}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `auth-service /api/v1/capability returned ${res.status}: ${text}`,
    );
  }
  return readBearerToken(
    res.headers.get("Authorization"),
    "Capability response missing Authorization bearer token.",
  );
}

export interface PerformPoWInput {
  authUrl: string;
  scryptSalt: string;
  apiKey?: string;
  username?: string;
  onPowProgress?: (nonce: bigint) => void;
}

export async function performPoWAndSession(
  input: PerformPoWInput,
): Promise<SessionResponse> {
  const { authUrl, scryptSalt } = input;
  const { challengeJWT, challenge, difficulty } = await fetchChallenge(authUrl);
  const { powHex, nonce } = await solvePow(
    challenge,
    difficulty,
    scryptSalt,
    input.onPowProgress,
  );
  return exchangeSession(authUrl, {
    challengeJWT,
    powHex,
    nonce,
    apiKey: input.apiKey,
    username: input.username,
  });
}

function readBearerToken(
  headerValue: string | null,
  missingError: string,
): string {
  if (!headerValue) {
    throw new Error(missingError);
  }
  const match = /^\s*Bearer\s+(.+?)\s*$/i.exec(headerValue);
  if (!match || !match[1]) {
    throw new Error("Authorization header must use Bearer scheme.");
  }
  return match[1];
}
