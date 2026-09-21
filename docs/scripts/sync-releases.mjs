// Refresh docs/.vitepress/releases.json from GitHub Releases (public API, no token needed).
//   node docs/scripts/sync-releases.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const res = await fetch("https://api.github.com/repos/Atomic-Mail/atomic-mail-agentic/releases?per_page=100", {
  headers: { "User-Agent": "atomicmail-docs" },
});
if (!res.ok) throw new Error(`GitHub API ${res.status}`);
const releases = (await res.json())
  .filter((r) => !r.draft)
  .map((r) => ({ tag: r.tag_name, version: r.tag_name.replace(/^v/, ""), date: r.published_at.slice(0, 10), url: r.html_url, prerelease: r.prerelease, body: r.body ?? "" }));
const key = (v) => v.split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : -1));
releases.sort((a, b) => { const ka = key(a.version), kb = key(b.version); for (let i = 0; i < Math.max(ka.length, kb.length); i++) { const d = (kb[i] ?? 0) - (ka[i] ?? 0); if (d) return d; } return 0; });
writeFileSync(fileURLToPath(new URL("../.vitepress/releases.json", import.meta.url)), JSON.stringify(releases, null, 2) + "\n");
console.log(`wrote ${releases.length} releases`);
