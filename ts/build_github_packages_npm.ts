// Build GitHub Packages npm variants (@atomic-mail/* on npm.pkg.github.com).
//
// Usage:
//   deno run -A build_github_packages_npm.ts <version>   # CI / release
//   deno run -A build_github_packages_npm.ts             # local fallback from version.ts

import { buildGithubPackagesNpm } from "./lib/build_npm.ts";
import { parseReleaseVersion } from "./lib/version.ts";
import { ATOMICMAIL_MCP_VERSION } from "./src/mcp/version.ts";

const rawVersion = Deno.args[0];
const version = rawVersion
  ? parseReleaseVersion(rawVersion)
  : ATOMICMAIL_MCP_VERSION;

const dirs = await buildGithubPackagesNpm(version);
for (const dir of dirs) {
  const pkg = JSON.parse(await Deno.readTextFile(`${dir}/package.json`));
  console.log(`Built ${pkg.name}@${version} -> ./${dir}`);
}

console.log(`Done: ${dirs.length} GitHub Packages at version ${version}.`);
