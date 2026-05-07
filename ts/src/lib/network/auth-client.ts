// auth-client
//
// Thin HTTP client for services/auth-service. Encapsulates the full PoW
// challenge → session → capability flow so callers (integration tests, the
// future agent skill, etc.) don't have to reimplement scrypt grinding.
//
// The PoW digest is scrypt-based and uses the SAME salt the auth-service
// uses on the verify path (see services/auth-service/src/crypto.ts). The
// client must therefore be configured with that salt — there is no public
// hash function here, the salt is part of the protocol.

import { scrypt } from "node:crypto";

import { DEFAULT_POW_SCRYPT_SALT_HEX } from "../core/consts.ts";

// Mirror services/auth-service/src/crypto.ts exactly. Changing any of these
// constants on either side breaks PoW interop.
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const POW_HASH_BYTES = 64;

export interface AuthClientOptions {
  /** Base URL of auth-service, e.g. "http://localhost:8000". Trailing slashes are stripped. */
  baseUrl: string;
  /**
   * PoW scrypt salt (hex string). When omitted, {@link DEFAULT_POW_SCRYPT_SALT_HEX}
   * is used so clients match the bundled auth-service.
   */
  scryptSaltHex?: string;
}

export interface SignupResult {
  /** Freshly minted API key. The server only returns it once — persist it. */
  apiKey: string;
  sessionJWT: string;
}

export interface LoginResult {
  sessionJWT: string;
}

export interface RenewResult {
  capabilityJWT: string;
}

/** Thrown for any non-2xx HTTP response or malformed payload. */
export class AuthClientError extends Error {
  status: number;
  bodyText: string;

  constructor(status: number, bodyText: string, message: string) {
    super(message);
    this.name = "AuthClientError";
    this.status = status;
    this.bodyText = bodyText;
  }
}

interface ChallengePayload {
  jti: string;
  difficulty: number;
}

export class AuthClient {
  private readonly baseUrl: string;
  private readonly scryptSaltHex: string;

  constructor(options: AuthClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.scryptSaltHex = options.scryptSaltHex ?? DEFAULT_POW_SCRYPT_SALT_HEX;
  }

  /**
   * Register a new inbox under `username`. Returns the freshly minted API key
   * (the server only ever returns it once — the caller MUST persist it) and
   * a session JWT.
   */
  async signup(username: string): Promise<SignupResult> {
    const { challengeJWT, challenge, difficulty } = await this.fetchChallenge();
    const { powHex, nonce } = await this.solvePoW(challenge, difficulty);

    const data = await this.postSession({
      challengeJWT,
      powHex,
      nonce: nonce.toString(),
      username,
    });

    if (
      typeof data.apiKey !== "string" ||
      typeof data.sessionJWT !== "string"
    ) {
      throw new AuthClientError(
        200,
        JSON.stringify(data),
        "Signup response missing apiKey or sessionJWT.",
      );
    }
    return { apiKey: data.apiKey, sessionJWT: data.sessionJWT };
  }

  /** Exchange an existing API key for a fresh session JWT. */
  async login(apiKey: string): Promise<LoginResult> {
    const { challengeJWT, challenge, difficulty } = await this.fetchChallenge();
    const { powHex, nonce } = await this.solvePoW(challenge, difficulty);

    const data = await this.postSession({
      challengeJWT,
      powHex,
      nonce: nonce.toString(),
      apiKey,
    });

    if (typeof data.sessionJWT !== "string") {
      throw new AuthClientError(
        200,
        JSON.stringify(data),
        "Login response missing sessionJWT.",
      );
    }
    return { sessionJWT: data.sessionJWT };
  }

  /**
   * Exchange a session JWT for a short-lived capability JWT (audience:
   * api-service).
   */
  async renew(sessionJWT: string): Promise<RenewResult> {
    const res = await fetch(`${this.baseUrl}/api/v1/capability`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sessionJWT}` },
    });
    const data = await this.parseJsonOrThrow(res, "capability");
    if (typeof data.capabilityJWT !== "string") {
      throw new AuthClientError(
        res.status,
        JSON.stringify(data),
        "Capability response missing capabilityJWT.",
      );
    }
    return { capabilityJWT: data.capabilityJWT };
  }

  private async fetchChallenge(): Promise<{
    challengeJWT: string;
    challenge: string;
    difficulty: number;
  }> {
    const res = await fetch(`${this.baseUrl}/api/v1/challenge`, {
      method: "POST",
    });
    const data = await this.parseJsonOrThrow(res, "challenge");
    if (typeof data.challengeJWT !== "string") {
      throw new AuthClientError(
        res.status,
        JSON.stringify(data),
        "Challenge response missing challengeJWT.",
      );
    }
    const payload = decodeJwtPayload<ChallengePayload>(data.challengeJWT);
    if (
      typeof payload.jti !== "string" ||
      typeof payload.difficulty !== "number"
    ) {
      throw new AuthClientError(
        res.status,
        data.challengeJWT,
        "Challenge JWT payload is malformed (missing jti or difficulty).",
      );
    }
    return {
      challengeJWT: data.challengeJWT,
      challenge: payload.jti,
      difficulty: payload.difficulty,
    };
  }

  private async postSession(body: {
    challengeJWT: string;
    powHex: string;
    nonce: string;
    username?: string;
    apiKey?: string;
  }): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/api/v1/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await this.parseJsonOrThrow(res, "session");
  }

  private async parseJsonOrThrow(
    res: Response,
    endpoint: string,
  ): Promise<Record<string, unknown>> {
    const text = await res.text();
    if (!res.ok) {
      throw new AuthClientError(
        res.status,
        text,
        `auth-service ${endpoint} returned ${res.status}: ${text}`,
      );
    }
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new AuthClientError(
        res.status,
        text,
        `auth-service ${endpoint} returned non-JSON body.`,
      );
    }
  }

  /**
   * Brute-force a PoW nonce. Mirrors `generatePow` in
   * services/auth-service/src/crypto.ts: scrypt(`${challenge}:${nonce}`, salt,
   * 64) until `difficulty` leading bits of the digest are zero.
   *
   * Expected work at the server's POW_DIFFICULTY=6 is ~2^6 = 64 attempts; well
   * within the challenge JWT's 3-minute TTL.
   */
  private async solvePoW(
    challenge: string,
    difficulty: number,
  ): Promise<{ powHex: string; nonce: bigint }> {
    let nonce = 0n;
    while (true) {
      const digest = await scryptHash(
        `${challenge}:${nonce}`,
        this.scryptSaltHex,
      );
      if (hasLeadingZeroBits(digest, difficulty)) {
        return { powHex: bytesToHex(digest), nonce };
      }
      nonce++;
    }
  }
}

function scryptHash(data: string, salt: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(data);
  return new Promise((resolve, reject) => {
    scrypt(bytes, salt, POW_HASH_BYTES, SCRYPT_PARAMS, (err, derived) => {
      if (err) return reject(err);
      resolve(new Uint8Array(derived));
    });
  });
}

function hasLeadingZeroBits(hash: Uint8Array, bits: number): boolean {
  if (bits > hash.length * 8) return false;
  const fullBytes = Math.floor(bits / 8);
  const remainingBits = bits % 8;
  for (let i = 0; i < fullBytes; i++) {
    if (hash[i] !== 0) return false;
  }
  if (remainingBits > 0) {
    const mask = (0xff << (8 - remainingBits)) & 0xff;
    if ((hash[fullBytes] & mask) !== 0) return false;
  }
  return true;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function decodeJwtPayload<T>(jwt: string): T {
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
