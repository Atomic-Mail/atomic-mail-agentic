import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import { buildClawhubSkill } from "./lib/build_clawhub_skill.ts";
import { buildHermesSkill } from "./lib/build_hermes_skill.ts";
import { buildSkill } from "./lib/build_skill.ts";

const TEST_VERSION = "9.9.9-test";
const SKILL_NPM_DIR = "./skill_npm";

function extractRelativeMarkdownLinks(markdown: string): string[] {
  const links: string[] = [];
  const re = /\[[^\]]+\]\(([^)]+)\)/g;
  for (const match of markdown.matchAll(re)) {
    const target = match[1] ?? "";
    if (
      target.startsWith("http://") || target.startsWith("https://") ||
      target.startsWith("mailto:") || target.startsWith("#")
    ) {
      continue;
    }
    links.push(target.split("#")[0] ?? target);
  }
  return links.filter((target) => target.length > 0);
}

async function skillNpmReady(): Promise<boolean> {
  try {
    await Deno.stat(`${SKILL_NPM_DIR}/esm/skill/cli.js`);
    return true;
  } catch {
    return false;
  }
}

Deno.test("unified rollout reuses one npm overlay across channels", async () => {
  if (!await skillNpmReady()) {
    console.log("skip unified rollout test: run build_skill_npm.ts first");
    return;
  }

  const buildRoot = ".test-unified-rollout";
  const bundledOut = `${buildRoot}/dist/skill/atomicmail`;
  const clawhubOut = `${buildRoot}/clawhub/atomicmail`;
  const hermesOut = `${buildRoot}/hermes/atomicmail`;

  try {
    await Deno.mkdir(buildRoot, { recursive: true });

    await buildSkill({
      version: TEST_VERSION,
      skillNpmDir: SKILL_NPM_DIR,
      outDir: bundledOut,
    });
    await buildClawhubSkill({
      version: TEST_VERSION,
      skillNpmDir: SKILL_NPM_DIR,
      skillMdSource: "../docs/SKILL.md",
      outDir: clawhubOut,
    });
    await buildHermesSkill({
      version: TEST_VERSION,
      skillNpmDir: SKILL_NPM_DIR,
      skillMdSource: "../docs/SKILL.md",
      outDir: hermesOut,
    });

    for (
      const relPath of [
        "lib/esm/skill/cli.js",
        "lib/shared/manifest.json",
        "lib/presets/list_inbox.json",
      ]
    ) {
      const bundled = await Deno.readFile(`${bundledOut}/${relPath}`);
      const clawhub = await Deno.readFile(`${clawhubOut}/${relPath}`);
      const hermes = await Deno.readFile(`${hermesOut}/${relPath}`);
      assertEquals(clawhub, bundled, `clawhub mismatch for ${relPath}`);
      assertEquals(hermes, bundled, `hermes mismatch for ${relPath}`);
    }

    const bundledSkillMdPath = `${bundledOut}/SKILL.md`;
    const bundledSkillMd = await Deno.readTextFile(bundledSkillMdPath);
    assertStringIncludes(bundledSkillMd, "openclaw:");
    assertStringIncludes(bundledSkillMd, "hermes:");
    assertStringIncludes(bundledSkillMd, "{baseDir}/scripts/atomicmail");
    assert(!bundledSkillMd.includes("npx --package"));

    const clawhubSkillMdPath = `${clawhubOut}/SKILL.md`;
    const clawhubSkillMd = await Deno.readTextFile(clawhubSkillMdPath);
    assertStringIncludes(clawhubSkillMd, 'metadata: {"openclaw":');
    assertStringIncludes(clawhubSkillMd, "{baseDir}/scripts/atomicmail");
    assert(!clawhubSkillMd.includes("npx --package"));

    const hermesSkillMd = await Deno.readTextFile(`${hermesOut}/SKILL.md`);
    assertStringIncludes(hermesSkillMd, "  hermes:");
    assertStringIncludes(
      hermesSkillMd,
      "${HERMES_SKILL_DIR}/scripts/atomicmail",
    );
    assert(!hermesSkillMd.includes("npx --package"));

    for (const link of extractRelativeMarkdownLinks(bundledSkillMd)) {
      await Deno.stat(new URL(link, `file://${bundledOut}/`).pathname);
    }
    for (const link of extractRelativeMarkdownLinks(clawhubSkillMd)) {
      await Deno.stat(new URL(link, `file://${clawhubOut}/`).pathname);
    }
    for (const link of extractRelativeMarkdownLinks(hermesSkillMd)) {
      await Deno.stat(new URL(link, `file://${hermesOut}/`).pathname);
    }
  } finally {
    await Deno.remove(buildRoot, { recursive: true });
  }
});
