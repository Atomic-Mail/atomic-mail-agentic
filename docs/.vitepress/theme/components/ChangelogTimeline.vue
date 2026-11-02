<script setup lang="ts">
import { ref } from "vue";
import { withBase } from "vitepress";
import { data } from "../../changelog.data";

/**
 * /changelog: one row per release on a rail. Each row reads like a summary
 * and links to that release's own page. Only the newest SHOW_LATEST rows are
 * open; the rest stay in the HTML (crawlers follow them) behind one button.
 */
const SHOW_LATEST = 3;
const expanded = ref(false);
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
    <article v-for="(e, i) in data" v-show="expanded || i < SHOW_LATEST" :key="e.version" class="changelog__entry">
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
    <button v-if="!expanded && data.length > SHOW_LATEST" type="button" class="changelog__more-btn" @click="expanded = true">
      <span class="changelog__more-plus"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M12 6v12M6 12h12" /></svg></span>
      Show more
    </button>
  </div>
</template>
