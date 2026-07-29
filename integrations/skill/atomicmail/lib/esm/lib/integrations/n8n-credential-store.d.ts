import type { CredentialStore } from "../agent/session/agent-credentials-store.js";
/** Host-provided backend (n8n static data object, custom adapter, …). */
export interface N8nKeyValueBackend {
    get(key: string): Promise<string | undefined> | string | undefined;
    set(key: string, value: string): Promise<void> | void;
    delete(key: string): Promise<void> | void;
    has?(key: string): Promise<boolean> | boolean;
}
/**
 * Wrap n8n host storage as a CredentialStore.
 * Keys: `atomicmail:{accountId}:account:{accountId}:credentials.json`, etc.
 */
export declare function createN8nCredentialStore(backend: N8nKeyValueBackend, accountId?: string): CredentialStore;
/** Alias for integration hosts that expect a generic factory name. */
export declare const createKeyValueStore: typeof createN8nCredentialStore;
/** Adapter for n8n `getWorkflowStaticData()`-style object storage. */
export declare function n8nStaticDataBackend(data: Record<string, unknown>): N8nKeyValueBackend;
//# sourceMappingURL=n8n-credential-store.d.ts.map