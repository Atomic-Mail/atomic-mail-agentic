import { emptyDir } from "@deno/dnt";

import { parseReleaseVersion } from "./lib/version.ts";
import { ATOMICMAIL_MCP_VERSION } from "./src/mcp/version.ts";

const ROOT = new URL("../", import.meta.url);
const SOURCE_DIR = new URL(
  "../integrations/openclaw/atomicmail/",
  import.meta.url,
);
const OUT_DIR = new URL(
  "../integrations_dist/openclaw/atomicmail/",
  import.meta.url,
);

const rawVersion = Deno.args[0];
const version = rawVersion
  ? parseReleaseVersion(rawVersion)
  : ATOMICMAIL_MCP_VERSION;

async function copyDir(src: URL, dest: URL): Promise<void> {
  await Deno.mkdir(dest, { recursive: true });
  for await (const entry of Deno.readDir(src)) {
    const srcPath = new URL(entry.name, src);
    const destPath = new URL(entry.name, dest);
    if (entry.isDirectory) {
      await copyDir(new URL(`${entry.name}/`, src), new URL(`${entry.name}/`, dest));
    } else if (entry.isFile) {
      await Deno.copyFile(srcPath, destPath);
    }
  }
}

function stampVersion(text: string): string {
  return text.replace(/"version":\s*"[^"]+"/, `"version": "${version}"`);
}

async function stampVersionFile(path: URL): Promise<void> {
  const text = await Deno.readTextFile(path);
  await Deno.writeTextFile(path, stampVersion(text));
}

await stampVersionFile(new URL("package.json", SOURCE_DIR));
await stampVersionFile(new URL("openclaw.plugin.json", SOURCE_DIR));

await emptyDir(new URL("./", OUT_DIR).pathname);
await copyDir(SOURCE_DIR, OUT_DIR);
await Deno.copyFile(
  new URL("LICENSE", ROOT),
  new URL("LICENSE", OUT_DIR),
);

await stampVersionFile(new URL("package.json", OUT_DIR));
await stampVersionFile(new URL("openclaw.plugin.json", OUT_DIR));

await Deno.mkdir(new URL("dist/", OUT_DIR), { recursive: true });
await Deno.copyFile(
  new URL("src/index.js", OUT_DIR),
  new URL("dist/index.js", OUT_DIR),
);

console.log(
  `Built OpenClaw wrapper @atomicmail/openclaw-atomicmail@${version} -> ./integrations_dist/openclaw/atomicmail`,
);
