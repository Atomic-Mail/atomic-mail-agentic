import { assertEquals } from "@std/assert";

import {
  DEFAULT_API_URL,
  DEFAULT_AUTH_URL,
} from "../../core/consts.ts";
import { resolveAgentConfigFromEnv } from "./agent-resolve-config.ts";

const ENV_KEYS = [
  "ATOMIC_MAIL_AUTH_URL",
  "ATOMIC_MAIL_API_URL",
  "ATOMIC_MAIL_CREDENTIALS_DIR",
  "ATOMIC_MAIL_API_KEY",
  "ATOMIC_MAIL_SCRYPT_SALT",
] as const;

function saveEnv(): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    saved[key] = Deno.env.get(key);
    Deno.env.delete(key);
  }
  return saved;
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    Deno.env.delete(key);
    const value = saved[key];
    if (value !== undefined) Deno.env.set(key, value);
  }
}

Deno.test(
  "resolveAgentConfigFromEnv uses production defaults when unset",
  async () => {
    const saved = saveEnv();
    const dir = await Deno.makeTempDir({ prefix: "atomicmail-resolve-" });
    Deno.env.set("ATOMIC_MAIL_CREDENTIALS_DIR", dir);
    try {
      const config = await resolveAgentConfigFromEnv();
      assertEquals(config.authUrl, DEFAULT_AUTH_URL);
      assertEquals(config.apiUrl, DEFAULT_API_URL);
      assertEquals(config.source, "defaults");
      assertEquals(config.credentialDir, dir);
    } finally {
      restoreEnv(saved);
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "resolveAgentConfigFromEnv prefers env URLs over defaults",
  async () => {
    const saved = saveEnv();
    const dir = await Deno.makeTempDir({ prefix: "atomicmail-resolve-" });
    Deno.env.set("ATOMIC_MAIL_CREDENTIALS_DIR", dir);
    Deno.env.set("ATOMIC_MAIL_AUTH_URL", "https://auth.example.test");
    Deno.env.set("ATOMIC_MAIL_API_URL", "https://api.example.test");
    try {
      const config = await resolveAgentConfigFromEnv();
      assertEquals(config.authUrl, "https://auth.example.test");
      assertEquals(config.apiUrl, "https://api.example.test");
      assertEquals(config.source, "env");
    } finally {
      restoreEnv(saved);
      await Deno.remove(dir, { recursive: true });
    }
  },
);
