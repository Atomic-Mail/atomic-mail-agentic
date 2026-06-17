import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import {
  buildSkill,
  DEFAULT_OUT_DIR,
  LAUNCHER_SCRIPT,
} from "./lib/build_skill.ts";

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

Deno.test("buildSkill default output path is in dist", () => {
  assertEquals(DEFAULT_OUT_DIR, "../dist/skill/atomicmail");
});

Deno.test("buildSkill produces unified bundled skill layout", async () => {
  if (!await skillNpmReady()) {
    console.log("skip buildSkill layout test: run build_skill_npm.ts first");
    return;
  }

  const buildRoot = ".test-skill-build";
  const outDir = `${buildRoot}/dist/skill/atomicmail`;

  try {
    await Deno.mkdir(buildRoot, { recursive: true });
    const built = await buildSkill({
      version: TEST_VERSION,
      skillNpmDir: SKILL_NPM_DIR,
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

    const skillMd = await Deno.readTextFile(`${outDir}/SKILL.md`);
    assertStringIncludes(skillMd, "{baseDir}/scripts/atomicmail");
    assert(!skillMd.includes("npx --package"));
    assertStringIncludes(skillMd, `version: ${TEST_VERSION}`);
    assertStringIncludes(skillMd, "metadata:");
    assertStringIncludes(skillMd, "openclaw:");
    assertStringIncludes(skillMd, "hermes:");
    assertStringIncludes(skillMd, "## Platform notes");
  } finally {
    await Deno.remove(buildRoot, { recursive: true });
  }
});

Deno.test("buildSkill launcher runs help overview", async () => {
  if (!await skillNpmReady()) {
    console.log("skip buildSkill launcher test: run build_skill_npm.ts first");
    return;
  }

  const runPerm = await Deno.permissions.query({ name: "run" });
  if (runPerm.state !== "granted") {
    console.log(
      "skip launcher test: grant --allow-run to execute scripts/atomicmail",
    );
    return;
  }

  const buildRoot = ".test-skill-build";
  const outDir = `${buildRoot}/dist/skill/atomicmail`;

  try {
    await Deno.mkdir(buildRoot, { recursive: true });
    await buildSkill({
      version: TEST_VERSION,
      skillNpmDir: SKILL_NPM_DIR,
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

Deno.test("buildSkill default launcher remains node wrapper", () => {
  assertStringIncludes(
    LAUNCHER_SCRIPT,
    'exec node "$ROOT/lib/esm/skill/cli.js"',
  );
});
