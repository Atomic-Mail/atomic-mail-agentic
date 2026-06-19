// JMAP execution for integration hosts (n8n bundle) — fetch-only, no node:fs.

import { JMAP_NEXT_HINTS } from "../../core/jmap-hints.ts";
import { inboxIdToMailboxEmail } from "../session/inbox-id-to-mailbox-email.ts";
import {
  assertBlobUploadEnvelopeWithinLimits,
  type JmapBlobUploadLimits,
} from "./agent-jmap-blob-limits.ts";
import { ensureTextCharsetOnEmailSetBlobParts } from "./agent-jmap-email-charset.ts";
import { substituteVars } from "./agent-vars.ts";

export type { JmapBlobUploadLimits } from "./agent-jmap-blob-limits.ts";

export const DEFAULT_JMAP_USING = [
  "urn:ietf:params:jmap:core",
  "urn:ietf:params:jmap:mail",
] as const;

export const BUNDLED_OPS_PRESET_NAMES = [
  "list_inbox.json",
  "reply.json",
  "send_mail.json",
  "send_mail_attachment.json",
  "send_mail_blob_attachment.json",
] as const;

export const JMAP_MAIL_URN = "urn:ietf:params:jmap:mail" as const;
export const JMAP_BLOB_URN = "urn:ietf:params:jmap:blob" as const;

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

export function extractJmapApiUrl(session: Record<string, unknown>): string {
  const u = session["apiUrl"];
  if (typeof u !== "string" || u.length === 0) {
    throw new Error("JMAP session missing apiUrl.");
  }
  return u;
}

function asNonNegativeInt(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  if (!Number.isInteger(v) || v < 0 || v > Number.MAX_SAFE_INTEGER) {
    return undefined;
  }
  return v;
}

