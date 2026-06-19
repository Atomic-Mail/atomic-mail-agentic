// Zero-deps n8n bundler: copy pre-built @atomicmail/agentic-core from ts/core_npm/
// (esm, shared, presets) into integrations/n8n/atomicmail/vendor/agentic-core/
// so the n8n community node imports a local vendor path with no runtime npm dependency
// on agentic-core at publish/verify time. Mirrors ts/build_dify_wrapper.ts (copyDir,
// optional version stamp); does NOT use dnt for cross-subproject compilation.

import { emptyDir } from "@deno/dnt";

import { parseReleaseVersion } from "./lib/version.ts";
import { ATOMICMAIL_MCP_VERSION } from "./src/mcp/version.ts";

const TS_DIR = new URL("./", import.meta.url);
const CORE_NPM_DIR = new URL("./core_npm/", import.meta.url);
const CORE_ESM_MOD = new URL("esm/mod.js", CORE_NPM_DIR);
const PLUGIN_DIR = new URL("../integrations/n8n/atomicmail/", import.meta.url);
const VENDOR_CORE_DIR = new URL("vendor/agentic-core/", PLUGIN_DIR);
const NODE_PACKAGE_PATH = new URL("package.json", PLUGIN_DIR);

const CORE_COPY_ENTRIES = [
  "esm",
  "shared",
  "presets",
] as const;

/** dnt polyfill .d.ts files trigger n8n strict lint; ESM runtime uses a n8n-safe stub instead. */
const N8N_POLYFILL_STUB = `/**
 * Minimal import.meta shim for n8n (Node 20+ ESM). Replaces dnt polyfills that import node:module/url/path.
 */
const defineGlobalPonyfill = (symbolFor, fn) => {
  if (!Reflect.has(globalThis, Symbol.for(symbolFor))) {
    Object.defineProperty(globalThis, Symbol.for(symbolFor), {
      configurable: true,
      get() {
        return fn;
      },
    });
  }
};

const shimWs = new WeakSet();

const import_meta_ponyfill_esmodule = (importMeta) => {
  if (!shimWs.has(importMeta)) {
    shimWs.add(importMeta);
    if (typeof importMeta.filename !== "string") {
      const pathname = new URL(importMeta.url).pathname;
      importMeta.filename = pathname;
      const lastSlash = pathname.lastIndexOf("/");
      importMeta.dirname = lastSlash >= 0 ? pathname.slice(0, lastSlash) : pathname;
    }
  }
  return importMeta;
};

defineGlobalPonyfill("import-meta-ponyfill-esmodule", import_meta_ponyfill_esmodule);

export { import_meta_ponyfill_esmodule };
`;

const rawVersion = Deno.args[0];
const releaseVersion = rawVersion ? parseReleaseVersion(rawVersion) : null;
const version = releaseVersion ?? ATOMICMAIL_MCP_VERSION;

async function copyDir(src: URL, dest: URL): Promise<void> {
  await Deno.mkdir(dest, { recursive: true });
  for await (const entry of Deno.readDir(src)) {
    if (
      entry.name.startsWith("_dnt.polyfills") &&
      (entry.name.endsWith(".d.ts") || entry.name.endsWith(".d.ts.map"))
    ) {
      continue;
    }
    const srcPath = new URL(entry.name, src);
    const destPath = new URL(entry.name, dest);
    if (entry.isDirectory) {
      await copyDir(
        new URL(`${entry.name}/`, src),
        new URL(`${entry.name}/`, dest),
      );
    } else if (entry.isFile) {
      await Deno.copyFile(srcPath, destPath);
    }
  }
}

async function writeN8nPolyfillStub(): Promise<void> {
  const esmDir = new URL("esm/", VENDOR_CORE_DIR);
  await Deno.writeTextFile(
    new URL("_dnt.polyfills.js", esmDir),
    N8N_POLYFILL_STUB,
  );
  for (const name of ["_dnt.polyfills.d.ts", "_dnt.polyfills.d.ts.map"]) {
    try {
      await Deno.remove(new URL(name, esmDir));
    } catch {
      // absent
    }
  }
}

async function pathExists(path: URL): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureCoreBuilt(): Promise<void> {
  if (await pathExists(CORE_ESM_MOD)) {
    return;
  }

  const buildCore = new URL("./build_core_npm.ts", TS_DIR);
  const args = ["run", "-A", buildCore.pathname];
  if (releaseVersion) {
    args.push(releaseVersion);
  }

  console.log("core_npm/esm missing; running build_core_npm.ts …");
  const { code, stderr } = await new Deno.Command(Deno.execPath(), {
    args,
    cwd: TS_DIR.pathname,
    stderr: "piped",
  }).output();

  if (code !== 0) {
    const errText = new TextDecoder().decode(stderr);
    throw new Error(
      `build_core_npm.ts failed (exit ${code})${errText ? `: ${errText}` : ""}`,
    );
  }
}

async function writeVendorPackageJson(): Promise<void> {
  const content = {
    name: "@atomicmail/agentic-core",
    version,
    description:
      "Vendored Atomic Mail agentic core for the n8n community node (zero runtime deps).",
    license: "MIT",
    type: "module",
    module: "./esm/mod.js",
    exports: {
      ".": {
        import: "./esm/mod.js",
      },
    },
    engines: {
      node: ">=20",
    },
    dependencies: {},
    atomicmail: {
      channel: "n8n-vendor",
      bundledBy: "ts/build_n8n_wrapper.ts",
    },
  };
  await Deno.writeTextFile(
    new URL("package.json", VENDOR_CORE_DIR),
    `${JSON.stringify(content, null, 2)}\n`,
  );
}

async function stampNodePackageVersion(): Promise<void> {
  if (!(await pathExists(NODE_PACKAGE_PATH))) {
    return;
  }

  const pkg = JSON.parse(await Deno.readTextFile(NODE_PACKAGE_PATH)) as {
    version?: string;
  };
  pkg.version = version;
  await Deno.writeTextFile(
    NODE_PACKAGE_PATH,
    `${JSON.stringify(pkg, null, 2)}\n`,
  );
}

async function copyOptionalFile(name: string): Promise<void> {
  const src = new URL(name, CORE_NPM_DIR);
  if (await pathExists(src)) {
    await Deno.copyFile(src, new URL(name, VENDOR_CORE_DIR));
  }
}

await ensureCoreBuilt();
await emptyDir(new URL("./", VENDOR_CORE_DIR).pathname);

for (const entry of CORE_COPY_ENTRIES) {
  const src = new URL(`${entry}/`, CORE_NPM_DIR);
  if (!(await pathExists(src))) {
    throw new Error(
      `Missing core_npm/${entry}/ — run: cd ts && deno run -A build_core_npm.ts`,
    );
  }
  await copyDir(src, new URL(`${entry}/`, VENDOR_CORE_DIR));
}

await writeN8nPolyfillStub();

await copyOptionalFile("LICENSE");
await copyOptionalFile("README.md");
await writeVendorPackageJson();

if (releaseVersion) {
  await stampNodePackageVersion();
}

console.log(
  `Built n8n vendor @atomicmail/agentic-core@${version} -> ./integrations/n8n/atomicmail/vendor/agentic-core`,
);
console.log(
  releaseVersion
    ? "Copied core artifacts, wrote vendor package.json, stamped n8n package version."
    : "Copied core artifacts and wrote vendor package.json.",
);
