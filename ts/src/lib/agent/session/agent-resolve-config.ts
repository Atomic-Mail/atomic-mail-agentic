// Resolve MCP / process credential dir + URLs from env + credentials.json.

import process from "node:process";

import { DEFAULT_POW_SCRYPT_SALT_HEX } from "../../core/consts.ts";
import {
  defaultFilesFromOutDir,
  type SkillFiles,
  tryReadCredentials,
} from "./agent-credentials-store.ts";

export type ConfigSource =
  | "credentials-file"
  | "env"
  | "mixed"
  | "incomplete";

export interface ResolvedAgentConfig {
  authUrl: string;
  apiUrl: string;
  scryptSalt: string;
  apiKey?: string;
  inboxId?: string;
  credentialDir: string;
  files: SkillFiles;
  source: ConfigSource;
}

/**
 * Default credential directory:
 *   1. ATOMIC_MAIL_CREDENTIALS_DIR
 *   2. ~/.atomicmail/ or %USERPROFILE%/.atomicmail
 */
export function resolveCredentialDir(): string {
  const fromEnv = process.env.ATOMIC_MAIL_CREDENTIALS_DIR;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) {
    throw new Error(
      "Cannot determine default credential directory: HOME and USERPROFILE " +
        "are both unset. Set ATOMIC_MAIL_CREDENTIALS_DIR explicitly.",
    );
  }
  return `${home.replace(/[\\/]+$/, "")}/.atomicmail`;
}

/**
 * Merge credentials.json with ATOMIC_MAIL_* env (env wins per field).
 * authUrl and apiUrl must resolve from at least one source.
 */
export async function resolveAgentConfigFromEnv(): Promise<
  ResolvedAgentConfig
> {
  const credentialDir = resolveCredentialDir();
  const files = defaultFilesFromOutDir(credentialDir);

  const fileCreds = await tryReadCredentials(files.credentialsFile);

  const env = process.env;
  const envAuthUrl = env.ATOMIC_MAIL_AUTH_URL;
  const envApiUrl = env.ATOMIC_MAIL_API_URL;
  const envSalt = env.ATOMIC_MAIL_SCRYPT_SALT;
  const envApiKey = env.ATOMIC_MAIL_API_KEY;

  const authUrl = envAuthUrl ?? fileCreds?.authUrl;
  const apiUrl = envApiUrl ?? fileCreds?.apiUrl;
  const scryptSalt = envSalt ?? fileCreds?.scryptSalt ??
    DEFAULT_POW_SCRYPT_SALT_HEX;
  const apiKey = envApiKey ?? fileCreds?.apiKey;
  const inboxId = fileCreds?.inboxId;

  const missing: string[] = [];
  if (!authUrl) missing.push("ATOMIC_MAIL_AUTH_URL");
  if (!apiUrl) missing.push("ATOMIC_MAIL_API_URL");

  if (missing.length > 0) {
    throw new Error(
      `Missing required configuration: ${missing.join(", ")}. ` +
        `Provide these via environment variables, or place a populated ` +
        `credentials.json in '${credentialDir}' (run register first, or set ` +
        `ATOMIC_MAIL_CREDENTIALS_DIR).`,
    );
  }

  const usingFile = fileCreds !== undefined;
  const usingEnv = !!(envAuthUrl || envApiUrl || envSalt || envApiKey);
  const source: ConfigSource = usingFile && usingEnv
    ? "mixed"
    : usingFile
    ? "credentials-file"
    : usingEnv
    ? "env"
    : "incomplete";

  return {
    authUrl: authUrl!.replace(/\/+$/, ""),
    apiUrl: apiUrl!.replace(/\/+$/, ""),
    scryptSalt: scryptSalt!,
    apiKey,
    inboxId,
    credentialDir,
    files,
    source,
  };
}
