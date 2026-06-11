// Publish GitHub Packages npm variants from ts/*_npm_gpr output dirs.
//
// Usage:  deno run -A publish_github_packages_npm.ts
//
// Skips packages whose name@version already exists on GitHub Packages.

import { listGithubPackagesDirs } from "./lib/build_npm.ts";

const GPR_REGISTRY = "https://npm.pkg.github.com";

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
    args: [
      "view",
      `${name}@${version}`,
      "version",
      `--registry=${GPR_REGISTRY}`,
    ],
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
    console.log(`Skip ${label} (already on GitHub Packages)`);
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

const dirs = listGithubPackagesDirs();
if (dirs.length === 0) {
  console.error(
    "No GitHub Packages npm dirs configured. Run build_github_packages_npm.ts first.",
  );
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
