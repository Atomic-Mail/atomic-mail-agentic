/** Semver (npm-compatible subset): major.minor.patch with optional prerelease/build. */
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][\w.-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][\w.-]*))*))?(?:\+([\w.-]+))?$/;

const VERSION_TS_PATH = new URL("../src/mcp/version.ts", import.meta.url);

/** Strip optional leading `v` and validate semver. Throws on invalid input. */
export function parseReleaseVersion(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(
      "Version is required (expected semver, e.g. 0.1.2 or v1.0.0).",
    );
  }
  const version = trimmed.replace(/^v/, "");
  if (!SEMVER_RE.test(version)) {
    throw new Error(
      `Invalid semver: "${raw}" (expected e.g. 0.1.2, 1.0.0-beta.1, or v2.0.0).`,
    );
  }
  return version;
}

/** Write release version into source so built packages report the same version at runtime. */
export async function syncSourceVersion(version: string): Promise<void> {
  const content =
    `/** Published @atomicmail/mcp version; set from release tag in CI. */\nexport const ATOMICMAIL_MCP_VERSION = "${version}";\n`;
  await Deno.writeTextFile(VERSION_TS_PATH, content);
}
