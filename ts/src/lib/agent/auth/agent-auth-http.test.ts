import { assertEquals, assertRejects } from "@std/assert";

import {
  exchangeSession,
  fetchCapability,
  fetchChallenge,
} from "./agent-auth-http.ts";

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

Deno.test("fetchChallenge reads challenge JWT from Authorization header", async () => {
  const originalFetch = globalThis.fetch;
  const challengeJWT = makeJwt({ jti: "abc", difficulty: 6 });
  try {
    globalThis.fetch = () =>
      Promise.resolve(new Response("", {
        status: 200,
        headers: { Authorization: `Bearer ${challengeJWT}` },
      }));

    const challenge = await fetchChallenge("https://auth.example");
    assertEquals(challenge.challengeJWT, challengeJWT);
    assertEquals(challenge.challenge, "abc");
    assertEquals(challenge.difficulty, 6);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("fetchChallenge fails when Authorization header is missing", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = () => Promise.resolve(new Response("", { status: 200 }));
    await assertRejects(
      () => fetchChallenge("https://auth.example"),
      Error,
      "Challenge response missing Authorization bearer token.",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("exchangeSession sends challenge JWT and reads session JWT from Authorization header", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ auth?: string; body?: Record<string, unknown> }> = [];
  try {
    globalThis.fetch = (_input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        auth: headers.get("Authorization") ?? undefined,
        body: init?.body
          ? (JSON.parse(String(init.body)) as Record<string, unknown>)
          : undefined,
      });
      return Promise.resolve(new Response(JSON.stringify({ apiKey: "api-key" }), {
        status: 200,
        headers: { Authorization: "Bearer session-token" },
      }));
    };

    const result = await exchangeSession("https://auth.example", {
      challengeJWT: "challenge-token",
      powHex: "deadbeef",
      nonce: "42",
      username: "agent",
    });

    assertEquals(result.sessionJWT, "session-token");
    assertEquals(calls.length, 1);
    assertEquals(calls[0].auth, "Bearer challenge-token");
    assertEquals(calls[0].body, {
      powHex: "deadbeef",
      nonce: "42",
      username: "agent",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("fetchCapability sends session JWT and reads capability JWT from Authorization header", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ auth?: string }> = [];
  try {
    globalThis.fetch = (_input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        auth: headers.get("Authorization") ?? undefined,
      });
      return Promise.resolve(new Response("", {
        status: 200,
        headers: { Authorization: "Bearer capability-token" },
      }));
    };

    const capability = await fetchCapability(
      "https://auth.example",
      "session-token",
    );

    assertEquals(capability, "capability-token");
    assertEquals(calls.length, 1);
    assertEquals(calls[0].auth, "Bearer session-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
