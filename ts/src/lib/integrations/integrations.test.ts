import { assertEquals } from "@std/assert";
import {
  KeyValueCredentialStore,
  type KeyValueStore,
} from "./key-value-credential-store.ts";
import { createAgentSessionFromKeyValue } from "./create-agent-session.ts";
import {
  createN8nCredentialStore,
  n8nStaticDataBackend,
} from "./n8n-credential-store.ts";

class MemoryKv implements KeyValueStore {
  private data = new Map<string, string>();

  get(key: string): Promise<string | undefined> {
    return Promise.resolve(this.data.get(key));
  }

  set(key: string, value: string): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }

  has(key: string): Promise<boolean> {
    return Promise.resolve(this.data.has(key));
  }
}

Deno.test("KeyValueCredentialStore round-trips credentials and JWTs", async () => {
  const kv = new MemoryKv();
  const store = new KeyValueCredentialStore(kv, "acct1");

  await store.save({
    credentials: {
      apiKey: "key-123",
      inboxId: "user@atomicmail.ai",
      authUrl: "https://auth.atomicmail.ai",
      apiUrl: "https://api.atomicmail.ai",
      scryptSalt: "abc",
      uploadUrl: "https://api.atomicmail.ai/upload",
      downloadUrl: "https://api.atomicmail.ai/download",
    },
    sessionJwt: "session.jwt",
    capabilityJwt: "capability.jwt",
  });

  const loaded = await store.load();
  assertEquals(loaded.credentials?.apiKey, "key-123");
  assertEquals(loaded.sessionJwt, "session.jwt");
  assertEquals(loaded.capabilityJwt, "capability.jwt");

  await store.clear();
  const cleared = await store.load();
  assertEquals(cleared.credentials, undefined);
  assertEquals(cleared.sessionJwt, undefined);
  assertEquals(cleared.capabilityJwt, undefined);
});

Deno.test("createAgentSessionFromKeyValue uses env defaults", async () => {
  const session = await createAgentSessionFromKeyValue({
    storage: new MemoryKv(),
    accountId: "default",
  });
  assertEquals(session.hasApiKey, false);
  assertEquals(session.credentialDir, "integration://account/default");
});

Deno.test("createN8nCredentialStore uses atomicmail account key prefix", async () => {
  const data: Record<string, unknown> = {};
  const store = createN8nCredentialStore(
    n8nStaticDataBackend(data),
    "acct1",
  );

  await store.save({
    credentials: {
      apiKey: "n8n-key",
      inboxId: "bot@atomicmail.ai",
      authUrl: "https://auth.atomicmail.ai",
      apiUrl: "https://api.atomicmail.ai",
      scryptSalt: "abc",
      uploadUrl: "https://api.atomicmail.ai/upload",
      downloadUrl: "https://api.atomicmail.ai/download",
    },
    sessionJwt: "session.jwt",
  });

  assertEquals(
    typeof data["atomicmail:acct1:account:acct1:credentials.json"],
    "string",
  );
  assertEquals(
    data["atomicmail:acct1:account:acct1:session.jwt"],
    "session.jwt",
  );

  const loaded = await store.load();
  assertEquals(loaded.credentials?.apiKey, "n8n-key");
  assertEquals(loaded.sessionJwt, "session.jwt");
});
