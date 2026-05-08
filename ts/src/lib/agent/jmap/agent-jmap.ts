// JMAP envelope parsing, preset paths, $VAR substitution, and HTTP helpers.

import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import { readCredentials } from "../session/agent-credentials-store.ts";
import { substituteVars } from "./agent-vars.ts";

export const DEFAULT_JMAP_USING = [
  "urn:ietf:params:jmap:core",
  "urn:ietf:params:jmap:mail",
] as const;

export const JMAP_MAIL_URN = "urn:ietf:params:jmap:mail" as const;

export interface JmapEnvelope {
  using: string[];
  methodCalls: unknown[];
}

export function parseJmapEnvelope(
  raw: string,
  defaultUsing: string[],
  source: string,
): JmapEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${source} is not valid JSON: ${(err as Error).message}`);
  }
  if (Array.isArray(value)) {
    return { using: [...defaultUsing], methodCalls: value };
  }
  if (
    value !== null &&
    typeof value === "object" &&
    Array.isArray((value as { methodCalls?: unknown }).methodCalls)
  ) {
    const obj = value as { using?: unknown; methodCalls: unknown[] };
    const using = Array.isArray(obj.using)
      ? obj.using.filter((u): u is string => typeof u === "string")
      : [...defaultUsing];
    return { using, methodCalls: obj.methodCalls };
  }
  throw new Error(
    `${source} must be a methodCalls array, e.g. ` +
      '[["Mailbox/get",{...},"m0"]], or an object with a methodCalls array.',
  );
}

export function resolveOpsFilePath(
  credentialDir: string,
  opsFile: string,
): string {
  return isAbsolute(opsFile) ? opsFile : resolvePath(credentialDir, opsFile);
}

export async function readOpsFile(
  credentialDir: string,
  opsFile: string,
): Promise<string> {
  const filePath = resolveOpsFilePath(credentialDir, opsFile);
  try {
    return await readFile(filePath, "utf-8");
  } catch (err) {
    if (
      !(err instanceof Error) || !isFileNotFound(err) || isAbsolute(opsFile)
    ) {
      throw err;
    }
  }

  const bundledPath = await resolveBundledPresetPath(opsFile);
  if (!bundledPath) {
    return await readFile(filePath, "utf-8");
  }
  return await readFile(bundledPath, "utf-8");
}

function isFileNotFound(err: Error): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

async function resolveBundledPresetPath(
  opsFile: string,
): Promise<string | undefined> {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  let currentDir = moduleDir;

  for (let depth = 0; depth < 8; depth++) {
    const candidates = [
      resolvePath(currentDir, "presets", opsFile),
      resolvePath(currentDir, "agent", "jmap", "presets", opsFile),
      resolvePath(
        currentDir,
        "lib",
        "src",
        "agent",
        "jmap",
        "presets",
        opsFile,
      ),
    ];

    for (const candidate of candidates) {
      try {
        await readFile(candidate, "utf-8");
        return candidate;
      } catch (err) {
        if (!(err instanceof Error) || !isFileNotFound(err)) {
          throw err;
        }
      }
    }

    const parent = resolvePath(currentDir, "..");
    if (parent === currentDir) break;
    currentDir = parent;
  }
  return undefined;
}

export function extractPrimaryMailAccountId(
  session: Record<string, unknown>,
): string {
  const primary = session["primaryAccounts"] as
    | Record<string, string>
    | undefined;
  if (!primary || typeof primary !== "object") {
    throw new Error("JMAP session missing primaryAccounts.");
  }
  const id = primary[JMAP_MAIL_URN];
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(
      `JMAP session missing primaryAccounts['${JMAP_MAIL_URN}'].`,
    );
  }
  return id;
}

export interface JmapBlobEndpoints {
  uploadUrl: string;
  downloadUrl: string;
}

export function extractBlobEndpoints(
  session: Record<string, unknown>,
): JmapBlobEndpoints {
  const uploadUrl = session["uploadUrl"];
  const downloadUrl = session["downloadUrl"];
  if (typeof uploadUrl !== "string" || uploadUrl.length === 0) {
    throw new Error("JMAP session missing uploadUrl.");
  }
  if (typeof downloadUrl !== "string" || downloadUrl.length === 0) {
    throw new Error("JMAP session missing downloadUrl.");
  }
  return { uploadUrl, downloadUrl };
}

export async function fetchJmapWellKnown(
  apiUrl: string,
  capabilityJwt: string,
): Promise<Record<string, unknown>> {
  const base = apiUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/.well-known/jmap`, {
    headers: { Authorization: `Bearer ${capabilityJwt}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`JMAP session fetch failed (HTTP ${res.status}): ${text}`);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("JMAP session response is not valid JSON.");
  }
}

/** Minimal surface for JMAP execution (implemented by AgentSession). */
export interface JmapSessionPort {
  readonly apiUrl: string;
  readonly files: { credentialsFile: string };
  getPrimaryMailAccountId(): Promise<string>;
  getCapabilityToken(): Promise<string>;
  readonly currentInboxId?: string;
  readonly currentUploadUrl?: string;
  readonly currentDownloadUrl?: string;
}

export interface RunJmapRequestInput {
  session: JmapSessionPort;
  /** Raw JSON: methodCalls array or full envelope */
  opsJson: string;
  /** Default `using` when the envelope omits it */
  defaultUsing: string[];
  /** Label for parse errors */
  sourceLabel: string;
  dryRun?: boolean;
  /** Values for `$VAR` tokens (keys without `$`). Overrides session vars when present. */
  vars?: Record<string, string>;
}

/**
 * Parse ops JSON, substitute `$VAR_NAME` tokens (session + caller vars), POST to JMAP.
 */
export async function runJmapRequest(
  input: RunJmapRequestInput,
): Promise<{ ok: boolean; status: number; bodyText: string }> {
  const { text: raw } = await substituteVars({
    raw: input.opsJson,
    vars: input.vars,
    autoResolvers: {
      ACCOUNT_ID: () => input.session.getPrimaryMailAccountId(),
      INBOX: async () =>
        input.session.currentInboxId ??
          (await readCredentials(input.session.files.credentialsFile)).inboxId,
      UPLOAD_URL: async () =>
        input.session.currentUploadUrl ??
          (await readCredentials(input.session.files.credentialsFile)).uploadUrl,
      DOWNLOAD_URL: async () =>
        input.session.currentDownloadUrl ??
          (await readCredentials(input.session.files.credentialsFile))
            .downloadUrl,
    },
  });

  const envelope = parseJmapEnvelope(
    raw,
    input.defaultUsing,
    input.sourceLabel,
  );

  if (input.dryRun) {
    return {
      ok: true,
      status: 200,
      bodyText: JSON.stringify(
        {
          dryRun: true,
          url: `${input.session.apiUrl.replace(/\/+$/, "")}/jmap/`,
          envelope,
        },
        null,
        2,
      ),
    };
  }

  const capabilityJwt = await input.session.getCapabilityToken();
  const { ok, status, bodyText } = await postJmap(
    input.session.apiUrl,
    capabilityJwt,
    envelope,
  );
  if (!ok) {
    return { ok, status, bodyText };
  }
  return { ok, status, bodyText: attachJmapNextHints(bodyText) };
}

export async function postJmap(
  apiUrl: string,
  capabilityJwt: string,
  envelope: JmapEnvelope,
): Promise<{ ok: boolean; status: number; bodyText: string }> {
  const base = apiUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/jmap/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${capabilityJwt}`,
    },
    body: JSON.stringify(envelope),
  });
  const bodyText = await res.text();
  return { ok: res.ok, status: res.status, bodyText };
}

const JMAP_NEXT_HINTS = [
  "Use jmap_request with Mailbox/get or Email/query to work with mail data.",
  "Use presets with $VAR placeholders — $ACCOUNT_ID and $INBOX come from the session; pass others via vars / --vars.",
  "Call help for the JMAP cheatsheet and troubleshooting.",
] as const;

/** Attach _next hints to a successful JMAP JSON object when parseable. */
export function attachJmapNextHints(bodyText: string): string {
  try {
    const obj = JSON.parse(bodyText) as Record<string, unknown>;
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      return JSON.stringify({ ...obj, _next: [...JMAP_NEXT_HINTS] }, null, 2);
    }
  } catch {
    // not JSON — return raw
  }
  return bodyText;
}
