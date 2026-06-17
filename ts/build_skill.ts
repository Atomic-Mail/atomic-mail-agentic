import { buildSkill } from "./lib/build_skill.ts";
import { parseReleaseVersion } from "./lib/version.ts";
import { ATOMICMAIL_MCP_VERSION } from "./src/mcp/version.ts";

const rawVersion = Deno.args[0];
const version = rawVersion
  ? parseReleaseVersion(rawVersion)
  : ATOMICMAIL_MCP_VERSION;

const outDir = await buildSkill({ version });
console.log(`Built bundled skill atomicmail@${version} -> ./${outDir}`);
