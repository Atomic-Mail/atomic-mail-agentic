// Refresh docs/.vitepress/releases.json from the GitHub Releases API.
//
// Runs as part of `npm run docs:build` (and can be run by hand), so the docs
// changelog auto-updates on every release with no manual edit.
//
//   node docs/scripts/sync-releases.mjs
//
// Design: fail-soft. The committed releases.json is the source of truth and the
// fallback. If the API is unreachable, rate-limited, or returns nothing usable,
// we keep the committed snapshot and exit 0 so the docs build never breaks and
// the changelog is never blanked. Set GITHUB_TOKEN to lift the anonymous rate
// limit (60/h -> ~1000/h) on CI; it is optional locally.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RELEASES_API =
  "https://api.github.com/repos/Atomic-Mail/atomic-mail-agentic/releases?per_page=100";
const OUT = fileURLToPath(new URL("../.vitepress/releases.json", import.meta.url));
const token = process.env.GITHUB_TOKEN;

/** Sort key: numeric segments descending, non-numeric (rc/beta) sink below releases. */
const versionKey = (v) => v.split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : -1));

try {
  const res = await fetch(RELEASES_API, {
    headers: {
      "User-Agent": "atomicmail-docs",
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} ${res.statusText}`);

  const releases = (await res.json())
    .filter((r) => !r.draft)
    .map((r) => ({
      tag: r.tag_name,
      version: r.tag_name.replace(/^v/, ""),
      date: r.published_at.slice(0, 10),
      url: r.html_url,
      prerelease: r.prerelease,
      body: r.body ?? "",
    }));

  // Guard: never overwrite a good snapshot with an empty list.
  if (releases.length === 0) throw new Error("API returned no releases");

  releases.sort((a, b) => {
    const ka = versionKey(a.version);
    const kb = versionKey(b.version);
    for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
      const d = (kb[i] ?? 0) - (ka[i] ?? 0);
      if (d) return d;
    }
    return 0;
  });

  writeFileSync(OUT, JSON.stringify(releases, null, 2) + "\n");
  console.log(`[sync-releases] wrote ${releases.length} releases`);
} catch (err) {
  // Fail-soft: keep the committed snapshot, don't fail the docs build.
  console.warn(`[sync-releases] keeping committed releases.json (${err.message})`);
  process.exit(0);
}
