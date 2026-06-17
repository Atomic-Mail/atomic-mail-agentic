import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import {
  BUNDLED_CLI_INVOCATION,
  DEFAULT_SKILL_MANIFEST_PATH,
  DEFAULT_SKILL_TEMPLATE_PATH,
  HERMES_CLI_INVOCATION,
  loadSkillManifest,
  NPX_SKILL_INVOCATION,
  PLACEHOLDER_CLI,
  readSkillTemplate,
  renderSkillMd,
  transformSkillMdForBundled,
  transformSkillMdForClawhub,
  transformSkillMdForHermes,
} from "./lib/skill_md_transform.ts";

const TEST_VERSION = "9.9.9-test";

Deno.test("loadSkillManifest reads shared manifest", () => {
  const manifest = loadSkillManifest(DEFAULT_SKILL_MANIFEST_PATH);
  assertEquals(manifest.name, "atomicmail");
  assertEquals(manifest.cliInvocations.bundledBody, BUNDLED_CLI_INVOCATION);
  assertEquals(manifest.cliInvocations.hermesBlueprint, HERMES_CLI_INVOCATION);
});

Deno.test("renderSkillMd npm profile substitutes npx CLI and minimal frontmatter", async () => {
  const template = await readSkillTemplate(DEFAULT_SKILL_TEMPLATE_PATH);
  const result = renderSkillMd({
    profile: "npm",
    version: TEST_VERSION,
    template,
  });

  assertStringIncludes(result, NPX_SKILL_INVOCATION);
  assert(!result.includes(PLACEHOLDER_CLI));
  assert(!result.includes(BUNDLED_CLI_INVOCATION));
  assertStringIncludes(result, "credentials directory: `~/.atomicmail`");
  assertStringIncludes(result, `name: atomicmail`);
  assert(!result.includes("metadata:"));
  assert(!result.includes("## Platform notes"));
});

Deno.test("renderSkillMd bundled profile substitutes baseDir CLI and merged frontmatter", async () => {
  const template = await readSkillTemplate(DEFAULT_SKILL_TEMPLATE_PATH);
  const result = renderSkillMd({
    profile: "bundled",
    version: TEST_VERSION,
    template,
  });

  assertStringIncludes(result, BUNDLED_CLI_INVOCATION);
  assert(!result.includes(NPX_SKILL_INVOCATION));
  assert(!result.includes(PLACEHOLDER_CLI));
  assertStringIncludes(result, `version: ${TEST_VERSION}`);
  assertStringIncludes(result, "metadata:");
  assertStringIncludes(result, "openclaw:");
  assertStringIncludes(result, '"bins":["node"]');
  assertStringIncludes(result, "hermes:");
  assertStringIncludes(result, "blueprint:");
  assertStringIncludes(
    result,
    `${HERMES_CLI_INVOCATION} jmap_request --ops-file list_inbox.json`,
  );
  assertStringIncludes(result, "required_environment_variables:");
  assertStringIncludes(result, "required_credential_files:");
  assertStringIncludes(result, "## Platform notes");
  assertStringIncludes(result, "/suggestions");
  assert(!result.includes("./jmap.md#"));
});

Deno.test("renderSkillMd bundled body uses baseDir not HERMES_SKILL_DIR in examples", async () => {
  const template = await readSkillTemplate(DEFAULT_SKILL_TEMPLATE_PATH);
  const result = renderSkillMd({
    profile: "bundled",
    version: TEST_VERSION,
    template,
  });

  const bodyStart = result.indexOf("\n---", 3) + 4;
  const body = result.slice(bodyStart);
  assertStringIncludes(body, BUNDLED_CLI_INVOCATION);
  assert(!body.includes(HERMES_CLI_INVOCATION));
});

Deno.test("transformSkillMdForBundled migrates legacy docs/SKILL.md shape", async () => {
  const docsSkill = await Deno.readTextFile("../docs/SKILL.md");
  const result = transformSkillMdForBundled(docsSkill, TEST_VERSION);

  assertStringIncludes(result, BUNDLED_CLI_INVOCATION);
  assert(!result.includes(NPX_SKILL_INVOCATION));
  assertStringIncludes(result, `version: ${TEST_VERSION}`);
  assertStringIncludes(result, "metadata:");
});

Deno.test("transformSkillMdForClawhub builds openclaw-only frontmatter from legacy docs", async () => {
  const docsSkill = await Deno.readTextFile("../docs/SKILL.md");
  const result = transformSkillMdForClawhub(docsSkill, TEST_VERSION);

  assertStringIncludes(result, BUNDLED_CLI_INVOCATION);
  assertStringIncludes(result, `version: ${TEST_VERSION}`);
  assertStringIncludes(result, 'metadata: {"openclaw":');
  assert(!result.includes("\n  hermes:"));
  assert(!result.includes(NPX_SKILL_INVOCATION));
});

Deno.test("transformSkillMdForHermes builds hermes frontmatter and notes from legacy docs", async () => {
  const docsSkill = await Deno.readTextFile("../docs/SKILL.md");
  const result = transformSkillMdForHermes(docsSkill, TEST_VERSION);

  assertStringIncludes(result, HERMES_CLI_INVOCATION);
  assertStringIncludes(result, `version: ${TEST_VERSION}`);
  assertStringIncludes(result, "metadata:");
  assertStringIncludes(result, "\n  hermes:");
  assertStringIncludes(result, 'schedule: "0 * * * *"');
  assertStringIncludes(result, "required_environment_variables:");
  assertStringIncludes(result, "required_credential_files:");
  assertStringIncludes(result, "## Hermes Agent notes");
  assert(!result.includes(NPX_SKILL_INVOCATION));
});

Deno.test("renderSkillMd replaces version on bundled re-render", async () => {
  const template = await readSkillTemplate(DEFAULT_SKILL_TEMPLATE_PATH);
  const first = renderSkillMd({
    profile: "bundled",
    version: "1.0.0",
    template,
  });
  const second = renderSkillMd({
    profile: "bundled",
    version: "2.0.0",
    template,
  });

  assertStringIncludes(first, "version: 1.0.0");
  assertStringIncludes(second, "version: 2.0.0");
  assert(!second.includes("version: 1.0.0"));
});
