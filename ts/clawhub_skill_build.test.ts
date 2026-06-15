import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import {
  buildClawhubSkill,
  CLAWHUB_CLI_INVOCATION,
  CLAWHUB_OPENCLAW_METADATA,
  NPX_SKILL_INVOCATION,
  transformSkillMd,
} from "./lib/build_clawhub_skill.ts";

const TEST_VERSION = "9.9.9-test";
const SKILL_NPM_DIR = "./skill_npm";

async function skillNpmReady(): Promise<boolean> {
  try {
    await Deno.stat(`${SKILL_NPM_DIR}/esm/skill/cli.js`);
    return true;
  } catch {
    return false;
  }
}

Deno.test("transformSkillMd replaces npx invocations and injects version metadata", () => {
  const source = `---
name: atomicmail
description: Test skill.
---

\`\`\`bash
${NPX_SKILL_INVOCATION} help
\`\`\`
`;

  const result = transformSkillMd(source, TEST_VERSION);
  assertStringIncludes(result, CLAWHUB_CLI_INVOCATION);
  assert(!result.includes(NPX_SKILL_INVOCATION));
  assertStringIncludes(result, `version: ${TEST_VERSION}`);
  assertStringIncludes(
    result,
    `metadata: ${JSON.stringify({ openclaw: CLAWHUB_OPENCLAW_METADATA })}`,
  );
});

Deno.test("transformSkillMd replaces existing version and metadata lines", () => {
  const source = `---
name: atomicmail
version: 0.1.0
metadata: {"old":true}
description: Test skill.
---
`;

  const result = transformSkillMd(source, TEST_VERSION);
  assert(!result.includes("version: 0.1.0"));
  assert(!result.includes('metadata: {"old":true}'));
  assertStringIncludes(result, `version: ${TEST_VERSION}`);
  assertStringIncludes(
    result,
    `metadata: ${JSON.stringify({ openclaw: CLAWHUB_OPENCLAW_METADATA })}`,
  );
});

Deno.test("buildClawhubSkill produces ClawHub skill layout", async () => {
  if (!await skillNpmReady()) {
    console.log(
      "skip buildClawhubSkill layout test: run build_skill_npm.ts first",
    );
    return;
  }

  const buildRoot = ".test-clawhub-build";
  const outDir = `${buildRoot}/clawhub/atomicmail`;

  try {
    await Deno.mkdir(buildRoot, { recursive: true });

    const built = await buildClawhubSkill({
      version: TEST_VERSION,
      skillNpmDir: SKILL_NPM_DIR,
      skillMdSource: "../docs/SKILL.md",
      outDir,
    });
    assertEquals(built, outDir);

    const requiredPaths = [
      `${outDir}/SKILL.md`,
      `${outDir}/scripts/atomicmail`,
      `${outDir}/lib/esm/skill/cli.js`,
      `${outDir}/lib/presets/list_inbox.json`,
      `${outDir}/lib/shared/manifest.json`,
      `${outDir}/.clawhubignore`,
    ];
    for (const path of requiredPaths) {
      await Deno.stat(path);
    }

    const skillMd = await Deno.readTextFile(`${outDir}/SKILL.md`);
    assertStringIncludes(skillMd, CLAWHUB_CLI_INVOCATION);
    assertStringIncludes(skillMd, `version: ${TEST_VERSION}`);
    assert(!skillMd.includes("npx --package"));
  } finally {
    await Deno.remove(buildRoot, { recursive: true });
  }
});

Deno.test("buildClawhubSkill launcher runs help overview", async () => {
  if (!await skillNpmReady()) {
    console.log(
      "skip buildClawhubSkill launcher test: run build_skill_npm.ts first",
    );
    return;
  }

  const runPerm = await Deno.permissions.query({ name: "run" });
  if (runPerm.state !== "granted") {
    console.log("skip launcher test: grant --allow-run to execute scripts/atomicmail");
    return;
  }

  const buildRoot = ".test-clawhub-build";
  const outDir = `${buildRoot}/clawhub/atomicmail`;

  try {
    await Deno.mkdir(buildRoot, { recursive: true });
    await buildClawhubSkill({
      version: TEST_VERSION,
      skillNpmDir: SKILL_NPM_DIR,
      skillMdSource: "../docs/SKILL.md",
      outDir,
    });

    const launcher = new Deno.Command("bash", {
      args: [`${outDir}/scripts/atomicmail`, "help", "--topic", "overview"],
      stdout: "piped",
      stderr: "piped",
    });
    const { code, stdout, stderr } = await launcher.output();
    assertEquals(code, 0, new TextDecoder().decode(stderr));
    assertStringIncludes(
      new TextDecoder().decode(stdout),
      "Atomic Mail",
    );
  } finally {
    await Deno.remove(buildRoot, { recursive: true });
  }
});
