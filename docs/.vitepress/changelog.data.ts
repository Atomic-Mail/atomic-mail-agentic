import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Build-time loader for the repository CHANGELOG.md (Keep a Changelog format).
 * Used by the collapsible "Latest changes" block under every page.
 */
export interface ChangelogEntry {
  version: string;
  date: string;
  groups: { title: string; items: string[] }[];
  /** "changelog" = written notes from CHANGELOG.md; "github" = the PR list GitHub generated for the release */
  source: "changelog" | "github";
  url?: string;
}

const file = resolve(__dirname, "../../CHANGELOG.md");
const releasesFile = resolve(__dirname, "./releases.json");

export interface Release { tag: string; version: string; date: string; url: string; prerelease: boolean; body: string }

/** How many releases the docs show. Older ones stay in releases.json and CHANGELOG.md. */
export const SHOW_LATEST = 2;

/**
 * GitHub's auto-generated notes are "* <PR title> by @user in <PR url>" lines.
 * Keep the PR title verbatim (minus a conventional-commit prefix such as
 * "docs(readme): "), drop author handles and links, and skip housekeeping —
 * branch merges and chore/test/ci/build commits say nothing to a reader.
 */
const HOUSEKEEPING = /^(develop|main)$|^(chore|test|tests|ci|build|style|refactor)(\(|:)/i;
const GROUP_ORDER = ["Added", "Changed", "Fixed", "Docs"];
function groupFor(type: string): string {
  switch (type.toLowerCase()) {
    case "feat": case "feature": return "Added";
    case "fix": case "hotfix": return "Fixed";
    case "docs": case "doc": return "Docs";
    default: return "Changed";
  }
}
export function releaseItems(body: string): { group: string; text: string }[] {
  const items: { group: string; text: string }[] = [];
  for (const raw of body.split("\n")) {
    const m = raw.match(/^\*\s+(.+?)\s+by\s+@[\w-]+\s+in\s+https:\/\/\S+\s*$/);
    if (!m) continue;
    const title = m[1].trim();
    if (HOUSEKEEPING.test(title)) continue;
    const pre = title.match(/^([a-z]+)(\([^)]*\))?:\s*/i);
    const text = pre ? title.slice(pre[0].length) : title;
    items.push({ group: groupFor(pre?.[1] ?? ""), text: text.charAt(0).toUpperCase() + text.slice(1) });
  }
  return items;
}
export function releaseGroups(body: string): { title: string; items: string[] }[] {
  const all = releaseItems(body);
  return GROUP_ORDER.map((g) => ({ title: g, items: all.filter((i) => i.group === g).map((i) => i.text) })).filter((g) => g.items.length);
}
function parseReleaseBody(body: string): { title: string; items: string[] }[] {
  return releaseGroups(body).map((g) => ({ title: g.title, items: g.items.map(inline) }));
}

const semver = (v: string) => v.split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : -1));
function byVersionDesc(a: { version: string }, b: { version: string }): number {
  const ka = semver(a.version), kb = semver(b.version);
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const d = (kb[i] ?? 0) - (ka[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Raw markdown of one release section in CHANGELOG.md, with "### Group" lifted to "## Group". */
export function rawSection(src: string, version: string): string {
  const lines = src.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start < 0) return "";
  let end = lines.findIndex((l, i) => i > start && /^## \[/.test(l));
  if (end < 0) end = lines.length;
  return lines
    .slice(start + 1, end)
    .map((l) => l.replace(/^### /, "## "))
    .join("\n")
    .trim();
}

/** Markdown for a release that only exists as GitHub's generated PR list. */
export function releaseMarkdown(body: string): string {
  const groups = releaseGroups(body);
  if (!groups.length) return "Maintenance release.";
  return groups.map((g) => `## ${g.title}\n\n` + g.items.map((t) => `- ${t}`).join("\n")).join("\n\n");
}

export const CHANGELOG_FILE = file;
export const RELEASES_FILE = releasesFile;

export function mergeReleases(entries: ChangelogEntry[], releases: Release[]): ChangelogEntry[] {
  const known = new Set(entries.map((e) => e.version));
  const out = entries.map((e) => {
    const rel = releases.find((r) => r.version === e.version);
    return { ...e, url: rel?.url };
  });
  for (const r of releases) {
    if (r.prerelease || known.has(r.version)) continue;
    out.push({ version: r.version, date: r.date, groups: parseReleaseBody(r.body), source: "github", url: r.url });
  }
  return out.sort(byVersionDesc).slice(0, SHOW_LATEST);
}

function inline(md: string): string {
  return md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

export function parseChangelog(src: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let entry: ChangelogEntry | null = null;
  let group: { title: string; items: string[] } | null = null;
  let item: string[] = [];

  const flushItem = () => {
    if (group && item.length) group.items.push(inline(item.join(" ")));
    item = [];
  };

  for (const raw of src.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const release = line.match(/^## \[([^\]]+)\](?:\s*-\s*(.+))?$/);
    if (release) {
      flushItem();
      if (release[1].toLowerCase() === "unreleased") {
        entry = null;
        group = null;
        continue;
      }
      entry = { version: release[1], date: release[2] ?? "", groups: [], source: "changelog" };
      entries.push(entry);
      group = null;
      continue;
    }
    if (!entry) continue;
    const sub = line.match(/^### (.+)$/);
    if (sub) {
      flushItem();
      group = { title: sub[1], items: [] };
      entry.groups.push(group);
      continue;
    }
    const bullet = line.match(/^- (.+)$/);
    if (bullet) {
      flushItem();
      if (!group) {
        group = { title: "", items: [] };
        entry.groups.push(group);
      }
      item = [bullet[1]];
      continue;
    }
    if (/^\s+\S/.test(line) && item.length) {
      item.push(line.trim());
    }
  }
  flushItem();
  return entries;
}

declare const data: ChangelogEntry[];
export { data };

export default {
  watch: [file, releasesFile],
  load(): ChangelogEntry[] {
    const releases = JSON.parse(readFileSync(releasesFile, "utf8")) as Release[];
    return mergeReleases(parseChangelog(readFileSync(file, "utf8")), releases);
  },
};
