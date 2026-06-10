import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  DEFAULT_API_URL,
  DEFAULT_AUTH_URL,
  DEFAULT_POW_SCRYPT_SALT_HEX,
} from "../../core/consts.ts";
import { writeCredentials } from "./agent-credentials-store.ts";
import { createAgentSessionForCredentialDir } from "./agent-session-for-dir.ts";

const envDefaults = {
  authUrl: DEFAULT_AUTH_URL,
  apiUrl: DEFAULT_API_URL,
  scryptSalt: DEFAULT_POW_SCRYPT_SALT_HEX,
};

Deno.test(
  "createAgentSessionForCredentialDir expands tilde in path",
  async () => {
    const subName = `atomicmail-tilde-${crypto.randomUUID().slice(0, 8)}`;
    const fullNested = join(homedir(), subName);
    await Deno.mkdir(fullNested, { recursive: true });
    try {
      const session = await createAgentSessionForCredentialDir(
        `~/${subName}`,
        envDefaults,
      );
      assertEquals(session.credentialDir, resolve(fullNested));
      assertEquals(session.hasApiKey, false);
    } finally {
      await Deno.remove(fullNested, { recursive: true });
    }
  },
);

Deno.test(
  "createAgentSessionForCredentialDir empty dir without requireCredentials",
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "atomicmail-for-dir-" });
    try {
      const session = await createAgentSessionForCredentialDir(
        dir,
        envDefaults,
      );
      assertEquals(session.credentialDir, resolve(dir));
      assertEquals(session.hasApiKey, false);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "createAgentSessionForCredentialDir empty dir with requireCredentials throws",
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "atomicmail-for-dir-" });
    try {
      const err = await assertRejects(
        () =>
          createAgentSessionForCredentialDir(dir, envDefaults, {
            requireCredentials: true,
          }),
        Error,
      );
      assertStringIncludes(err.message, "No credentials");
      assertStringIncludes(err.message, "credentials_dir");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "createAgentSessionForCredentialDir loads existing credentials.json",
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "atomicmail-for-dir-" });
    const credsFile = join(dir, "credentials.json");
    await writeCredentials(credsFile, {
      apiKey: "test-api-key",
      inboxId: "alice@atomicmail.ai",
      authUrl: "https://auth.custom.test",
      apiUrl: "https://api.custom.test",
      scryptSalt: "custom-salt",
      uploadUrl: "https://upload.test",
      downloadUrl: "https://download.test",
    });
    try {
      const session = await createAgentSessionForCredentialDir(
        dir,
        envDefaults,
      );
      assertEquals(session.credentialDir, resolve(dir));
      assertEquals(session.hasApiKey, true);
      assertEquals(session.currentInboxId, "alice@atomicmail.ai");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);
