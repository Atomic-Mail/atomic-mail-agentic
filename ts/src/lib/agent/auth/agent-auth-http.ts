// auth-service HTTP: challenge → session → capability.

import { decodeJwtPayload } from "./agent-jwt.ts";
import { solvePow } from "./agent-pow.ts";

async function postJson(
  url: string,
  body: Record<string, unknown> | undefined,
  headers: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();
  if (!res.ok) {
    throw new Error(`auth-service ${path} returned ${res.status}: ${text}`);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`auth-service ${path} returned non-JSON body: ${text}`);
  }
}

export async function fetchChallenge(authUrl: string): Promise<{
  challengeJWT: string;
  challenge: string;
  difficulty: number;
}> {
  const data = await postJson(`${authUrl}/api/v1/challenge`, undefined);
  if (typeof data.challengeJWT !== "string") {
    throw new Error("Challenge response missing challengeJWT.");
  }
  const payload = decodeJwtPayload<{ jti?: string; difficulty?: number }>(
    data.challengeJWT,
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
    challengeJWT: data.challengeJWT,
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
  const data = await postJson(`${authUrl}/api/v1/session`, { ...body });
  if (typeof data.sessionJWT !== "string") {
    throw new Error("Session response missing sessionJWT.");
  }
  return {
    sessionJWT: data.sessionJWT,
    apiKey: typeof data.apiKey === "string" ? data.apiKey : undefined,
  };
}

export async function fetchCapability(
  authUrl: string,
  sessionJWT: string,
): Promise<string> {
  const data = await postJson(
    `${authUrl}/api/v1/capability`,
    undefined,
    { Authorization: `Bearer ${sessionJWT}` },
  );
  if (typeof data.capabilityJWT !== "string") {
    throw new Error("Capability response missing capabilityJWT.");
  }
  return data.capabilityJWT;
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
