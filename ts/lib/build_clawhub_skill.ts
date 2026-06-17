import {
  buildSkillBundle,
  DEFAULT_SKILL_NPM_DIR,
  joinPath,
} from "./build_skill_bundle.ts";
import {
  loadSkillManifest,
  renderSkillMd,
  transformSkillMdForClawhub,
} from "./skill_md_transform.ts";

export {
  DEFAULT_SKILL_NPM_DIR,
  NPX_SKILL_INVOCATION,
} from "./build_skill_bundle.ts";

export const DEFAULT_SKILL_MD_SOURCE = "../shared/skill/SKILL.template.md";
export const DEFAULT_OUT_DIR = "../integrations_dist/clawhub/atomicmail";

export const CLAWHUB_CLI_INVOCATION = "{baseDir}/scripts/atomicmail";

const SKILL_MANIFEST = loadSkillManifest();
export const CLAWHUB_OPENCLAW_METADATA = {
  requires: SKILL_MANIFEST.openclaw.requires,
  homepage: SKILL_MANIFEST.openclaw.homepage,
} as const;

const CLAWHUBIGNORE_CONTENT = [
  "**/*.d.ts",
  "**/*.d.ts.map",
  "src/",
  "node_modules/",
].join("\n") + "\n";

export interface BuildClawhubSkillOptions {
  version: string;
  skillNpmDir?: string;
  skillMdSource?: string;
  outDir?: string;
}

export function transformSkillMd(content: string, version: string): string {
  return transformSkillMdForClawhub(content, version);
}

export async function buildClawhubSkill(
  options: BuildClawhubSkillOptions,
): Promise<string> {
  const skillNpmDir = options.skillNpmDir ?? DEFAULT_SKILL_NPM_DIR;
  const skillMdSource = options.skillMdSource ?? DEFAULT_SKILL_MD_SOURCE;
  const outDir = options.outDir ?? DEFAULT_OUT_DIR;

  await buildSkillBundle({ skillNpmDir, outDir });

  const skillMd = await Deno.readTextFile(skillMdSource);
  await Deno.writeTextFile(
    joinPath(outDir, "SKILL.md"),
    skillMdSource.endsWith("SKILL.template.md")
      ? renderSkillMd({
        profile: "clawhub",
        version: options.version,
        template: skillMd,
      })
      : transformSkillMd(skillMd, options.version),
  );

  await Deno.writeTextFile(
    joinPath(outDir, ".clawhubignore"),
    CLAWHUBIGNORE_CONTENT,
  );

  return outDir;
}
