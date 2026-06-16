import {
  buildSkillBundle,
  DEFAULT_SKILL_NPM_DIR,
  joinPath,
  NPX_SKILL_INVOCATION,
} from "./build_skill_bundle.ts";

export {
  DEFAULT_SKILL_NPM_DIR,
  NPX_SKILL_INVOCATION,
} from "./build_skill_bundle.ts";

export const DEFAULT_SKILL_MD_SOURCE = "../docs/SKILL.md";
export const DEFAULT_OUT_DIR = "../integrations_dist/clawhub/atomicmail";

export const CLAWHUB_CLI_INVOCATION = "{baseDir}/scripts/atomicmail";

export const CLAWHUB_OPENCLAW_METADATA = {
  requires: { bins: ["node"] },
  homepage: "https://atomicmail.ai",
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
  const body = content.replaceAll(NPX_SKILL_INVOCATION, CLAWHUB_CLI_INVOCATION);
  if (!body.startsWith("---")) {
    throw new Error("SKILL.md must start with YAML frontmatter.");
  }

  const end = body.indexOf("\n---", 3);
  if (end === -1) {
    throw new Error("SKILL.md frontmatter is missing a closing --- delimiter.");
  }

  const frontmatter = body.slice(3, end).trim();
  const rest = body.slice(end + 4);

  const lines = frontmatter.split("\n").filter((line) =>
    line.trim().length > 0
  );
  const filtered = lines.filter((line) => {
    const key = line.split(":")[0]?.trim();
    return key !== "version" && key !== "metadata";
  });

  filtered.push(`version: ${version}`);
  filtered.push(
    `metadata: ${JSON.stringify({ openclaw: CLAWHUB_OPENCLAW_METADATA })}`,
  );

  return `---\n${filtered.join("\n")}\n---${rest}`;
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
    transformSkillMd(skillMd, options.version),
  );

  await Deno.writeTextFile(
    joinPath(outDir, ".clawhubignore"),
    CLAWHUBIGNORE_CONTENT,
  );

  return outDir;
}
