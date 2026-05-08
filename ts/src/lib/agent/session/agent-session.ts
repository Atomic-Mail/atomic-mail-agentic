// Stateful PoW + capability JWT + optional cached JMAP session (accountId).

import {
  type Credentials,
  type SkillFiles,
  tryReadCredentials,
  tryReadJwtFile,
  unlinkCredentialArtifacts,
  writeCredentials,
  writeJwtFile,
} from "./agent-credentials-store.ts";
import {
  CAPABILITY_SAFETY_MARGIN_MS,
  decodeJwtPayload,
  isJwtExpired,
  SESSION_SAFETY_MARGIN_MS,
} from "../auth/agent-jwt.ts";
import {
  extractBlobEndpoints,
  extractPrimaryMailAccountId,
  fetchJmapWellKnown,
} from "../jmap/agent-jmap.ts";
import { fetchCapability, performPoWAndSession } from "../auth/agent-auth-http.ts";

export interface AgentSessionConfig {
  authUrl: string;
  apiUrl: string;
  scryptSalt: string;
  apiKey?: string;
  inboxId?: string;
  credentialDir: string;
  files: SkillFiles;
}

export interface RegisterResult {
  inbox: string;
  accountId: string;
  /** Present only on first-time signup (not idempotent replay). */
  apiKey?: string;
  idempotent?: boolean;
}

function normalizeUsername(u: string): string {
  return u.trim().toLowerCase();
}

/** Local-part of an inbox email, or the whole string if no @. */
export function inboxLocalPart(inboxId: string): string {
  const i = inboxId.indexOf("@");
  return i === -1
    ? normalizeUsername(inboxId)
    : normalizeUsername(inboxId.slice(0, i));
}

export class AgentSession {
  private readonly authUrl: string;
  readonly apiUrl: string;
  private readonly scryptSalt: string;
  private apiKey: string | undefined;
  private inboxId: string | undefined;
  readonly credentialDir: string;
  readonly files: SkillFiles;

  private sessionJWT: string | undefined;
  private capabilityJWT: string | undefined;
  private cachedMailAccountId: string | undefined;
  private cachedUploadUrl: string | undefined;
  private cachedDownloadUrl: string | undefined;

  constructor(cfg: AgentSessionConfig) {
    this.authUrl = cfg.authUrl.replace(/\/+$/, "");
    this.apiUrl = cfg.apiUrl.replace(/\/+$/, "");
    this.scryptSalt = cfg.scryptSalt;
    this.apiKey = cfg.apiKey;
    this.inboxId = cfg.inboxId;
    this.credentialDir = cfg.credentialDir;
    this.files = cfg.files;
  }

  static async create(cfg: AgentSessionConfig): Promise<AgentSession> {
    const session = new AgentSession(cfg);
    await session.loadFromDisk();
    return session;
  }

  get hasApiKey(): boolean {
    return this.apiKey !== undefined && this.apiKey.length > 0;
  }

  get currentInboxId(): string | undefined {
    return this.inboxId;
  }

  get currentUploadUrl(): string | undefined {
    return this.cachedUploadUrl;
  }

  get currentDownloadUrl(): string | undefined {
    return this.cachedDownloadUrl;
  }

  private async loadFromDisk(): Promise<void> {
    this.sessionJWT = await tryReadJwtFile(this.files.sessionFile);
    this.capabilityJWT = await tryReadJwtFile(this.files.capabilityFile);
    const disk = await tryReadCredentials(this.files.credentialsFile);
    if (disk) {
      this.apiKey = this.apiKey ?? disk.apiKey;
      this.inboxId = this.inboxId ?? disk.inboxId;
      this.cachedUploadUrl = disk.uploadUrl;
      this.cachedDownloadUrl = disk.downloadUrl;
    }
  }

  /**
   * Primary JMAP mail accountId from GET /.well-known/jmap (cached).
   */
  async getPrimaryMailAccountId(): Promise<string> {
    if (
      this.cachedMailAccountId &&
      this.cachedUploadUrl &&
      this.cachedDownloadUrl
    ) {
      return this.cachedMailAccountId;
    }
    await this.refreshJmapSessionData();
    if (!this.cachedMailAccountId) {
      throw new Error("JMAP session missing primary mail account id.");
    }
    return this.cachedMailAccountId;
  }

  invalidateJmapSessionCache(): void {
    this.cachedMailAccountId = undefined;
    this.cachedUploadUrl = undefined;
    this.cachedDownloadUrl = undefined;
  }

  private async refreshJmapSessionData(): Promise<void> {
    const cap = await this.getCapabilityToken();
    const session = await fetchJmapWellKnown(this.apiUrl, cap);
    this.cachedMailAccountId = extractPrimaryMailAccountId(session);
    const blobs = extractBlobEndpoints(session);
    this.cachedUploadUrl = blobs.uploadUrl;
    this.cachedDownloadUrl = blobs.downloadUrl;
  }

