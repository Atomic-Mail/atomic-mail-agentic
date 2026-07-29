import { AgentSession } from "../agent/session/agent-session.js";
import type { CredentialStore } from "../agent/session/agent-credentials-store.js";
import { type KeyValueStore } from "./key-value-credential-store.js";
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
export declare function createAgentSession(input: CreateAgentSessionInput): Promise<AgentSession>;
export declare function createAgentSessionFromKeyValue(input: CreateAgentSessionFromKeyValueInput): Promise<AgentSession>;
//# sourceMappingURL=create-agent-session.d.ts.map