import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));

function resolveSharedRoot(): string {
  let current = moduleDir;
  for (let depth = 0; depth < 12; depth++) {
    const candidate = resolvePath(current, "shared");
    if (existsSync(candidate)) return candidate;

    const parent = resolvePath(current, "..");
    if (parent === current) break;
    current = parent;
  }

  throw new Error(
    `Shared asset directory was not found from module path: ${moduleDir}`,
  );
}

let cachedSharedRoot: string | undefined;

export function getSharedRootPath(): string {
  if (!cachedSharedRoot) cachedSharedRoot = resolveSharedRoot();
  return cachedSharedRoot;
}

export function readSharedText(relativePath: string): string {
  const fullPath = resolvePath(getSharedRootPath(), relativePath);
  return readFileSync(fullPath, "utf-8");
}

export function readSharedJson<T>(
  relativePath: string,
): T {
  return JSON.parse(readSharedText(relativePath)) as T;
}

export function tryReadSharedText(relativePath: string): string | undefined {
  try {
    return readSharedText(relativePath);
  } catch {
    return undefined;
  }
}

export function tryReadSharedJson<T>(relativePath: string): T | undefined {
  try {
    return readSharedJson<T>(relativePath);
  } catch {
    return undefined;
  }
}
