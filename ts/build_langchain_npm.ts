// Build @atomicmail/langchain npm package using dnt.
//
// Usage:
//   deno run -A build_langchain_npm.ts [version]

import {
  buildNpmPackage,
  getPackageName,
  parseBuildArgs,
} from "./lib/build_npm.ts";
import { ATOMICMAIL_MCP_VERSION } from "./src/mcp/version.ts";

const { version: argVersion, channel } = parseBuildArgs(Deno.args);
if (channel) {
  throw new Error("langchain does not support channel variants");
}
const version = (argVersion ?? ATOMICMAIL_MCP_VERSION).replace(/^v/, "");

const dir = await buildNpmPackage({ product: "langchain", version });
const packageName = getPackageName("langchain");

console.log(`Built ${packageName}@${version} -> ./${dir}`);
