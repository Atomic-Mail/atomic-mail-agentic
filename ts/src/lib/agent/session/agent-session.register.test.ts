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
    // NOTE: this text is hardcoded inside session.register() (agent-session.ts),
    // which is out of bounds to edit, so it still reads the old wording. The
    // rewritten copy lives in shared/messages/errors.json
    // (agent_register_refused_existing_credentials_template) but is not yet wired
    // to the session — see the shared-source test below and the handoff note.
    assertStringIncludes(err.message, "Register refused");
    assertStringIncludes(err.message, "credentials_dir in MCP");
    assertStringIncludes(err.message, "--credentials-dir in AgentSkill");
    assertStringIncludes(err.message, "forced=true (MCP)");
    assertStringIncludes(err.message, "--forced (AgentSkill)");
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
