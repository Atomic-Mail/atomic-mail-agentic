import { assertEquals } from "@std/assert";

import {
  CAPABILITY_SAFETY_MARGIN_MS,
  decodeJwtPayload,
  isJwtExpired,
  SESSION_SAFETY_MARGIN_MS,
} from "./agent-jwt.ts";

function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${header}.${body}.`;
}

Deno.test("decodeJwtPayload returns parsed payload", () => {
  const jwt = makeJwt({ exp: 1_700_000_000, inboxId: "agent@example.com" });
  assertEquals(
    decodeJwtPayload<{ exp: number; inboxId: string }>(jwt),
    { exp: 1_700_000_000, inboxId: "agent@example.com" },
  );
});

Deno.test("isJwtExpired respects safety margin boundary", () => {
  const originalNow = Date.now;
  try {
    Date.now = () => 1_700_000_000_000;
    const nowSec = Math.floor(Date.now() / 1000);

    const safelyValid = makeJwt({
      exp: nowSec + Math.ceil((SESSION_SAFETY_MARGIN_MS + 500) / 1000),
    });
    const withinMargin = makeJwt({
      exp: nowSec + Math.floor((SESSION_SAFETY_MARGIN_MS - 500) / 1000),
    });

    assertEquals(isJwtExpired(safelyValid, SESSION_SAFETY_MARGIN_MS), false);
    assertEquals(isJwtExpired(withinMargin, SESSION_SAFETY_MARGIN_MS), true);
  } finally {
    Date.now = originalNow;
  }
});

Deno.test("isJwtExpired depends on exp claim, not fixed TTL constants", () => {
  const originalNow = Date.now;
  try {
    Date.now = () => 1_700_000_000_000;
    const nowSec = Math.floor(Date.now() / 1000);

    // A token valid for three hours remains usable because exp drives checks.
    const longSessionToken = makeJwt({ exp: nowSec + 3 * 60 * 60 });
    assertEquals(
      isJwtExpired(longSessionToken, SESSION_SAFETY_MARGIN_MS),
      false,
    );

    // A short-lived capability token expires as soon as it crosses the margin.
    const shortCapabilityToken = makeJwt({
      exp: nowSec + Math.floor((CAPABILITY_SAFETY_MARGIN_MS - 1000) / 1000),
    });
    assertEquals(
      isJwtExpired(shortCapabilityToken, CAPABILITY_SAFETY_MARGIN_MS),
      true,
    );
  } finally {
    Date.now = originalNow;
  }
});
