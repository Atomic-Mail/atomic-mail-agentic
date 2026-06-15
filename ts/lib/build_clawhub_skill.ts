import { emptyDir, ensureDir } from "jsr:@std/fs@1";

export const DEFAULT_SKILL_NPM_DIR = "./skill_npm";
export const DEFAULT_SKILL_MD_SOURCE = "../docs/SKILL.md";
export const DEFAULT_OUT_DIR = "../integrations_dist/clawhub/atomicmail";

export const NPX_SKILL_INVOCATION =
  "npx --package=@atomicmail/agent-skill atomicmail";
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

const LAUNCHER_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$ROOT/lib/esm/skill/cli.js" "$@"
`;

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

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function copyDir(src: string, dest: string): Promise<void> {
  await ensureDir(dest);
  for await (const entry of Deno.readDir(src)) {
    const srcPath = `${src}/${entry.name}`;
    const destPath = `${dest}/${entry.name}`;
    if (entry.isDirectory) {
      await copyDir(srcPath, destPath);
    } else if (entry.isFile) {
      await Deno.copyFile(srcPath, destPath);
    }
  }
}

function joinPath(base: string, segment: string): string {
  return base.endsWith("/") ? `${base}${segment}` : `${base}/${segment}`;
}

export async function buildClawhubSkill(
  options: BuildClawhubSkillOptions,
): Promise<string> {
  const skillNpmDir = options.skillNpmDir ?? DEFAULT_SKILL_NPM_DIR;
  const skillMdSource = options.skillMdSource ?? DEFAULT_SKILL_MD_SOURCE;
  const outDir = options.outDir ?? DEFAULT_OUT_DIR;

  if (!await exists(skillNpmDir)) {
    throw new Error(
      `Missing ${skillNpmDir}. Run build_skill_npm.ts or build_all_npm.ts first.`,
    );
  }

  const esmSrc = joinPath(skillNpmDir, "esm");
  if (!await exists(esmSrc)) {
    throw new Error(`Missing ${esmSrc} in skill npm build output.`);
  }

  await emptyDir(outDir);
  await ensureDir(joinPath(outDir, "scripts"));
  await ensureDir(joinPath(outDir, "lib"));

  const skillMd = await Deno.readTextFile(skillMdSource);
  await Deno.writeTextFile(
    joinPath(outDir, "SKILL.md"),
    transformSkillMd(skillMd, options.version),
  );

  const launcherPath = joinPath(outDir, "scripts/atomicmail");
  await Deno.writeTextFile(launcherPath, LAUNCHER_SCRIPT);
  await Deno.chmod(launcherPath, 0o755);

  await copyDir(esmSrc, joinPath(outDir, "lib/esm"));

  const presetsSrc = joinPath(skillNpmDir, "presets");
  if (await exists(presetsSrc)) {
    await copyDir(presetsSrc, joinPath(outDir, "lib/presets"));
  }

  const sharedSrc = joinPath(skillNpmDir, "shared");
  if (!await exists(sharedSrc)) {
    throw new Error(
      `Missing ${sharedSrc}. Shared assets are required at runtime.`,
    );
  }
  await copyDir(sharedSrc, joinPath(outDir, "lib/shared"));

  await Deno.writeTextFile(
    joinPath(outDir, ".clawhubignore"),
    CLAWHUBIGNORE_CONTENT,
  );

  return outDir;
}
