// Credential file I/O shared by MCP and AgentSkill.
// Three files: credentials.json, session.jwt, capability.jwt (mode 0600).

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface Credentials {
  apiKey: string;
  inboxId: string;
  authUrl: string;
  apiUrl: string;
  scryptSalt: string;
  uploadUrl: string;
  downloadUrl: string;
}

export interface SkillFiles {
  credentialsFile: string;
  sessionFile: string;
  capabilityFile: string;
}

export interface CredentialArtifacts {
  credentials?: Credentials;
  sessionJwt?: string;
  capabilityJwt?: string;
}

export interface CredentialStore {
  load(): Promise<CredentialArtifacts>;
  /**
   * Persist provided artifacts. Missing fields are left unchanged.
   */
  save(artifacts: CredentialArtifacts): Promise<void>;
  clear(): Promise<void>;
}

export function defaultFilesFromOutDir(outDir: string): SkillFiles {
  const base = resolve(outDir);
  return {
    credentialsFile: join(base, "credentials.json"),
    sessionFile: join(base, "session.jwt"),
    capabilityFile: join(base, "capability.jwt"),
  };
}

async function ensureParent(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

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

export async function writeCredentials(
  path: string,
  creds: Credentials,
): Promise<void> {
  await ensureParent(path);
  await writeFile(path, serializeCredentials(creds), { mode: 0o600 });
}

export async function readCredentials(path: string): Promise<Credentials> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    throw new Error(
      `Could not read credentials file '${path}': ${(err as Error).message}. ` +
        "Did you run register first?",
    );
  }
  return parseCredentialsJson(raw, path);
}

export async function tryReadCredentials(
  path: string,
): Promise<Credentials | undefined> {
  try {
    const raw = await readFile(path, "utf-8");
    return parseCredentialsJson(raw, path);
  } catch {
    return undefined;
  }
}

export async function writeJwtFile(path: string, jwt: string): Promise<void> {
  await ensureParent(path);
  await writeFile(path, jwt, { mode: 0o600 });
}

export async function tryReadJwtFile(
  path: string,
): Promise<string | undefined> {
  try {
    const raw = await readFile(path, "utf-8");
    return raw.trim();
  } catch {
    return undefined;
  }
}

export class FilesystemCredentialStore implements CredentialStore {
  readonly files: SkillFiles;

  constructor(files: SkillFiles) {
    this.files = files;
  }

  async load(): Promise<CredentialArtifacts> {
    return {
      credentials: await tryReadCredentials(this.files.credentialsFile),
      sessionJwt: await tryReadJwtFile(this.files.sessionFile),
      capabilityJwt: await tryReadJwtFile(this.files.capabilityFile),
    };
  }

  async save(artifacts: CredentialArtifacts): Promise<void> {
    if (artifacts.credentials !== undefined) {
      await writeCredentials(this.files.credentialsFile, artifacts.credentials);
    }
    if (artifacts.sessionJwt !== undefined) {
      await writeJwtFile(this.files.sessionFile, artifacts.sessionJwt);
    }
    if (artifacts.capabilityJwt !== undefined) {
      await writeJwtFile(this.files.capabilityFile, artifacts.capabilityJwt);
    }
  }

  async clear(): Promise<void> {
    await unlinkCredentialArtifacts(this.files);
  }
}

/** Best-effort removal of credential artifacts (ignore missing files). */
export async function unlinkCredentialArtifacts(
  files: SkillFiles,
): Promise<void> {
  for (
    const p of [
      files.credentialsFile,
      files.sessionFile,
      files.capabilityFile,
    ]
  ) {
    try {
      await unlink(p);
    } catch {
      // ignore
    }
  }
}
