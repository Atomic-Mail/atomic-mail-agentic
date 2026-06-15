import { copy, emptyDir, ensureDir } from "jsr:@std/fs@1";
import {
  getChannelConfig,
  getOutputDir,
  getPackageName,
} from "./lib/build_npm.ts";
import { parseReleaseVersion } from "./lib/version.ts";

interface PackageJson {
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  repository?: {
    type?: string;
    url?: string;
  };
}

const CHANNEL = "anthropic";
const DEFAULT_ARTIFACT_BASE_NAME = "atomicmail-anthropic";
const DEFAULT_AUTHOR_NAME = "Atomic Mail";
const DEFAULT_AUTHOR_URL = "https://atomicmail.ai";
const DEFAULT_LICENSE = "MIT";
const DEFAULT_REPOSITORY = {
  type: "git",
  url: "git+https://github.com/Atomic-Mail/agentic-clients.git",
};
const MANIFEST_TEMPLATE_PATH = "./mcpb_anthropic_manifest.template.json";

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function readBuiltPackageJson(dir: string): Promise<PackageJson> {
  const text = await Deno.readTextFile(`${dir}/package.json`);
  return JSON.parse(text) as PackageJson;
}

function getArtifactBaseName(): string {
  return getChannelConfig(CHANNEL)?.mcpb?.artifactBaseName ??
    DEFAULT_ARTIFACT_BASE_NAME;
}

async function renderManifest(
  pkg: PackageJson,
  version: string,
): Promise<string> {
  const template = await Deno.readTextFile(MANIFEST_TEMPLATE_PATH);
  const repository = pkg.repository || DEFAULT_REPOSITORY;
  const replacements: Record<string, string> = {
    "__PACKAGE_NAME__": pkg.name,
    "__VERSION__": version,
    "__DESCRIPTION__": pkg.description,
    "__AUTHOR_NAME__": pkg.author || DEFAULT_AUTHOR_NAME,
    "__AUTHOR_URL__": DEFAULT_AUTHOR_URL,
    "__LICENSE__": pkg.license || DEFAULT_LICENSE,
    "__REPOSITORY_TYPE__": repository.type || DEFAULT_REPOSITORY.type,
    "__REPOSITORY_URL__": repository.url || DEFAULT_REPOSITORY.url,
  };

  return Object.entries(replacements).reduce(
    (text, [token, value]) => text.replaceAll(token, value),
    template,
  ) + "\n";
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<void> {
  const child = new Deno.Command(command, {
    args,
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await child.output();
  if (code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit ${code}`);
  }
}

const rawVersion = Deno.args[0];
if (!rawVersion) {
  throw new Error("Usage: deno run -A build_anthropic_mcpb.ts <version>");
}

const version = parseReleaseVersion(rawVersion);
const packageDir = getOutputDir("mcp", CHANNEL);
if (!await exists(packageDir)) {
  throw new Error(
    `Missing ./${packageDir}. Run build_all_npm.ts ${version} first.`,
  );
}

const pkg = await readBuiltPackageJson(packageDir);
const expectedPackageName = getPackageName("mcp", CHANNEL);
if (pkg.name !== expectedPackageName) {
  throw new Error(
    `Expected ${expectedPackageName} in ./${packageDir}/package.json, got ${pkg.name}`,
  );
}

const artifactBaseName = getArtifactBaseName();
const stagingDir = `.mcpb_build/${CHANNEL}`;
const serverDir = `${stagingDir}/server`;
const outputDir = "dist";
const outputPath = `${outputDir}/${artifactBaseName}-${version}.mcpb`;

await emptyDir(stagingDir);
await ensureDir(serverDir);
await ensureDir(outputDir);

await copy(packageDir, serverDir, { overwrite: true });
await Deno.writeTextFile(
  `${stagingDir}/manifest.json`,
  await renderManifest(pkg, version),
);

await runCommand("npm", ["install", "--omit=dev"], serverDir);
await runCommand(
  "npx",
  ["-y", "@anthropic-ai/mcpb", "validate", stagingDir],
  ".",
);
await runCommand(
  "npx",
  ["-y", "@anthropic-ai/mcpb", "pack", stagingDir, outputPath],
  ".",
);

console.log(`Built ${outputPath} from ./${packageDir}`);
