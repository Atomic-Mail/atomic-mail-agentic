// Create AgentSession for integration hosts (Activepieces, Dify-style runtimes).

import {
  DEFAULT_API_URL,
  DEFAULT_AUTH_URL,
  DEFAULT_POW_SCRYPT_SALT_HEX,
} from "../core/consts.ts";
import { AgentSession } from "../agent/session/agent-session.ts";
import type { CredentialStore } from "../agent/session/agent-credentials-store.ts";
import {
  KeyValueCredentialStore,
  type KeyValueStore,
} from "./key-value-credential-store.ts";

export interface IntegrationEnv {
  authUrl?: string;
  apiUrl?: string;
  scryptSalt?: string;
}

export interface CreateAgentSessionInput {
  store: CredentialStore;
  env?: IntegrationEnv;
  apiKey?: string;
  /** Virtual credential namespace label (for logging / parity). */
  credentialDir?: string;
}

export interface CreateAgentSessionFromKeyValueInput {
  storage: KeyValueStore;
  accountId?: string;
  env?: IntegrationEnv;
  apiKey?: string;
  credentialDir?: string;
}

function resolveIntegrationEnv(env?: IntegrationEnv): {
  authUrl: string;
  apiUrl: string;
  scryptSalt: string;
} {
  return {
    authUrl: (env?.authUrl ?? DEFAULT_AUTH_URL).replace(/\/+$/, ""),
    apiUrl: (env?.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, ""),
    scryptSalt: env?.scryptSalt ?? DEFAULT_POW_SCRYPT_SALT_HEX,
  };
}

export async function createAgentSession(
  input: CreateAgentSessionInput,
): Promise<AgentSession> {
  const resolved = resolveIntegrationEnv(input.env);
  const loaded = await input.store.load();
  const creds = loaded.credentials;

  return AgentSession.create({
    authUrl: creds?.authUrl ?? resolved.authUrl,
    apiUrl: creds?.apiUrl ?? resolved.apiUrl,
    scryptSalt: creds?.scryptSalt ?? resolved.scryptSalt,
    apiKey: input.apiKey ?? creds?.apiKey,
    inboxId: creds?.inboxId,
    credentialDir: input.credentialDir ?? "integration://default",
    store: input.store,
  });
}

export async function createAgentSessionFromKeyValue(
  input: CreateAgentSessionFromKeyValueInput,
): Promise<AgentSession> {
  const accountId = input.accountId ?? "default";
  const store = new KeyValueCredentialStore(input.storage, accountId);
  return createAgentSession({
    store,
    env: input.env,
    apiKey: input.apiKey,
    credentialDir: input.credentialDir ??
      `integration://account/${accountId}`,
  });
}
