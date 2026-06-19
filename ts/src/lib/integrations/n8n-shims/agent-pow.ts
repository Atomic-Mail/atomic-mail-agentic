// PoW scrypt for n8n vendor bundle — pure JS (@noble/hashes), no node:crypto.

import { scrypt } from "@noble/hashes/scrypt";

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, dkLen: 64 } as const;
const POW_HASH_BYTES = 64;

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function hasLeadingZeroBits(hash: Uint8Array, bits: number): boolean {
  if (bits > hash.length * 8) return false;
  const fullBytes = Math.floor(bits / 8);
  const remainingBits = bits % 8;
  for (let i = 0; i < fullBytes; i++) {
    if (hash[i] !== 0) return false;
  }
  if (remainingBits > 0) {
    const mask = (0xff << (8 - remainingBits)) & 0xff;
    if ((hash[fullBytes] & mask) !== 0) return false;
  }
  return true;
}

function scryptHash(data: string, salt: string): Uint8Array {
  const bytes = new TextEncoder().encode(data);
  const derived = scrypt(bytes, salt, SCRYPT_PARAMS);
  if (derived.length !== POW_HASH_BYTES) {
    throw new Error(
      `scrypt returned ${derived.length} bytes, expected ${POW_HASH_BYTES}.`,
    );
  }
  return derived;
}

export async function solvePow(
  challenge: string,
  difficulty: number,
  salt: string,
  onProgress?: (nonce: bigint) => void,
): Promise<{ powHex: string; nonce: string }> {
  let nonce = 0n;
  while (true) {
    const digest = scryptHash(`${challenge}:${nonce}`, salt);
    if (hasLeadingZeroBits(digest, difficulty)) {
      return { powHex: bytesToHex(digest), nonce: nonce.toString() };
    }
    nonce++;
    if (onProgress && nonce % 64n === 0n) onProgress(nonce);
  }
}
