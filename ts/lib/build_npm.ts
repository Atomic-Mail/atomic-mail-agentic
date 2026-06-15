import { build, emptyDir } from "@deno/dnt";

import {
  ATOMICMAIL_GITHUB_PACKAGES_PUBLISH_CONFIG,
  ATOMICMAIL_NPM_PACKAGE_META,
} from "../npm_package_meta.ts";

export type NpmProduct = "mcp" | "skill";
export interface NpmChannelMcpbConfig {
  artifactBaseName?: string;
}
export interface NpmChannelConfig {
  name: string;
  products?: NpmProduct[];
  publish?: boolean;
  mcpb?: NpmChannelMcpbConfig;
}

const PRESET_FILES = [
  "send_mail.json",
  "send_mail_attachment.json",
  "send_mail_blob_attachment.json",
  "list_inbox.json",
  "reply.json",
] as const;

const SHARED_ROOT_DIR = "../shared";
const SHARED_PRESET_DIR = `${SHARED_ROOT_DIR}/presets`;
const LICENSE_FILE = { path: "../LICENSE", targetPath: "LICENSE" };

const PRODUCT_CONFIG = {
  mcp: {
    baseName: "@atomicmail/mcp",
    binName: "atomicmail-mcp",
    entryPath: "./src/mcp/main.ts",
    description:
      "Atomic Mail MCP server — local stdio proxy with PoW auth and JMAP, for AI agents.",
    keywords: [
      "atomic-mail",
      "atomicmail",
      "mcp",
      "model-context-protocol",
      "agent",
      "ai",
      "jmap",
      "esp",
      "email",
      "proof-of-work",
    ],
    readme: { path: "../docs/mcp.md", targetPath: "README.md" },
    extraFiles: [] as const,
  },
  skill: {
    baseName: "@atomicmail/agent-skill",
    binName: "atomicmail",
    entryPath: "./src/skill/cli.ts",
    description:
      "Atomic Mail AgentSkill — register, jmap_request, and help CLI for AI agents.",
    keywords: [
      "atomic-mail",
      "atomicmail",
      "agentskills",
      "agent",
      "ai",
      "jmap",
      "esp",
      "email",
      "mcp",
      "proof-of-work",
    ],
    readme: { path: "../docs/skill-install.md", targetPath: "README.md" },
    extraFiles: [{ path: "../docs/SKILL.md", targetPath: "SKILL.md" }] as const,
  },
} as const;

const GITHUB_PACKAGES = {
  mcp: {
    packageName: "@atomic-mail/mcp",
    outDir: "mcp_npm_gpr",
  },
  skill: {
    packageName: "@atomic-mail/agent-skill",
    outDir: "skill_npm_gpr",
  },
} as const;

function normalizeChannelConfig(
  channel: string | NpmChannelConfig,
): NpmChannelConfig {
  if (typeof channel === "string") {
    return { name: channel, publish: true };
  }
  return {
    publish: true,
    ...channel,
  };
}

export function loadChannels(): NpmChannelConfig[] {
  const text = Deno.readTextFileSync(
    new URL("../npm_channels.json", import.meta.url),
  );
  const parsed = JSON.parse(text) as Array<string | NpmChannelConfig>;
  return parsed.map(normalizeChannelConfig);
}

export function supportsChannelProduct(
  channel: NpmChannelConfig,
  product: NpmProduct,
): boolean {
  return !channel.products || channel.products.includes(product);
}

export function shouldPublishChannel(channel: NpmChannelConfig): boolean {
  return channel.publish ?? true;
}

export function getChannelConfig(
  channel: string,
): NpmChannelConfig | undefined {
  return loadChannels().find((entry) => entry.name === channel);
}

export function assertChannelSupported(
  product: NpmProduct,
  channel?: string,
): void {
  if (!channel) return;

  const config = getChannelConfig(channel);
  if (!config) {
    throw new Error(`Unknown npm channel: ${channel}`);
  }
  if (!supportsChannelProduct(config, product)) {
    throw new Error(
      `Unsupported npm channel for ${product}: ${channel}`,
    );
  }
}

export function getOutputDir(product: NpmProduct, channel?: string): string {
  const prefix = product === "mcp" ? "mcp_npm" : "skill_npm";
  return channel ? `${prefix}_${channel}` : prefix;
}

export function getPackageName(product: NpmProduct, channel?: string): string {
  const { baseName } = PRODUCT_CONFIG[product];
  return channel ? `${baseName}-${channel}` : baseName;
}

export interface NpmPackageTarget {
  product: NpmProduct;
  channel?: string;
}

export function listConfiguredPackageTargets(
  options: { publishableOnly?: boolean } = {},
): NpmPackageTarget[] {
  const { publishableOnly = false } = options;
  const targets: NpmPackageTarget[] = [
    { product: "mcp" },
    { product: "skill" },
  ];

  for (const channel of loadChannels()) {
    if (publishableOnly && !shouldPublishChannel(channel)) continue;
    for (const product of ["mcp", "skill"] as const) {
      if (!supportsChannelProduct(channel, product)) continue;
      targets.push({ product, channel: channel.name });
    }
  }

  return targets;
}

export function listConfiguredPackageDirs(
  options: { publishableOnly?: boolean } = {},
): string[] {
  return listConfiguredPackageTargets(options).map(({ product, channel }) =>
    getOutputDir(product, channel)
  );
}

export function buildHomepage(channel?: string): string {
  const campaign = channel ?? "website";
  return `https://atomicmail.ai?utm_source=npm&utm_medium=package&utm_campaign=${campaign}`;
}

function channelDescription(base: string, channel?: string): string {
  if (!channel) return base;
  return `${base} (${channel} install channel)`;
}

