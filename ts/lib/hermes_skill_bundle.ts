import { joinPath } from "./build_skill_bundle.ts";

/** Gitignore-style paths excluded from Hermes skills_guard scans (see skills_guard.py). */
export const HERMES_SKILLIGNORE_CONTENT = [
  "# TypeScript / build artifacts — not used at runtime",
  "**/*.d.ts",
  "**/*.d.ts.map",
  "**/*.js.map",
  "",
  "# Deno npm shim; required by cli.js but triggers eval obfuscation heuristics",
  "lib/esm/_dnt.polyfills.js",
  "",
  "# Embedded help fallbacks duplicate lib/shared/help (cron/host/$VAR false positives)",
  "lib/esm/lib/agent/jmap/help-content/**",
  "lib/shared/help/**",
].join("\n") + "\n";

const PRUNE_SUFFIXES = [".d.ts", ".d.ts.map", ".js.map"] as const;

function parseSkillignorePatterns(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function skillignoreMatch(rel: string, pattern: string): boolean {
  const norm = rel.replace(/\\/g, "/");
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return norm === prefix || norm.startsWith(`${prefix}/`);
  }
  if (pattern.includes("*")) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(
      /\*\*/g,
      ".*",
    ).replace(/\*/g, "[^/]*");
    return new RegExp(`^${escaped}$`).test(norm);
  }
  return norm === pattern;
}

function isSkillignoreExcluded(rel: string, patterns: string[]): boolean {
  if (rel === ".skillignore" || rel === ".clawhubignore") return true;
  return patterns.some((pattern) => skillignoreMatch(rel, pattern));
}

export async function countScannedSkillFiles(
  outDir: string,
  skillignoreContent = HERMES_SKILLIGNORE_CONTENT,
): Promise<number> {
  const patterns = parseSkillignorePatterns(skillignoreContent);
  let count = 0;
  for await (const entry of walkFiles(outDir)) {
    if (!isSkillignoreExcluded(entry, patterns)) count += 1;
  }
  return count;
}

async function* walkFiles(dir: string, prefix = ""): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const path = joinPath(dir, entry.name);
    if (entry.isDirectory) {
      yield* walkFiles(path, rel);
    } else if (entry.isFile) {
      yield rel;
    }
  }
}

export async function pruneHermesSkillBundle(outDir: string): Promise<void> {
  for await (const entry of Deno.readDir(outDir)) {
    const path = joinPath(outDir, entry.name);
    if (entry.isDirectory) {
      await pruneHermesSkillBundle(path);
      continue;
    }
    if (!entry.isFile) continue;
    if (PRUNE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) {
      await Deno.remove(path);
    }
  }
}

export async function countSkillFiles(outDir: string): Promise<number> {
  let count = 0;
  for await (const entry of Deno.readDir(outDir)) {
    const path = joinPath(outDir, entry.name);
    if (entry.isDirectory) {
      count += await countSkillFiles(path);
    } else if (entry.isFile) {
      count += 1;
    }
  }
  return count;
}
