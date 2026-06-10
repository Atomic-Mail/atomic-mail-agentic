import { assertRejects, assertStringIncludes } from "@std/assert";

import { AgentSession } from "./agent-session.ts";

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
    assertStringIncludes(err.message, "Register refused");
    assertStringIncludes(err.message, "credentials_dir in MCP");
    assertStringIncludes(err.message, "--credentials-dir in AgentSkill");
    assertStringIncludes(err.message, "forced=true (MCP)");
    assertStringIncludes(err.message, "--forced (AgentSkill)");
  },
);
