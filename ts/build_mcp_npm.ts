// Build the @atomicmail/mcp npm package using dnt.
// https://jsr.io/@deno/dnt
//
// Usage:  deno run -A build_npm.ts [version]
//
// The output goes to ./npm and ships a single CLI:
//   atomicmail-mcp  -> src/main.ts
//
// After build, the binary can be invoked from Node, Bun, or Deno via:
//   npx -y @atomicmail/mcp
//   bunx @atomicmail/mcp
//   deno run -A npm:@atomicmail/mcp/atomicmail-mcp
//
// In an MCP host (Cursor, Claude Desktop, ...) you would typically wire it in
// as:
//   { "command": "npx", "args": ["-y", "@atomicmail/mcp"] }
// See README.md for the full list of host-specific config snippets.

import { build, emptyDir } from "@deno/dnt";

const version = (Deno.args[0] ?? "0.1.0").replace(/^v/, "");
const PRESET_FILES = [
  "send_mail.json",
  "send_mail_attachment.json",
  "list_inbox.json",
  "reply.json",
] as const;

const DIR = "mcp_npm";
const SHARED_PRESET_DIR = "./src/lib/agent/jmap/presets";
const LICENCE_FILE = { path: "../LICENCE", targetPath: "LICENCE" };
const README_FILE = { path: "../docs/mcp.md", targetPath: "README.md" };

await emptyDir(DIR);

await build({
  entryPoints: [
    {
      kind: "bin",
      name: "atomicmail-mcp",
      path: "./src/mcp/main.ts",
    },
  ],
  outDir: `./${DIR}`,
  // Source uses only `node:*` imports + native fetch + the MCP SDK; no Deno
  // globals to shim.
  shims: {
    deno: false,
  },
  // No test files in this package.
  test: false,
  // CLI-only; ESM keeps top-level await + bin shebangs simple.
  scriptModule: false,
  typeCheck: false,
  compilerOptions: {
    lib: ["ES2022", "DOM"],
    target: "ES2022",
  },
  package: {
    name: "@atomicmail/mcp",
    version,
    description:
      "Atomic Mail MCP server — local stdio proxy with PoW auth and JMAP, for AI agents.",
    license: "MIT",
    keywords: [
      "atomic-mail",
      "atomicmail",
      "mcp",
      "model-context-protocol",
      "agent",
      "ai",
      "jmap",
      "esp",
      "email",
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
    // @types/node is required for `node:` import resolution during the
    // type-check phase of dnt.
    devDependencies: {
      "@types/node": "^20.12.0",
    },
  },

  // Copy human-readable assets next to the published package so npm and JSR
  // viewers render them.
  async postBuild() {
    for (const file of [LICENCE_FILE, README_FILE]) {
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

console.log(`Built @atomicmail/mcp@${version} -> ./${DIR}`);
