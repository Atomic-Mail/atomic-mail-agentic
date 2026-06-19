// RFC 8620 binary blob upload helpers (fetch-only — safe for n8n Cloud bundle).

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
