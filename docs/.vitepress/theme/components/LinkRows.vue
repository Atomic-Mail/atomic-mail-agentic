<script setup lang="ts">
import { computed } from "vue";

/**
 * Link list. Short lists (≤ 4) render as quiet rectangles; long lists render as
 * plain text links in two columns, so a page never ends in a wall of boxes.
 * Force one or the other with `variant="cards" | "text"`.
 */
const props = defineProps<{
  items: { title: string; desc: string; link: string }[];
  columns?: 1 | 2 | "1" | "2";
  variant?: "cards" | "text";
}>();

// Text rows everywhere by default; `variant="cards"` opts a short list into rectangles.
const mode = computed(() => props.variant ?? "text");
</script>

<template>
  <div class="link-rows" :class="[`link-rows--${mode}`, { 'link-rows--one': String(columns) === '1' }]">
    <a v-for="it in items" :key="it.link" :href="it.link" class="link-rows__item">
      <b>{{ it.title }}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg></b>
      <span>{{ it.desc }}</span>
    </a>
  </div>
</template>
