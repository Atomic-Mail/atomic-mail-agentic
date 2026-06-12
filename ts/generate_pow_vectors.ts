import { resolve as resolvePath } from "node:path";

import { DEFAULT_POW_SCRYPT_SALT_HEX } from "./src/lib/core/consts.ts";
import { solvePow } from "./src/lib/agent/auth/agent-pow.ts";

interface PowVectorCase {
  challenge: string;
  difficulty: number;
}

interface PowVectorOutput extends PowVectorCase {
  nonce: string;
  powHex: string;
  salt: string;
}

const CASES: PowVectorCase[] = [
  { challenge: "fixture-alpha", difficulty: 4 },
  { challenge: "fixture-beta", difficulty: 6 },
  { challenge: "fixture-gamma", difficulty: 8 },
];

const OUT_PATH = resolvePath(Deno.cwd(), "..", "shared", "fixtures", "pow_vectors.json");

async function main(): Promise<void> {
  const vectors: PowVectorOutput[] = [];
  for (const testCase of CASES) {
    const solved = await solvePow(
      testCase.challenge,
      testCase.difficulty,
      DEFAULT_POW_SCRYPT_SALT_HEX,
    );
    vectors.push({
      ...testCase,
      nonce: solved.nonce,
      powHex: solved.powHex,
      salt: DEFAULT_POW_SCRYPT_SALT_HEX,
    });
  }

  await Deno.mkdir(resolvePath(OUT_PATH, ".."), { recursive: true });
  await Deno.writeTextFile(
    OUT_PATH,
    JSON.stringify(
      {
        generated_by: "ts/generate_pow_vectors.ts",
        scrypt: { N: 16384, r: 8, p: 1, dklen: 64 },
        vectors,
      },
      null,
      2,
    ) + "\n",
  );

  console.log(`Wrote ${vectors.length} vectors to ${OUT_PATH}`);
}

if (import.meta.main) {
  await main();
}
