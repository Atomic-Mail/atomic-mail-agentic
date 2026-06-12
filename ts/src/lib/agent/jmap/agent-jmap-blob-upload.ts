// RFC 8620 binary blob upload (session uploadUrl) for jmap_request attachment paths.

import { readFile } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import { cwd } from "node:process";

import { readCredentials } from "../session/agent-credentials-store.ts";
import { assertAttachmentBytesWithinBlobLimit } from "./agent-jmap-blob-limits.ts";
import type { JmapSessionPort } from "./agent-jmap.ts";

/** One local file to upload before `$ATTACHMENT_*` substitution in ops JSON. */
export interface JmapAttachmentInput {
  path: string;
  filename?: string;
  contentType?: string;
}

const EXT_TO_MIME: Record<string, string> = {
  ".txt": "text/plain",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".xml": "application/xml",
};

export function guessMimeTypeFromFilename(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  return EXT_TO_MIME[lower.slice(dot)] ?? "application/octet-stream";
}

export function expandUploadUrl(template: string, accountId: string): string {
  return template
    .replaceAll("%7BaccountId%7D", accountId)
    .replaceAll("{accountId}", accountId);
}

export async function postBinaryBlobUpload(
  uploadUrlExpanded: string,
  capabilityJwt: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<{ blobId: string; size: number }> {
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const res = await fetch(uploadUrlExpanded, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${capabilityJwt}`,
      "Content-Type": contentType,
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `RFC 8620 binary upload failed (HTTP ${res.status}) for ${uploadUrlExpanded}: ${text}`,
    );
  }
  const j = JSON.parse(text) as { blobId?: string; size?: number };
  if (typeof j.blobId !== "string" || j.blobId.length === 0) {
    throw new Error(`Upload response missing blobId: ${text}`);
  }
  return { blobId: j.blobId, size: typeof j.size === "number" ? j.size : 0 };
}

/**
 * Reads each file, POSTs bytes to the JMAP session `uploadUrl`, and returns
 * placeholder values for use in standard JMAP ops (same batch as
 * `Email/set` / `EmailSubmission/set`).
 *
 * Injected keys (strings): `ATTACHMENT_0_BLOB_ID`, `ATTACHMENT_0_NAME`,
 * `ATTACHMENT_0_TYPE`, `ATTACHMENT_0_SIZE`, … zero-based index per file, plus
 * `ATTACHMENT_COUNT`.
 */
export async function buildVarsFromAttachmentFiles(
  session: JmapSessionPort,
  attachments: JmapAttachmentInput[],
  pathBase: string = cwd(),
): Promise<Record<string, string>> {
  if (attachments.length === 0) return {};

  const accountId = await session.getPrimaryMailAccountId();
  const limits = await session.getBlobUploadLimitsForAccount(accountId);
  const capabilityJwt = await session.getCapabilityToken();
  const creds = await readCredentials(session.files.credentialsFile);
  const uploadTemplate = session.currentUploadUrl ?? creds.uploadUrl;
  const uploadUrlExpanded = expandUploadUrl(uploadTemplate, accountId);

  const prepared: {
    bytes: Uint8Array;
    filename: string;
    contentType: string;
  }[] = [];

  for (let i = 0; i < attachments.length; i++) {
    const a = attachments[i]!;
    const abs = isAbsolute(a.path) ? a.path : resolve(pathBase, a.path);
    const buf = await readFile(abs);
    const bytes = buf as Uint8Array;
    const filename = a.filename ?? basename(abs);
    const contentType = a.contentType ?? guessMimeTypeFromFilename(filename);
    prepared.push({ bytes, filename, contentType });
  }

  assertAttachmentBytesWithinBlobLimit(
    prepared.map((p) => ({
      label: p.filename,
      byteLength: p.bytes.byteLength,
    })),
    limits,
  );

  const vars: Record<string, string> = {};
  for (let i = 0; i < prepared.length; i++) {
    const { bytes, filename, contentType } = prepared[i]!;
    const { blobId, size } = await postBinaryBlobUpload(
      uploadUrlExpanded,
      capabilityJwt,
      bytes,
      contentType,
    );
    vars[`ATTACHMENT_${i}_BLOB_ID`] = blobId;
    vars[`ATTACHMENT_${i}_NAME`] = filename;
    vars[`ATTACHMENT_${i}_TYPE`] = contentType;
    vars[`ATTACHMENT_${i}_SIZE`] = String(size);
  }
  vars["ATTACHMENT_COUNT"] = String(attachments.length);
  return vars;
}
