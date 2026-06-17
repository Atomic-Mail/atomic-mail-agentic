import { emptyDir, ensureDir } from "jsr:@std/fs@1";

export const DEFAULT_SKILL_NPM_DIR = "./skill_npm";

export const NPX_SKILL_INVOCATION =
  "npx --package=@atomicmail/agent-skill-gh-pages atomicmail";

export const LAUNCHER_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$ROOT/lib/esm/skill/cli.js" "$@"
`;

export interface BuildSkillBundleOptions {
  skillNpmDir?: string;
  outDir: string;
  launcherScript?: string;
}

export async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

export async function copyDir(src: string, dest: string): Promise<void> {
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

export function joinPath(base: string, segment: string): string {
  return base.endsWith("/") ? `${base}${segment}` : `${base}/${segment}`;
}

export async function buildSkillBundle(
  options: BuildSkillBundleOptions,
): Promise<string> {
  const skillNpmDir = options.skillNpmDir ?? DEFAULT_SKILL_NPM_DIR;
  const outDir = options.outDir;

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

  const launcherPath = joinPath(outDir, "scripts/atomicmail");
  await Deno.writeTextFile(
    launcherPath,
    options.launcherScript ?? LAUNCHER_SCRIPT,
  );
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

  return outDir;
}
