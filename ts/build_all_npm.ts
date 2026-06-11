// Build all npm products (mcp + agent-skill) for default and every channel.
//
// Usage:
//   deno run -A build_all_npm.ts <version>   # CI / release (semver required)
//   deno run -A build_all_npm.ts             # local fallback from version.ts

import {
  buildNpmPackage,
  getPackageName,
  loadChannels,
  supportsChannelProduct,
} from "./lib/build_npm.ts";
import { parseReleaseVersion, syncSourceVersion } from "./lib/version.ts";
import { ATOMICMAIL_MCP_VERSION } from "./src/mcp/version.ts";

const rawVersion = Deno.args[0];
const version = rawVersion
  ? parseReleaseVersion(rawVersion)
  : ATOMICMAIL_MCP_VERSION;

if (rawVersion) {
  await syncSourceVersion(version);
}
const channels = loadChannels();
const targets: Array<{ product: "mcp" | "skill"; channel?: string }> = [
  { product: "mcp" },
  { product: "skill" },
  ...channels.flatMap((channel) =>
    (["mcp", "skill"] as const)
      .filter((product) => supportsChannelProduct(channel, product))
      .map((product) => ({ product, channel: channel.name }))
  ),
];

for (const target of targets) {
  const dir = await buildNpmPackage({ ...target, version });
  const packageName = getPackageName(target.product, target.channel);
  console.log(`Built ${packageName}@${version} -> ./${dir}`);
}

console.log(
  `Done: ${targets.length} packages at version ${version} (${channels.length} configured channel entries).`,
);
