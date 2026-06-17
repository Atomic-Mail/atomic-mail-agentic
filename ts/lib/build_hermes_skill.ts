import {
  buildSkillBundle,
  DEFAULT_SKILL_NPM_DIR,
  joinPath,
} from "./build_skill_bundle.ts";
import {
  HERMES_SKILLIGNORE_CONTENT,
  pruneHermesSkillBundle,
} from "./hermes_skill_bundle.ts";
import {
  renderSkillMd,
  transformSkillMdForHermes,
} from "./skill_md_transform.ts";

export {
  DEFAULT_SKILL_NPM_DIR,
  NPX_SKILL_INVOCATION,
} from "./build_skill_bundle.ts";
export {
  HERMES_CLI_INVOCATION,
  HERMES_CREDENTIALS_DIR,
} from "./skill_md_transform.ts";

export const DEFAULT_SKILL_MD_SOURCE = "../shared/skill/SKILL.template.md";
export const DEFAULT_OUT_DIR = "../integrations_dist/hermes/atomicmail";

export const HERMES_LAUNCHER_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
if [ -z "\${ATOMIC_MAIL_CREDENTIALS_DIR:-}" ]; then
  export ATOMIC_MAIL_CREDENTIALS_DIR="\${HOME}/.hermes/atomicmail"
fi
exec node "$ROOT/lib/esm/skill/cli.js" "$@"
`;

export interface BuildHermesSkillOptions {
  version: string;
  skillNpmDir?: string;
  skillMdSource?: string;
  outDir?: string;
}

export function transformHermesSkillMd(
  content: string,
  version: string,
): string {
  return transformSkillMdForHermes(content, version);
}

export async function buildHermesSkill(
  options: BuildHermesSkillOptions,
): Promise<string> {
  const skillNpmDir = options.skillNpmDir ?? DEFAULT_SKILL_NPM_DIR;
  const skillMdSource = options.skillMdSource ?? DEFAULT_SKILL_MD_SOURCE;
  const outDir = options.outDir ?? DEFAULT_OUT_DIR;

  await buildSkillBundle({
    skillNpmDir,
    outDir,
    launcherScript: HERMES_LAUNCHER_SCRIPT,
  });

  await pruneHermesSkillBundle(outDir);

  const skillMd = await Deno.readTextFile(skillMdSource);
  await Deno.writeTextFile(
    joinPath(outDir, "SKILL.md"),
    skillMdSource.endsWith("SKILL.template.md")
      ? renderSkillMd({
        profile: "hermes",
        version: options.version,
        template: skillMd,
      })
      : transformHermesSkillMd(skillMd, options.version),
  );

  await Deno.writeTextFile(
    joinPath(outDir, ".skillignore"),
    HERMES_SKILLIGNORE_CONTENT,
  );

  return outDir;
}
