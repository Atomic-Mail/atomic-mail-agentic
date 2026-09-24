<script setup lang="ts">
import { withBase } from "vitepress";
import { data } from "../../changelog.data";

/**
 * /changelog: one row per release on a rail. Each row reads like a summary
 * and links to that release's own page.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmt(date: string): string {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return date;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
const href = (v: string) => withBase(`/changelog/v${v}`);
const count = (e: (typeof data)[number]) => e.groups.reduce((n, g) => n + g.items.length, 0);
function summary(e: (typeof data)[number]): string {
  const n = count(e);
  if (!n) return "Maintenance release";
  return e.groups.map((g) => `${g.items.length} ${g.title.toLowerCase()}`).join(" · ");
}
function excerpt(e: (typeof data)[number]): string[] {
  return e.groups.flatMap((g) => g.items).slice(0, 3);
}
</script>

<template>
  <div class="changelog">
    <article v-for="e in data" :key="e.version" class="changelog__entry">
      <div class="changelog__meta">
        <time :datetime="e.date">{{ fmt(e.date) }}</time>
      </div>
      <a class="changelog__card" :href="href(e.version)">
        <span class="changelog__head">
          <span class="changelog__version">v{{ e.version }}</span>
          <span class="changelog__summary">{{ summary(e) }}</span>
          <svg class="changelog__arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
        </span>
        <ul v-if="excerpt(e).length" class="changelog__excerpt">
          <li v-for="(it, i) in excerpt(e)" :key="i" v-html="it"></li>
        </ul>
        <span v-if="e.groups.length" class="changelog__tags">
          <span v-for="g in e.groups" :key="g.title" class="changelog__tag">{{ g.title }}</span>
        </span>
      </a>
    </article>
  </div>
</template>
