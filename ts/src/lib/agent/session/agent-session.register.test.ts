import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";

import { AgentSession } from "./agent-session.ts";
import type { CredentialArtifacts } from "./agent-credentials-store.ts";

Deno.test(
  "register rejects username switch without forced flag",
  async () => {
    const session = new AgentSession({
      authUrl: "https://auth.atomicmail.ai",
      apiUrl: "https://api.atomicmail.ai",
      scryptSalt: "salt",
      apiKey: "existing-api-key",
      inboxId: "current-user@atomicmail.ai",
      credentialDir: "/tmp/atomicmail-test-creds",
      files: {
        credentialsFile: "/tmp/atomicmail-test-creds/credentials.json",
        sessionFile: "/tmp/atomicmail-test-creds/session.jwt",
        capabilityFile: "/tmp/atomicmail-test-creds/capability.jwt",
      },
    });

    const err = await assertRejects(
      () => session.register("new-user"),
      Error,
    );
    // The live refused path sources its wording from shared/messages/errors.json
    // (agent_register_refused_existing_credentials_template) via sharedErrorTemplate,
    // so TS and Python refuse in the same words. It opens with the irreversible
    // risk and points at the safe alternative — a separate credential directory —
    // rather than handing over the replace flag as a copy-paste recipe.
    assertStringIncludes(err.message, "Register refused");
    assertStringIncludes(err.message, "irreversibly destroys your only access");
    assertStringIncludes(err.message, "credentials_dir in MCP");
    assertStringIncludes(err.message, "--credentials-dir in AgentSkill");
    assertStringIncludes(err.message, "your operator's decision");
    // The rewrite deliberately does not spell the flag as a flag=value recipe.
    assert(!err.message.includes("forced=true"));
  },
);

Deno.test(
  "AgentSession can load credential artifacts from in-memory store",
  async () => {
    const artifacts: CredentialArtifacts = {
      credentials: {
        apiKey: "existing-api-key",
        inboxId: "current-user@atomicmail.ai",
        authUrl: "https://auth.atomicmail.ai",
        apiUrl: "https://api.atomicmail.ai",
        scryptSalt: "salt",
        uploadUrl: "https://api.atomicmail.ai/upload/{accountId}",
        downloadUrl: "https://api.atomicmail.ai/download/{accountId}/{blobId}",
      },
      sessionJwt: "session-jwt",
      capabilityJwt: "cap-jwt",
    };
    const inMemoryStore = {
      async load() {
        await Promise.resolve();
        return artifacts;
      },
      async save(next: CredentialArtifacts) {
        await Promise.resolve();
        Object.assign(artifacts, next);
      },
      async clear() {
        await Promise.resolve();
        Object.keys(artifacts).forEach((key) => {
          delete (artifacts as Record<string, unknown>)[key];
        });
      },
    };

    const session = await AgentSession.create({
      authUrl: "https://auth.atomicmail.ai",
      apiUrl: "https://api.atomicmail.ai",
      scryptSalt: "salt",
      credentialDir: "/virtual",
      store: inMemoryStore,
    });

    assertEquals(session.hasApiKey, true);
    assertEquals(session.currentInboxId, "current-user@atomicmail.ai");
    const err = await assertRejects(
      () => session.register("new-user"),
      Error,
    );
    assertStringIncludes(err.message, "Register refused");
  },
);

Deno.test(
  "session.register works without a watch parameter (wrapper boundary)",
  async () => {
    // The `watch` precondition lives only in the MCP tool and skill CLI; it must
    // never reach the session. Calling register with just a username behaves
    // exactly as before and never surfaces a watch-related error.
    const session = new AgentSession({
      authUrl: "https://auth.atomicmail.ai",
      apiUrl: "https://api.atomicmail.ai",
      scryptSalt: "salt",
      apiKey: "existing-api-key",
      inboxId: "current-user@atomicmail.ai",
      credentialDir: "/tmp/atomicmail-test-creds",
      files: {
        credentialsFile: "/tmp/atomicmail-test-creds/credentials.json",
        sessionFile: "/tmp/atomicmail-test-creds/session.jwt",
        capabilityFile: "/tmp/atomicmail-test-creds/capability.jwt",
      },
    });

    const err = await assertRejects(
      () => session.register("new-user"),
      Error,
    );
    assertStringIncludes(err.message, "Register refused");
    assert(!err.message.toLowerCase().includes("watch"));
  },
);