  /**
   * Register or return existing inbox when username matches (idempotent).
   * Different username replaces on-disk credentials and creates a new inbox.
   */
  async register(username: string): Promise<RegisterResult> {
    const want = normalizeUsername(username);

    if (this.hasApiKey && !this.inboxId) {
      throw new Error(
        "Cannot register: an API key is configured but inboxId is unknown. " +
          "Fix credentials.json or unset ATOMIC_MAIL_API_KEY before registering.",
      );
    }

    if (this.hasApiKey && this.inboxId) {
      const have = inboxLocalPart(this.inboxId);
      if (have === want) {
        const accountId = await this.getPrimaryMailAccountId();
        return {
          inbox: this.inboxId,
          accountId,
          idempotent: true,
        };
      }
      await unlinkCredentialArtifacts(this.files);
      this.apiKey = undefined;
      this.inboxId = undefined;
      this.sessionJWT = undefined;
      this.capabilityJWT = undefined;
      this.cachedMailAccountId = undefined;
    }

    const result = await performPoWAndSession({
      authUrl: this.authUrl,
      scryptSalt: this.scryptSalt,
      username,
    });
    if (!result.apiKey) {
      throw new Error(
        "Signup did not return an apiKey — this indicates a server bug.",
      );
    }
    this.apiKey = result.apiKey;
    this.sessionJWT = result.sessionJWT;
    await writeJwtFile(this.files.sessionFile, this.sessionJWT);

    const capability = await fetchCapability(this.authUrl, this.sessionJWT);
    this.capabilityJWT = capability;
    await writeJwtFile(this.files.capabilityFile, capability);

    const claims = decodeJwtPayload<{ inboxId?: string }>(capability);
    if (typeof claims.inboxId !== "string" || claims.inboxId.length === 0) {
      throw new Error("Capability JWT missing inboxId claim after signup.");
    }
    this.inboxId = claims.inboxId;
    this.cachedMailAccountId = undefined;
    this.cachedUploadUrl = undefined;
    this.cachedDownloadUrl = undefined;

    const accountId = await this.getPrimaryMailAccountId();
    if (!this.cachedUploadUrl || !this.cachedDownloadUrl) {
      throw new Error("JMAP session did not provide upload/download URLs.");
    }

    const creds: Credentials = {
      apiKey: this.apiKey,
      inboxId: this.inboxId,
      authUrl: this.authUrl,
      apiUrl: this.apiUrl,
      scryptSalt: this.scryptSalt,
      uploadUrl: this.cachedUploadUrl,
      downloadUrl: this.cachedDownloadUrl,
    };
    await writeCredentials(this.files.credentialsFile, creds);

    return {
      inbox: this.inboxId,
      accountId,
      apiKey: this.apiKey,
    };
  }

  async getCapabilityToken(): Promise<string> {
    if (
      this.capabilityJWT &&
      !isJwtExpired(this.capabilityJWT, CAPABILITY_SAFETY_MARGIN_MS)
    ) {
      return this.capabilityJWT;
    }

    await this.ensureSession();
    if (!this.sessionJWT) {
      throw new Error("Internal: ensureSession() left sessionJWT unset.");
    }
    const cap = await fetchCapability(this.authUrl, this.sessionJWT);
    this.capabilityJWT = cap;
    await writeJwtFile(this.files.capabilityFile, cap);

    try {
      const claims = decodeJwtPayload<{ inboxId?: string }>(cap);
      if (typeof claims.inboxId === "string" && claims.inboxId.length > 0) {
        this.inboxId = claims.inboxId;
      }
    } catch {
      // non-fatal
    }

    return cap;
  }

  private async ensureSession(): Promise<void> {
    if (
      this.sessionJWT &&
      !isJwtExpired(this.sessionJWT, SESSION_SAFETY_MARGIN_MS)
    ) {
      return;
    }
    if (!this.apiKey) {
      throw new Error(
        "No API key configured and no valid session on disk. Run register " +
          "first, set ATOMIC_MAIL_API_KEY, or place credentials.json in the " +
          "credential directory.",
      );
    }
    const result = await performPoWAndSession({
      authUrl: this.authUrl,
      scryptSalt: this.scryptSalt,
      apiKey: this.apiKey,
    });
    this.sessionJWT = result.sessionJWT;
    this.capabilityJWT = undefined;
    this.cachedMailAccountId = undefined;
    this.cachedUploadUrl = undefined;
    this.cachedDownloadUrl = undefined;
    await writeJwtFile(this.files.sessionFile, this.sessionJWT);
  }

  destroy(): void {
    // reserved
  }
}

export interface PersistLoginWithApiKeyInput {
  authUrl: string;
  apiUrl: string;
  scryptSalt: string;
  apiKey: string;
  files: SkillFiles;
  onPowProgress?: (nonce: bigint) => void;
}

/** PoW login with an existing API key; writes credentials + JWT files. */
export async function persistLoginWithApiKey(
  input: PersistLoginWithApiKeyInput,
): Promise<{ inboxId: string }> {
  const authUrl = input.authUrl.replace(/\/+$/, "");
  const apiUrl = input.apiUrl.replace(/\/+$/, "");
  const session = await performPoWAndSession({
    authUrl,
    scryptSalt: input.scryptSalt,
    apiKey: input.apiKey,
    onPowProgress: input.onPowProgress,
  });
  const capabilityJWT = await fetchCapability(authUrl, session.sessionJWT);
  const claims = decodeJwtPayload<{ inboxId?: string }>(capabilityJWT);
  const inboxId = claims.inboxId;
  if (typeof inboxId !== "string" || inboxId.length === 0) {
    throw new Error("Capability JWT did not contain an inboxId claim.");
  }
  const jmapSession = await fetchJmapWellKnown(apiUrl, capabilityJWT);
  const blobs = extractBlobEndpoints(jmapSession);
  await writeCredentials(input.files.credentialsFile, {
    apiKey: input.apiKey,
    inboxId,
    authUrl,
    apiUrl,
    scryptSalt: input.scryptSalt,
    uploadUrl: blobs.uploadUrl,
    downloadUrl: blobs.downloadUrl,
  });
  await writeJwtFile(input.files.sessionFile, session.sessionJWT);
  await writeJwtFile(input.files.capabilityFile, capabilityJWT);
  return { inboxId };
}
