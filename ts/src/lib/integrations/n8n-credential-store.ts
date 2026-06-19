// n8n credential persistence via host key-value / static-data storage.

import type { CredentialStore } from "../agent/session/agent-credentials-store.ts";
import {
  KeyValueCredentialStore,
  type KeyValueStore,
} from "./key-value-credential-store.ts";

/** Host-provided backend (n8n static data object, custom adapter, …). */
export interface N8nKeyValueBackend {
  get(key: string): Promise<string | undefined> | string | undefined;
  set(key: string, value: string): Promise<void> | void;
  delete(key: string): Promise<void> | void;
  has?(key: string): Promise<boolean> | boolean;
}

const KEY_PREFIX = "atomicmail";

function scopedKey(accountId: string, suffix: string): string {
  return `${KEY_PREFIX}:${accountId}:${suffix}`;
}

function normalizeBackend(backend: N8nKeyValueBackend): KeyValueStore {
  return {
    async get(key) {
      const value = await backend.get(key);
      return value === undefined || value === null ? undefined : String(value);
    },
    async set(key, value) {
      await backend.set(key, value);
    },
    async delete(key) {
      await backend.delete(key);
    },
    ...(backend.has && {
      async has(key) {
        return Boolean(await backend.has!(key));
      },
    }),
  };
}

function prefixingStore(
  backend: KeyValueStore,
  accountId: string,
): KeyValueStore {
  return {
    get: (key) => backend.get(scopedKey(accountId, key)),
    set: (key, value) => backend.set(scopedKey(accountId, key), value),
    delete: (key) => backend.delete(scopedKey(accountId, key)),
    ...(backend.has && {
      has: (key) => backend.has!(scopedKey(accountId, key)),
    }),
  };
}

/**
 * Wrap n8n host storage as a CredentialStore.
 * Keys: `atomicmail:{accountId}:account:{accountId}:credentials.json`, etc.
 */
export function createN8nCredentialStore(
  backend: N8nKeyValueBackend,
  accountId = "default",
): CredentialStore {
  return new KeyValueCredentialStore(
    prefixingStore(normalizeBackend(backend), accountId),
    accountId,
  );
}

/** Alias for integration hosts that expect a generic factory name. */
export const createKeyValueStore = createN8nCredentialStore;

/** Adapter for n8n `getWorkflowStaticData()`-style object storage. */
export function n8nStaticDataBackend(
  data: Record<string, unknown>,
): N8nKeyValueBackend {
  return {
    get(key) {
      const value = data[key];
      return typeof value === "string" ? value : undefined;
    },
    set(key, value) {
      data[key] = value;
    },
    delete(key) {
      delete data[key];
    },
    has(key) {
      return Object.prototype.hasOwnProperty.call(data, key);
    },
  };
}
