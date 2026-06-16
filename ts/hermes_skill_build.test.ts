import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import {
  buildHermesSkill,
  HERMES_CLI_INVOCATION,
  HERMES_CREDENTIALS_DIR,
  NPX_SKILL_INVOCATION,
  transformHermesSkillMd,
} from "./lib/build_hermes_skill.ts";

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

Deno.test("transformHermesSkillMd replaces npx invocations and injects Hermes frontmatter", () => {
  const source = `---
name: atomicmail
description: Test skill.
---

\`\`\`bash
${NPX_SKILL_INVOCATION} help
\`\`\`
`;

  const result = transformHermesSkillMd(source, TEST_VERSION);
  assertStringIncludes(result, HERMES_CLI_INVOCATION);
  assert(!result.includes(NPX_SKILL_INVOCATION));
  assertStringIncludes(result, `version: ${TEST_VERSION}`);
  assertStringIncludes(result, 'schedule: "0 * * * *"');
  assertStringIncludes(result, "deliver: origin");
  assertStringIncludes(result, "no_agent: false");
  assertStringIncludes(result, "name: ATOMIC_MAIL_CREDENTIALS_DIR");
  assertStringIncludes(result, "name: ATOMIC_MAIL_API_KEY");
  assertStringIncludes(result, "path: atomicmail/credentials.json");
  assertStringIncludes(result, "path: atomicmail/session.jwt");
  assertStringIncludes(result, "path: atomicmail/capability.jwt");
  assertStringIncludes(result, HERMES_CREDENTIALS_DIR);
  assertStringIncludes(result, "## Hermes Agent notes");
});

Deno.test("transformHermesSkillMd replaces existing version and metadata lines", () => {
  const source = `---
name: atomicmail
version: 0.1.0
metadata: {"old":true}
description: Test skill.
---
`;

  const result = transformHermesSkillMd(source, TEST_VERSION);
  assert(!result.includes("version: 0.1.0"));
  assert(!result.includes('metadata: {"old":true}'));
  assertStringIncludes(result, `version: ${TEST_VERSION}`);
  assertStringIncludes(result, "metadata:");
  assertStringIncludes(result, "blueprint:");
});

Deno.test("buildHermesSkill produces Hermes skill layout", async () => {
  if (!await skillNpmReady()) {
    console.log(
      "skip buildHermesSkill layout test: run build_skill_npm.ts first",
    );
    return;
  }

  const buildRoot = ".test-hermes-build";
  const outDir = `${buildRoot}/hermes/atomicmail`;

  try {
    await Deno.mkdir(buildRoot, { recursive: true });

    const built = await buildHermesSkill({
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
    ];
    for (const path of requiredPaths) {
      await Deno.stat(path);
    }

    let clawhubIgnoreExists = false;
    try {
      await Deno.stat(`${outDir}/.clawhubignore`);
      clawhubIgnoreExists = true;
    } catch {
      clawhubIgnoreExists = false;
    }
    assertEquals(clawhubIgnoreExists, false);

    const skillMd = await Deno.readTextFile(`${outDir}/SKILL.md`);
    assertStringIncludes(skillMd, HERMES_CLI_INVOCATION);
    assertStringIncludes(skillMd, `version: ${TEST_VERSION}`);
    assertStringIncludes(skillMd, HERMES_CREDENTIALS_DIR);
    assert(!skillMd.includes("npx --package"));
    assertStringIncludes(skillMd, "`~/.hermes/atomicmail`");
  } finally {
    await Deno.remove(buildRoot, { recursive: true });
  }
});

Deno.test("buildHermesSkill launcher runs help overview", async () => {
  if (!await skillNpmReady()) {
    console.log(
      "skip buildHermesSkill launcher test: run build_skill_npm.ts first",
    );
    return;
  }

  const runPerm = await Deno.permissions.query({ name: "run" });
  if (runPerm.state !== "granted") {
    console.log(
      "skip launcher test: grant --allow-run to execute scripts/atomicmail",
    );
    return;
  }

  const buildRoot = ".test-hermes-build";
  const outDir = `${buildRoot}/hermes/atomicmail`;

  try {
    await Deno.mkdir(buildRoot, { recursive: true });
    await buildHermesSkill({
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
