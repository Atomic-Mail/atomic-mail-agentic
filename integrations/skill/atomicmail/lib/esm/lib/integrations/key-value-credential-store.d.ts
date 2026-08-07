import { type CredentialArtifacts, type CredentialStore } from "../agent/session/agent-credentials-store.js";
export interface KeyValueStore {
    get(key: string): Promise<string | undefined>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
    has?(key: string): Promise<boolean>;
}
export declare class KeyValueCredentialStore implements CredentialStore {
    private readonly storage;
    private readonly accountId;
    constructor(storage: KeyValueStore, accountId?: string);
    private key;
    private get credentialsKey();
    private get sessionKey();
    private get capabilityKey();
    private exists;
    load(): Promise<CredentialArtifacts>;
    save(artifacts: CredentialArtifacts): Promise<void>;
    clear(): Promise<void>;
}
//# sourceMappingURL=key-value-credential-store.d.ts.map