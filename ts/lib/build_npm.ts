import { build, emptyDir } from "@deno/dnt";

import { ATOMICMAIL_NPM_PACKAGE_META } from "../npm_package_meta.ts";

export type NpmProduct = "mcp" | "skill";

const PRESET_FILES = [
  "send_mail.json",
  "send_mail_attachment.json",
  "send_mail_blob_attachment.json",
  "list_inbox.json",
  "reply.json",
] as const;

const SHARED_PRESET_DIR = "./src/lib/agent/jmap/presets";
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

export function loadChannels(): string[] {
  const text = Deno.readTextFileSync(
    new URL("../npm_channels.json", import.meta.url),
  );
  return JSON.parse(text) as string[];
}

export function getOutputDir(product: NpmProduct, channel?: string): string {
  const prefix = product === "mcp" ? "mcp_npm" : "skill_npm";
  return channel ? `${prefix}_${channel}` : prefix;
}

export function getPackageName(product: NpmProduct, channel?: string): string {
  const { baseName } = PRODUCT_CONFIG[product];
  return channel ? `${baseName}-${channel}` : baseName;
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

export interface BuildNpmPackageOptions {
  product: NpmProduct;
  version: string;
  channel?: string;
}

export async function buildNpmPackage(
  options: BuildNpmPackageOptions,
): Promise<string> {
  const { product, version, channel } = options;
  const config = PRODUCT_CONFIG[product];
  const dir = getOutputDir(product, channel);
  const packageName = getPackageName(product, channel);

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
      description: channelDescription(config.description, channel),
      license: "MIT",
      ...ATOMICMAIL_NPM_PACKAGE_META,
      homepage: buildHomepage(channel),
      keywords: buildKeywords(config.keywords, channel),
      atomicmail: channel ? { channel } : { channel: "default" },
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

export function listBuiltPackageDirs(): string[] {
  const dirs: string[] = [];
  for (const entry of Deno.readDirSync(".")) {
    if (!entry.isDirectory) continue;
    if (
      entry.name === "mcp_npm" ||
      entry.name === "skill_npm" ||
      /^mcp_npm_[a-z0-9_-]+$/.test(entry.name) ||
      /^skill_npm_[a-z0-9_-]+$/.test(entry.name)
    ) {
      dirs.push(entry.name);
    }
  }
  return dirs.sort();
}
