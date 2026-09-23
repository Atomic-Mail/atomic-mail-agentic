<script setup lang="ts">
import { computed } from "vue";
import { useData, withBase } from "vitepress";
import { data } from "../../changelog.data";

/** Bottom of a release page: newer / older release and the full list. */
const { params } = useData();
const idx = computed(() => data.findIndex((e) => e.version === (params.value?.semver as string)));
const newer = computed(() => (idx.value > 0 ? data[idx.value - 1] : null));
const older = computed(() => (idx.value >= 0 && idx.value < data.length - 1 ? data[idx.value + 1] : null));
const href = (v: string) => withBase(`/changelog/v${v}`);
</script>

<template>
  <nav class="release-nav" aria-label="Releases">
    <a v-if="newer" class="release-nav__link release-nav__link--prev" :href="href(newer.version)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
      <span>v{{ newer.version }}</span>
    </a>
    <span v-else></span>
    <a class="release-nav__all" :href="withBase('/changelog')">All changes</a>
    <a v-if="older" class="release-nav__link release-nav__link--next" :href="href(older.version)">
      <span>v{{ older.version }}</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
    </a>
    <span v-else></span>
  </nav>
</template>