export function extractBlobUploadLimits(
  session: Record<string, unknown>,
  accountId: string,
): JmapBlobUploadLimits | null {
  const accounts = session["accounts"];
  if (!accounts || typeof accounts !== "object") return null;
  const acc = (accounts as Record<string, unknown>)[accountId];
  if (!acc || typeof acc !== "object") return null;
  const caps = (acc as Record<string, unknown>)["accountCapabilities"];
  if (!caps || typeof caps !== "object") return null;
  const blob = (caps as Record<string, unknown>)[JMAP_BLOB_URN];
  if (!blob || typeof blob !== "object") return null;

  const b = blob as Record<string, unknown>;
  let maxSizeBlobSet: number | null = null;
  const rawMax = b["maxSizeBlobSet"];
  if (rawMax === null) {
    maxSizeBlobSet = null;
  } else {
    const n = asNonNegativeInt(rawMax);
    maxSizeBlobSet = n === undefined ? null : n;
  }

  const maxDs = asNonNegativeInt(b["maxDataSources"]);
  const out: JmapBlobUploadLimits = { maxSizeBlobSet };
  if (maxDs !== undefined) {
    out.maxDataSources = maxDs;
  }
  return out;
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

/** Integration JMAP session port (KeyValue-backed AgentSession). */
export interface IntegrationJmapSessionPort {
  readonly apiUrl: string;
  getJmapPostUrl(): Promise<string>;
  getPrimaryMailAccountId(): Promise<string>;
  getCapabilityToken(): Promise<string>;
  readonly currentInboxId?: string;
  readonly currentUploadUrl?: string;
  readonly currentDownloadUrl?: string;
  getBlobUploadLimitsForAccount(
    accountId: string,
  ): Promise<JmapBlobUploadLimits | null>;
}

export interface RunJmapRequestInput {
  session: IntegrationJmapSessionPort;
  opsJson: string;
  defaultUsing: string[];
  sourceLabel: string;
  dryRun?: boolean;
  vars?: Record<string, string>;
}

export async function runJmapRequest(
  input: RunJmapRequestInput,
): Promise<{ ok: boolean; status: number; bodyText: string }> {
  const mergedVars = input.vars ?? {};

  const { text: raw } = await substituteVars({
    raw: input.opsJson,
    vars: mergedVars,
    autoResolvers: {
      ACCOUNT_ID: () => input.session.getPrimaryMailAccountId(),
      INBOX: async () => {
        const rawInbox = input.session.currentInboxId;
        if (!rawInbox) {
          throw new Error("No inbox in session; run register first.");
        }
        return inboxIdToMailboxEmail(rawInbox);
      },
      INBOX_MAILBOX_ID: () => fetchInboxMailboxId(input.session),
      UPLOAD_URL: async () => {
        if (input.session.currentUploadUrl) {
          return input.session.currentUploadUrl;
        }
        throw new Error("JMAP session missing uploadUrl.");
      },
      DOWNLOAD_URL: async () => {
        if (input.session.currentDownloadUrl) {
          return input.session.currentDownloadUrl;
        }
        throw new Error("JMAP session missing downloadUrl.");
      },
    },
  });

  const envelope = parseJmapEnvelope(
    raw,
    input.defaultUsing,
    input.sourceLabel,
  );

  ensureTextCharsetOnEmailSetBlobParts(envelope);
  await enforceJmapBlobUploadLimitsIfApplicable(input.session, envelope);

  const jmapPostUrl = await input.session.getJmapPostUrl();

  if (input.dryRun) {
    return {
      ok: true,
      status: 200,
      bodyText: JSON.stringify(
        { dryRun: true, url: jmapPostUrl, envelope },
        null,
        2,
      ),
    };
  }

  const capabilityJwt = await input.session.getCapabilityToken();
  const { ok, status, bodyText } = await postJmap(
    jmapPostUrl,
    capabilityJwt,
    envelope,
  );
  if (!ok) {
    return { ok, status, bodyText };
  }
  return { ok, status, bodyText: attachJmapNextHints(bodyText) };
}

export async function fetchInboxMailboxId(
  port: IntegrationJmapSessionPort,
): Promise<string> {
  const accountId = await port.getPrimaryMailAccountId();
  const capabilityJwt = await port.getCapabilityToken();
  const envelope: JmapEnvelope = {
    using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
    methodCalls: [
      ["Mailbox/query", { accountId, filter: { role: "inbox" } }, "mq0"],
    ],
  };
  const jmapPostUrl = await port.getJmapPostUrl();
  const { ok, status, bodyText } = await postJmap(
    jmapPostUrl,
    capabilityJwt,
    envelope,
  );
  if (!ok) {
    throw new Error(`Mailbox/query failed (HTTP ${status}): ${bodyText}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new Error("Mailbox/query response is not valid JSON.");
  }
  const responses = (parsed as { methodResponses?: unknown[][] })
    .methodResponses;
  const first = responses?.[0];
  if (!Array.isArray(first) || first[0] === "error") {
    throw new Error(`Mailbox/query failed: ${bodyText}`);
  }
  if (first[0] !== "Mailbox/query") {
    throw new Error(`Mailbox/query failed: ${bodyText}`);
  }
  const payload = first[1] as { ids?: string[] };
  const id = payload.ids?.[0];
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Mailbox/query returned no inbox mailbox id.");
  }
  return id;
}

function collectBlobUploadAccountIds(envelope: JmapEnvelope): string[] {
  const ids = new Set<string>();
  for (const call of envelope.methodCalls) {
    if (!Array.isArray(call) || call[0] !== "Blob/upload") continue;
    const arg = call[1];
    if (!arg || typeof arg !== "object") continue;
    const aid = (arg as Record<string, unknown>)["accountId"];
    if (typeof aid === "string" && aid.length > 0) ids.add(aid);
  }
  return [...ids];
}

async function enforceJmapBlobUploadLimitsIfApplicable(
  session: IntegrationJmapSessionPort,
  envelope: JmapEnvelope,
): Promise<void> {
  if (!envelope.using.includes(JMAP_BLOB_URN)) return;
  const hasUpload = envelope.methodCalls.some(
    (c) => Array.isArray(c) && c[0] === "Blob/upload",
  );
  if (!hasUpload) return;

  const accountIds = collectBlobUploadAccountIds(envelope);
  const limitsByAccount = new Map<string, JmapBlobUploadLimits | null>();
  for (const id of accountIds) {
    limitsByAccount.set(
      id,
      await session.getBlobUploadLimitsForAccount(id),
    );
  }
  assertBlobUploadEnvelopeWithinLimits(envelope, limitsByAccount);
}

export async function postJmap(
  jmapPostUrl: string,
  capabilityJwt: string,
  envelope: JmapEnvelope,
): Promise<{ ok: boolean; status: number; bodyText: string }> {
  const res = await fetch(jmapPostUrl, {
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

export function attachJmapNextHints(bodyText: string): string {
  try {
    const obj = JSON.parse(bodyText) as Record<string, unknown>;
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      return JSON.stringify({ ...obj, _next: [...JMAP_NEXT_HINTS] }, null, 2);
    }
  } catch {
    // not JSON
  }
  return bodyText;
}
