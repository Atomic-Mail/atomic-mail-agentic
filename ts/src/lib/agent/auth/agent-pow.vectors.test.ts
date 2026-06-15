import { assert, assertEquals } from "@std/assert";
import { scryptSync } from "node:crypto";

import { readSharedJson } from "../../core/shared-assets.ts";
import { solvePow } from "./agent-pow.ts";

interface PowFixture {
  vectors: Array<{
    challenge: string;
    difficulty: number;
    salt: string;
    nonce: string;
    powHex: string;
  }>;
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

Deno.test("solvePow matches shared fixture vectors", async () => {
  const fixture = readSharedJson<PowFixture>("fixtures/pow_vectors.json");

  for (const vector of fixture.vectors) {
    const solved = await solvePow(
      vector.challenge,
      vector.difficulty,
      vector.salt,
    );
    assertEquals(solved.nonce, vector.nonce);
    assertEquals(solved.powHex, vector.powHex);
  }
});

Deno.test("shared pow vectors satisfy difficulty", () => {
  const fixture = readSharedJson<PowFixture>("fixtures/pow_vectors.json");

  for (const vector of fixture.vectors) {
    const derived = scryptSync(
      `${vector.challenge}:${vector.nonce}`,
      vector.salt,
      64,
      { N: 16384, r: 8, p: 1 },
    );
    const digest = new Uint8Array(derived);
    assert(
      hasLeadingZeroBits(digest, vector.difficulty),
      `Vector failed difficulty check: ${vector.challenge}`,
    );
  }
});
