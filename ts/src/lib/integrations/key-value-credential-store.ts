// Credential persistence backed by a host-provided key-value store (Dify, Activepieces, …).

import {
  type CredentialArtifacts,
  type CredentialStore,
  type Credentials,
  parseCredentialsJson,
  serializeCredentials,
} from "../agent/session/agent-credentials-store.ts";

export interface KeyValueStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  has?(key: string): Promise<boolean>;
}

export class KeyValueCredentialStore implements CredentialStore {
  constructor(
    private readonly storage: KeyValueStore,
    private readonly accountId = "default",
  ) {}

  private key(suffix: string): string {
    return `account:${this.accountId}:${suffix}`;
  }

  private get credentialsKey(): string {
    return this.key("credentials.json");
  }

  private get sessionKey(): string {
    return this.key("session.jwt");
  }

  private get capabilityKey(): string {
    return this.key("capability.jwt");
  }

  private async exists(key: string): Promise<boolean> {
    if (this.storage.has) {
      return this.storage.has(key);
    }
    const value = await this.storage.get(key);
    return value !== undefined;
  }

  async load(): Promise<CredentialArtifacts> {
    let credentials: Credentials | undefined;
    const rawCredentials = await this.storage.get(this.credentialsKey);
    if (rawCredentials) {
      try {
        credentials = parseCredentialsJson(
          rawCredentials,
          this.credentialsKey,
        );
      } catch {
        credentials = undefined;
      }
    }

    const sessionJwt = await this.storage.get(this.sessionKey);
    const capabilityJwt = await this.storage.get(this.capabilityKey);

    return {
      credentials,
      sessionJwt,
      capabilityJwt,
    };
  }

  async save(artifacts: CredentialArtifacts): Promise<void> {
    if (artifacts.credentials !== undefined) {
      await this.storage.set(
        this.credentialsKey,
        serializeCredentials(artifacts.credentials),
      );
    }
    if (artifacts.sessionJwt !== undefined) {
      await this.storage.set(this.sessionKey, artifacts.sessionJwt);
    }
    if (artifacts.capabilityJwt !== undefined) {
      await this.storage.set(this.capabilityKey, artifacts.capabilityJwt);
    }
  }

  async clear(): Promise<void> {
    for (const key of [this.credentialsKey, this.sessionKey, this.capabilityKey]) {
      try {
        if (await this.exists(key)) {
          await this.storage.delete(key);
        }
      } catch {
        // non-fatal
      }
    }
  }
}
