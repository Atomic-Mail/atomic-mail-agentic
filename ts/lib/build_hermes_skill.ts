import {
  buildSkillBundle,
  DEFAULT_SKILL_NPM_DIR,
  joinPath,
  NPX_SKILL_INVOCATION,
} from "./build_skill_bundle.ts";
import {
  HERMES_SKILLIGNORE_CONTENT,
  pruneHermesSkillBundle,
} from "./hermes_skill_bundle.ts";
import {
  buildHermesFrontmatter,
  HERMES_CLI_INVOCATION,
  HERMES_CREDENTIALS_DIR,
} from "./hermes_skill_frontmatter.ts";

export {
  DEFAULT_SKILL_NPM_DIR,
  NPX_SKILL_INVOCATION,
} from "./build_skill_bundle.ts";
export {
  buildHermesFrontmatter,
  HERMES_CLI_INVOCATION,
  HERMES_CREDENTIALS_DIR,
} from "./hermes_skill_frontmatter.ts";

export const DEFAULT_SKILL_MD_SOURCE = "../docs/SKILL.md";
export const DEFAULT_OUT_DIR = "../integrations_dist/hermes/atomicmail";

export const HERMES_LAUNCHER_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
if [ -z "\${ATOMIC_MAIL_CREDENTIALS_DIR:-}" ]; then
  export ATOMIC_MAIL_CREDENTIALS_DIR="\${HOME}/.hermes/atomicmail"
fi
exec node "$ROOT/lib/esm/skill/cli.js" "$@"
`;

const HERMES_APPENDIX_HEADER = "## Hermes Agent notes";
const HERMES_APPENDIX = [
  HERMES_APPENDIX_HEADER,
  "",
  `- **Credentials directory:** Default \`${HERMES_CREDENTIALS_DIR}\` (not \`~/.atomicmail\`). The skill launcher sets \`ATOMIC_MAIL_CREDENTIALS_DIR\` when unset; operator env or \`atomicmail.credentials_dir\` config overrides it.`,
  "- **After register:** Accept the hourly inbox blueprint via `/suggestions` — do not skip inbox polling setup.",
  `- **Never cron raw CLI:** Do not schedule \`${HERMES_CLI_INVOCATION} jmap_request\` alone without an agent turn. The blueprint uses \`no_agent: false\` so each run is a full agent session with \`list_inbox.json\`.`,
  "- **Multi-account:** Pass `--credentials-dir` on `register` / `jmap_request` only when operating multiple inboxes at once — not needed for the default single-inbox flow.",
].join("\n");

export interface BuildHermesSkillOptions {
  version: string;
  skillNpmDir?: string;
  skillMdSource?: string;
  outDir?: string;
}

function extractSkillBody(content: string): string {
  if (!content.startsWith("---")) {
    throw new Error("SKILL.md must start with YAML frontmatter.");
  }

  const end = content.indexOf("\n---", 3);
  if (end === -1) {
    throw new Error("SKILL.md frontmatter is missing a closing --- delimiter.");
  }

  return content.slice(end + 4);
}

function replaceHermesCredentialPaths(body: string): string {
  return body.replaceAll("~/.atomicmail", HERMES_CREDENTIALS_DIR);
}

function appendHermesNotes(body: string): string {
  if (body.includes(HERMES_APPENDIX_HEADER)) {
    return body;
  }
  const trimmed = body.replace(/\s+$/, "");
  return `${trimmed}\n\n${HERMES_APPENDIX}\n`;
}

export function transformHermesSkillMd(
  content: string,
  version: string,
): string {
  const withCli = content.replaceAll(
    NPX_SKILL_INVOCATION,
    HERMES_CLI_INVOCATION,
  );
  const body = appendHermesNotes(
    replaceHermesCredentialPaths(extractSkillBody(withCli)),
  );
  const frontmatter = buildHermesFrontmatter(version);
  return `---\n${frontmatter}\n---${body}`;
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
    transformHermesSkillMd(skillMd, options.version),
  );

  await Deno.writeTextFile(
    joinPath(outDir, ".skillignore"),
    HERMES_SKILLIGNORE_CONTENT,
  );

  return outDir;
}
