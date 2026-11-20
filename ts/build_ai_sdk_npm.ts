// Build @atomicmail/ai-sdk npm package using dnt.
//
// Usage:
//   deno run -A build_ai_sdk_npm.ts [version]

import {
  buildNpmPackage,
  getPackageName,
  parseBuildArgs,
} from "./lib/build_npm.ts";
import { ATOMICMAIL_MCP_VERSION } from "./src/mcp/version.ts";

const { version: argVersion, channel } = parseBuildArgs(Deno.args);
if (channel) {
  throw new Error("ai-sdk does not support channel variants");
}
const version = (argVersion ?? ATOMICMAIL_MCP_VERSION).replace(/^v/, "");

const dir = await buildNpmPackage({ product: "ai-sdk", version });
const packageName = getPackageName("ai-sdk");

console.log(`Built ${packageName}@${version} -> ./${dir}`);
