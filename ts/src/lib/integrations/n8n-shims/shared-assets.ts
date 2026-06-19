// Shared asset stubs for n8n vendor esbuild.

export function getSharedRootPath(): string {
  throw new Error("Shared assets filesystem access is unavailable in n8n bundle.");
}

export function readSharedText(_relativePath: string): string {
  throw new Error("Shared assets filesystem access is unavailable in n8n bundle.");
}

export function readSharedJson<T>(_relativePath: string): T {
  throw new Error("Shared assets filesystem access is unavailable in n8n bundle.");
}

export function tryReadSharedText(_relativePath: string): string | undefined {
  return undefined;
}

export function tryReadSharedJson<T>(_relativePath: string): T | undefined {
  return undefined;
}
