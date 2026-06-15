import { buildClawhubSkill } from "./lib/build_clawhub_skill.ts";
import { parseReleaseVersion } from "./lib/version.ts";
import { ATOMICMAIL_MCP_VERSION } from "./src/mcp/version.ts";

const rawVersion = Deno.args[0];
const version = rawVersion
  ? parseReleaseVersion(rawVersion)
  : ATOMICMAIL_MCP_VERSION;

const outDir = await buildClawhubSkill({ version });
console.log(`Built ClawHub skill atomicmail@${version} -> ./${outDir}`);
