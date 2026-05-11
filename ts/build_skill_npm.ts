// Build @atomicmail/agent-skill npm package using dnt.
//
// Usage:  deno run -A build_npm.ts [version]
//
// Single CLI: atomicmail -> src/skill/cli.ts
//   npx atomicmail register --username ...
//   npx atomicmail jmap_request --ops-file ...
//   npx atomicmail help

import { build, emptyDir } from "@deno/dnt";

import { ATOMICMAIL_MCP_VERSION } from "./src/mcp/version.ts";

const version = (Deno.args[0] ?? ATOMICMAIL_MCP_VERSION).replace(/^v/, "");
const PRESET_FILES = [
  "send_mail.json",
  "send_mail_attachment.json",
  "send_mail_blob_attachment.json",
  "list_inbox.json",
  "reply.json",
] as const;

const DIR = "skill_npm";
const SHARED_PRESET_DIR = "./src/lib/agent/jmap/presets";
const LICENCE_FILE = { path: "../LICENCE", targetPath: "LICENCE" };
const README_FILE = {
  path: "../docs/skill-install.md",
  targetPath: "README.md",
};
const SKILL_FILE = { path: "../docs/SKILL.md", targetPath: "SKILL.md" };

await emptyDir(DIR);

await build({
  entryPoints: [
    {
      kind: "bin",
      name: "atomicmail",
      path: "./src/skill/cli.ts",
    },
  ],
  outDir: `./${DIR}`,
  shims: {
    deno: false,
  },
  test: false,
  scriptModule: false,
  typeCheck: false,
  compilerOptions: {
    lib: ["ES2022", "DOM"],
    target: "ES2022",
  },
  package: {
    name: "@atomicmail/agent-skill",
    version,
    description:
      "Atomic Mail AgentSkill — register, jmap_request, and help CLI for AI agents.",
    license: "MIT",
    keywords: [
      "atomic-mail",
      "atomicmail",
      "agentskills",
      "agent",
      "ai",
      "jmap",
      "esp",
      "email",
      "mcp",
      "proof-of-work",
    ],
    repository: {
      type: "git",
      url: "git+https://github.com/atomic-mail/agentic-clients.git",
    },
    bugs: {
      url: "https://github.com/atomic-mail/agentic-clients/issues",
    },
    engines: {
      node: ">=20",
    },
    publishConfig: {
      access: "public",
    },
    devDependencies: {
      "@types/node": "^20.12.0",
    },
  },
  async postBuild() {
    for (const file of [README_FILE, SKILL_FILE, LICENCE_FILE]) {
      try {
        await Deno.copyFile(file.path, `${DIR}/${file.targetPath}`);
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) throw err;
      }
    }
    await Deno.mkdir(`${DIR}/presets`, { recursive: true });
    for (const file of PRESET_FILES) {
      await Deno.copyFile(
        `${SHARED_PRESET_DIR}/${file}`,
        `${DIR}/presets/${file}`,
      );
    }
  },
});

console.log(`Built @atomicmail/agent-skill@${version} -> ./${DIR}`);
