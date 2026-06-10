// Create AgentSession for a specific credential directory (MCP per-request / CLI parity).

import { AgentSession } from "./agent-session.ts";
import {
  defaultFilesFromOutDir,
  readCredentials,
  tryReadCredentials,
} from "./agent-credentials-store.ts";
import {
  expandCredentialDirInput,
  type ResolvedAgentConfig,
} from "./agent-resolve-config.ts";

export interface CreateAgentSessionForCredentialDirOptions {
  /** When true, credentials.json must exist (jmap_request path). */
  requireCredentials?: boolean;
}

export async function createAgentSessionForCredentialDir(
  credentialDir: string,
  envDefaults: Pick<ResolvedAgentConfig, "authUrl" | "apiUrl" | "scryptSalt">,
  options: CreateAgentSessionForCredentialDirOptions = {},
): Promise<AgentSession> {
  const expandedDir = expandCredentialDirInput(credentialDir);
  const files = defaultFilesFromOutDir(expandedDir);
  const fileCreds = await tryReadCredentials(files.credentialsFile);

  if (!fileCreds) {
    if (options.requireCredentials) {
      throw new Error(
        `No credentials in '${expandedDir}'. Run register with ` +
          `credentials_dir pointing at that directory first.`,
      );
    }
    return AgentSession.create({
      authUrl: envDefaults.authUrl,
      apiUrl: envDefaults.apiUrl,
      scryptSalt: envDefaults.scryptSalt,
      credentialDir: expandedDir,
      files,
    });
  }

  const creds = await readCredentials(files.credentialsFile);
  return AgentSession.create({
    authUrl: creds.authUrl,
    apiUrl: creds.apiUrl,
    scryptSalt: creds.scryptSalt,
    apiKey: creds.apiKey,
    inboxId: creds.inboxId,
    credentialDir: expandedDir,
    files,
  });
}
