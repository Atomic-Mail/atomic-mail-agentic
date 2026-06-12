// Publish all built npm packages from ts/*_npm* output dirs.
//
// Usage:  deno run -A publish_all_npm.ts
//
// Skips packages whose name@version already exists on the registry.

import { listBuiltPackageDirs } from "./lib/build_npm.ts";

interface PackageJson {
  name: string;
  version: string;
}

async function readPackageJson(dir: string): Promise<PackageJson> {
  const text = await Deno.readTextFile(`${dir}/package.json`);
  return JSON.parse(text) as PackageJson;
}

async function versionExistsOnRegistry(
  name: string,
  version: string,
): Promise<boolean> {
  const command = new Deno.Command("npm", {
    args: ["view", `${name}@${version}`, "version"],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout } = await command.output();
  if (code !== 0) return false;
  return new TextDecoder().decode(stdout).trim() === version;
}

async function publishPackage(dir: string): Promise<"published" | "skipped"> {
  const pkg = await readPackageJson(dir);
  const label = `${pkg.name}@${pkg.version}`;

  if (await versionExistsOnRegistry(pkg.name, pkg.version)) {
    console.log(`Skip ${label} (already on registry)`);
    return "skipped";
  }

  console.log(`Publishing ${label} from ./${dir} ...`);
  const command = new Deno.Command("npm", {
    args: ["publish", "--access", "public"],
    cwd: dir,
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await command.output();
  if (code !== 0) {
    throw new Error(`npm publish failed for ${label} (exit ${code})`);
  }

  console.log(`Published ${label}`);
  return "published";
}

const dirs = listBuiltPackageDirs({ publishableOnly: true });
if (dirs.length === 0) {
  console.error("No built npm dirs found. Run build_all_npm.ts first.");
  Deno.exit(1);
}

let published = 0;
let skipped = 0;

for (const dir of dirs) {
  const result = await publishPackage(dir);
  if (result === "published") published++;
  else skipped++;
}

console.log(
  `Done: ${published} published, ${skipped} skipped (${dirs.length} total).`,
);
