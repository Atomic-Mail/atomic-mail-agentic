/** Web Crypto for @noble/hashes (n8n Cloud-safe, no globalThis literal). */
export const crypto: Crypto | undefined =
  typeof self !== "undefined" && "crypto" in self ? self.crypto : undefined;
