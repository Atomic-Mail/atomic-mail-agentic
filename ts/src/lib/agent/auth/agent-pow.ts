// PoW scrypt — mirrors services/auth-service/src/crypto.ts.

import { scrypt } from "node:crypto";

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
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

function scryptHash(data: string, salt: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(data);
  return new Promise((resolve, reject) => {
    scrypt(bytes, salt, POW_HASH_BYTES, SCRYPT_PARAMS, (err, derived) => {
      if (err) return reject(err);
      resolve(new Uint8Array(derived));
    });
  });
}

export async function solvePow(
  challenge: string,
  difficulty: number,
  salt: string,
  onProgress?: (nonce: bigint) => void,
): Promise<{ powHex: string; nonce: string }> {
  let nonce = 0n;
  while (true) {
    const digest = await scryptHash(`${challenge}:${nonce}`, salt);
    if (hasLeadingZeroBits(digest, difficulty)) {
      return { powHex: bytesToHex(digest), nonce: nonce.toString() };
    }
    nonce++;
    if (onProgress && nonce % 64n === 0n) onProgress(nonce);
  }
}
