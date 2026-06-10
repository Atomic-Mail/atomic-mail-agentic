// Parse and validate a release tag / version string for CI.
//
// Usage:  deno run -A resolve_release_version.ts <tag>
// Prints normalized semver to stdout; exits 1 on invalid or missing input.

import { parseReleaseVersion } from "./lib/version.ts";

const raw = Deno.args[0];
if (!raw) {
  console.error("Usage: deno run -A resolve_release_version.ts <version>");
  console.error("Example: deno run -A resolve_release_version.ts v0.1.2");
  Deno.exit(1);
}

try {
  console.log(parseReleaseVersion(raw));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  Deno.exit(1);
}
