import { readFileSync } from "node:fs";
import { CHANGELOG_FILE, RELEASES_FILE, mergeReleases, parseChangelog, rawSection, releaseMarkdown, type Release } from "../.vitepress/changelog.data";

/** One page per release: /changelog/v0.3.26 — written notes from CHANGELOG.md, or GitHub's PR list. */
export default {
  paths() {
    const src = readFileSync(CHANGELOG_FILE, "utf8");
    const releases = JSON.parse(readFileSync(RELEASES_FILE, "utf8")) as Release[];
    const entries = mergeReleases(parseChangelog(src), releases);
    return entries.map((e) => {
      const rel = releases.find((r) => r.version === e.version);
      const content = e.source === "changelog" ? rawSection(src, e.version) : releaseMarkdown(rel?.body ?? "");
      return { params: { version: "v" + e.version, semver: e.version, date: e.date, source: e.source }, content };
    });
  },
};
