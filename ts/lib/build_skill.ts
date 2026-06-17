import {
  buildSkillBundle,
  DEFAULT_SKILL_NPM_DIR,
  joinPath,
} from "./build_skill_bundle.ts";
import { renderSkillMd } from "./skill_md_transform.ts";

export {
  DEFAULT_SKILL_NPM_DIR,
  LAUNCHER_SCRIPT,
} from "./build_skill_bundle.ts";

export const DEFAULT_OUT_DIR = "../dist/skill/atomicmail";

export interface BuildSkillOptions {
  version: string;
  skillNpmDir?: string;
  outDir?: string;
  launcherScript?: string;
}

export async function buildSkill(options: BuildSkillOptions): Promise<string> {
  const skillNpmDir = options.skillNpmDir ?? DEFAULT_SKILL_NPM_DIR;
  const outDir = options.outDir ?? DEFAULT_OUT_DIR;

  await buildSkillBundle({
    skillNpmDir,
    outDir,
    launcherScript: options.launcherScript,
  });

  await Deno.writeTextFile(
    joinPath(outDir, "SKILL.md"),
    renderSkillMd({
      profile: "bundled",
      version: options.version,
    }),
  );

  return outDir;
}
