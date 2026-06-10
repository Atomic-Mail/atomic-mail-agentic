// Build the @atomicmail/mcp npm package using dnt.
//
// Usage:
//   deno run -A build_mcp_npm.ts [version]
//   deno run -A build_mcp_npm.ts [version] --channel=github
//
// Default (no --channel) writes to ./mcp_npm.
// Channel builds write to ./mcp_npm_{channel}.

import {
  buildNpmPackage,
  getPackageName,
  parseBuildArgs,
} from "./lib/build_npm.ts";
import { ATOMICMAIL_MCP_VERSION } from "./src/mcp/version.ts";

const { version: argVersion, channel } = parseBuildArgs(Deno.args);
const version = (argVersion ?? ATOMICMAIL_MCP_VERSION).replace(/^v/, "");

const dir = await buildNpmPackage({ product: "mcp", version, channel });
const packageName = getPackageName("mcp", channel);

console.log(`Built ${packageName}@${version} -> ./${dir}`);
