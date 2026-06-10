// Build @atomicmail/agent-skill npm package using dnt.
//
// Usage:
//   deno run -A build_skill_npm.ts [version]
//   deno run -A build_skill_npm.ts [version] --channel=github
//
// Default (no --channel) writes to ./skill_npm.
// Channel builds write to ./skill_npm_{channel}.

import {
  buildNpmPackage,
  getPackageName,
  parseBuildArgs,
} from "./lib/build_npm.ts";
import { ATOMICMAIL_MCP_VERSION } from "./src/mcp/version.ts";

const { version: argVersion, channel } = parseBuildArgs(Deno.args);
const version = (argVersion ?? ATOMICMAIL_MCP_VERSION).replace(/^v/, "");

const dir = await buildNpmPackage({ product: "skill", version, channel });
const packageName = getPackageName("skill", channel);

console.log(`Built ${packageName}@${version} -> ./${dir}`);
