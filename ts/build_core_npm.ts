// Build the @atomicmail/agentic-core npm package using dnt.
//
// Usage:
//   deno run -A build_core_npm.ts [version]

import {
  buildNpmPackage,
  getPackageName,
  parseBuildArgs,
} from "./lib/build_npm.ts";
import { ATOMICMAIL_MCP_VERSION } from "./src/mcp/version.ts";

const { version: argVersion } = parseBuildArgs(Deno.args);
const version = (argVersion ?? ATOMICMAIL_MCP_VERSION).replace(/^v/, "");

const dir = await buildNpmPackage({ product: "core", version });
const packageName = getPackageName("core");

console.log(`Built ${packageName}@${version} -> ./${dir}`);
