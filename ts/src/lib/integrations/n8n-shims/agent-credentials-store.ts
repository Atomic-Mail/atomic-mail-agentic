// Filesystem credential stubs for n8n vendor esbuild (never called on integration path).

import type {
  CredentialArtifacts,
  CredentialStore,
  SkillFiles,
} from "../../agent/session/agent-credentials-store.ts";

export type Credentials = {
  apiKey: string;
  inboxId: string;
  authUrl: string;
  apiUrl: string;
  scryptSalt: string;
  uploadUrl: string;
  downloadUrl: string;
};

export function parseCredentialsJson(
  raw: string,
  pathForErrors = "credentials.json",
): Credentials {
  let obj: Partial<Credentials>;
  try {
    obj = JSON.parse(raw) as Partial<Credentials>;
  } catch (err) {
    throw new Error(
      `Credentials file '${pathForErrors}' is not valid JSON: ${
        (err as Error).message
      }`,
    );
  }
  const required = [
    "apiKey",
    "inboxId",
    "authUrl",
    "apiUrl",
    "scryptSalt",
    "uploadUrl",
    "downloadUrl",
  ] as const;
  for (const k of required) {
    if (typeof obj[k] !== "string" || (obj[k] as string).length === 0) {
      throw new Error(
        `Credentials file '${pathForErrors}' missing required field: ${k}`,
      );
    }
  }
  return obj as Credentials;
}

export function serializeCredentials(creds: Credentials): string {
  return JSON.stringify(creds, null, 2) + "\n";
}

export class FilesystemCredentialStore implements CredentialStore {
  constructor(_files: SkillFiles) {
    throw new Error("FilesystemCredentialStore is unavailable in n8n bundle.");
  }

  load(): Promise<CredentialArtifacts> {
    throw new Error("FilesystemCredentialStore is unavailable in n8n bundle.");
  }

  save(_artifacts: CredentialArtifacts): Promise<void> {
    throw new Error("FilesystemCredentialStore is unavailable in n8n bundle.");
  }

  clear(): Promise<void> {
    throw new Error("FilesystemCredentialStore is unavailable in n8n bundle.");
  }
}

export async function readCredentials(_path: string): Promise<never> {
  throw new Error("readCredentials is unavailable in n8n bundle.");
}

export async function writeCredentials(_path: string, _data: unknown): Promise<void> {
  throw new Error("writeCredentials is unavailable in n8n bundle.");
}

export async function writeJwtFile(_path: string, _jwt: string): Promise<void> {
  throw new Error("writeJwtFile is unavailable in n8n bundle.");
}

export type { CredentialArtifacts, CredentialStore, SkillFiles };