function buildKeywords(base: readonly string[], channel?: string): string[] {
  const keywords = [...base];
  if (channel) keywords.push(channel);
  return keywords;
}

async function copyFileIfExists(src: string, dest: string): Promise<void> {
  try {
    await Deno.copyFile(src, dest);
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
}

async function copyDirRecursive(srcDir: string, destDir: string): Promise<void> {
  await Deno.mkdir(destDir, { recursive: true });
  for await (const entry of Deno.readDir(srcDir)) {
    const src = `${srcDir}/${entry.name}`;
    const dest = `${destDir}/${entry.name}`;
    if (entry.isDirectory) {
      await copyDirRecursive(src, dest);
      continue;
    }
    if (entry.isFile) {
      await Deno.copyFile(src, dest);
    }
  }
}

async function prependChannelReadme(
  dir: string,
  channel: string,
  defaultPackageName: string,
): Promise<void> {
  const readmePath = `${dir}/README.md`;
  const existing = await Deno.readTextFile(readmePath);
  const note =
    `Install package for ${channel} integration (same as ${defaultPackageName}).\n\n`;
  await Deno.writeTextFile(readmePath, note + existing);
}

export interface BuildNpmPackageOverrides {
  packageName?: string;
  outDir?: string;
  description?: string;
  homepage?: string;
  publishConfig?: typeof ATOMICMAIL_NPM_PACKAGE_META.publishConfig;
  atomicmail?: { channel: string };
}

export interface BuildNpmPackageOptions {
  product: NpmProduct;
  version: string;
  channel?: string;
  overrides?: BuildNpmPackageOverrides;
}

export async function buildNpmPackage(
  options: BuildNpmPackageOptions,
): Promise<string> {
  const { product, version, channel, overrides } = options;
  assertChannelSupported(product, channel);
  const config = PRODUCT_CONFIG[product];
  const dir = overrides?.outDir ?? getOutputDir(product, channel);
  const packageName = overrides?.packageName ??
    getPackageName(product, channel);

  await emptyDir(dir);

  await build({
    entryPoints: [
      {
        kind: "bin",
        name: config.binName,
        path: config.entryPath,
      },
    ],
    outDir: `./${dir}`,
    shims: {
      deno: false,
    },
    test: false,
    scriptModule: false,
    typeCheck: false,
    compilerOptions: {
      lib: ["ES2022", "DOM"],
      target: "ES2022",
    },
    package: {
      name: packageName,
      version,
      description: overrides?.description ??
        channelDescription(config.description, channel),
      license: "MIT",
      ...ATOMICMAIL_NPM_PACKAGE_META,
      ...(overrides?.publishConfig && {
        publishConfig: overrides.publishConfig,
      }),
      homepage: overrides?.homepage ?? buildHomepage(channel),
      keywords: buildKeywords(config.keywords, channel),
      atomicmail: overrides?.atomicmail ??
        (channel ? { channel } : { channel: "default" }),
      ...(product === "mcp" && { mcpName: "io.github.Atomic-Mail/mcp" }),
      engines: {
        node: ">=20",
      },
      devDependencies: {
        "@types/node": "^20.12.0",
      },
    },
    async postBuild() {
      await copyFileIfExists(
        LICENSE_FILE.path,
        `${dir}/${LICENSE_FILE.targetPath}`,
      );
      await copyFileIfExists(
        config.readme.path,
        `${dir}/${config.readme.targetPath}`,
      );
      for (const file of config.extraFiles) {
        await copyFileIfExists(file.path, `${dir}/${file.targetPath}`);
      }

      if (channel) {
        await prependChannelReadme(dir, channel, config.baseName);
      }

      await copyDirRecursive(SHARED_ROOT_DIR, `${dir}/shared`);

      await Deno.mkdir(`${dir}/presets`, { recursive: true });
      for (const file of PRESET_FILES) {
        await Deno.copyFile(
          `${SHARED_PRESET_DIR}/${file}`,
          `${dir}/presets/${file}`,
        );
      }
    },
  });

  return dir;
}

export async function buildGithubPackagesNpm(
  version: string,
): Promise<string[]> {
  const dirs: string[] = [];
  for (const product of ["mcp", "skill"] as const) {
    const gpr = GITHUB_PACKAGES[product];
    const config = PRODUCT_CONFIG[product];
    const dir = await buildNpmPackage({
      product,
      version,
      overrides: {
        packageName: gpr.packageName,
        outDir: gpr.outDir,
        description: config.description,
        homepage: buildHomepage("github-packages"),
        publishConfig: ATOMICMAIL_GITHUB_PACKAGES_PUBLISH_CONFIG,
      },
    });
    dirs.push(dir);
  }
  return dirs;
}

export function listGithubPackagesDirs(): string[] {
  return ["mcp_npm_gpr", "skill_npm_gpr"];
}

export interface ParsedBuildArgs {
  version?: string;
  channel?: string;
}

export function parseBuildArgs(args: string[]): ParsedBuildArgs {
  let version: string | undefined;
  let channel: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--channel=")) {
      channel = arg.slice("--channel=".length);
    } else if (arg === "--channel" && i + 1 < args.length) {
      channel = args[++i];
    } else if (!arg.startsWith("-")) {
      version = arg.replace(/^v/, "");
    }
  }

  return { version, channel };
}

export function listBuiltPackageDirs(
  options: { publishableOnly?: boolean } = {},
): string[] {
  const allowed = new Set(listConfiguredPackageDirs(options));
  const dirs: string[] = [];
  for (const entry of Deno.readDirSync(".")) {
    if (!entry.isDirectory) continue;
    if (allowed.has(entry.name)) dirs.push(entry.name);
  }
  return dirs.sort();
}
