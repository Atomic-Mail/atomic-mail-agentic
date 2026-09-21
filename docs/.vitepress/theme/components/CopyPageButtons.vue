<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

/**
 * One "Copy page" button with a dropdown, in place of
 * vitepress-plugin-llms' two buttons:
 *   Copy page ▾  →  View as Markdown · Download .md · Open in ChatGPT · Open in Claude
 */
const copied = ref(false);
const open = ref(false);
const root = ref<HTMLElement | null>(null);

const providers = [
  { name: "ChatGPT", url: "https://chatgpt.com/?hints=search&prompt=" },
  { name: "Claude", url: "https://claude.ai/new?q=" },
];

function markdownUrl(): string {
  const { origin, pathname } = window.location;
  const clean = pathname.replace(/\/+$/, "").replace(/\.html$/, "");
  return clean ? `${origin}${clean}.md` : `${origin}/index.md`;
}

async function markdownText(): Promise<string> {
  return (await fetch(markdownUrl())).text();
}

async function copyPage(e?: MouseEvent) {
  // A mouse click leaves the button focused; drop that so no ring lingers.
  // Keyboard activation reports detail === 0 and keeps its focus ring.
  if (e && e.detail > 0) (e.currentTarget as HTMLElement | null)?.blur();
  try {
    await navigator.clipboard.writeText(await markdownText());
    copied.value = true;
    window.setTimeout(() => (copied.value = false), 2000);
  } catch {}
}

function viewMarkdown() {
  window.open(markdownUrl(), "_blank", "noopener");
  open.value = false;
}

async function downloadMarkdown() {
  try {
    const text = await markdownText();
    const name = (markdownUrl().split("/").pop() || "page.md").replace(/\?.*$/, "");
    const blob = new Blob([text], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch {}
  open.value = false;
}

function openIn(p: { url: string }) {
  const prompt = `Read from ${markdownUrl()} so I can ask questions about it.`;
  window.open(p.url + encodeURIComponent(prompt), "_blank", "noopener");
  open.value = false;
}

function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}
onMounted(() => document.addEventListener("click", onDocClick));
onBeforeUnmount(() => document.removeEventListener("click", onDocClick));
</script>

<template>
  <div ref="root" class="page-actions">
    <div class="page-actions__group">
      <button type="button" class="page-actions__btn" :class="{ ok: copied }" @click="copyPage($event)">
        <svg v-if="!copied" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>
        <svg v-else class="page-actions__check" viewBox="0 0 10 8" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true"><rect x="9" y="0" width="1" height="1" /><rect x="8" y="1" width="1" height="1" /><rect x="9" y="1" width="1" height="1" /><rect x="7" y="2" width="1" height="1" /><rect x="8" y="2" width="1" height="1" /><rect x="0" y="3" width="1" height="1" /><rect x="6" y="3" width="1" height="1" /><rect x="7" y="3" width="1" height="1" /><rect x="0" y="4" width="1" height="1" /><rect x="1" y="4" width="1" height="1" /><rect x="5" y="4" width="1" height="1" /><rect x="6" y="4" width="1" height="1" /><rect x="1" y="5" width="1" height="1" /><rect x="2" y="5" width="1" height="1" /><rect x="4" y="5" width="1" height="1" /><rect x="5" y="5" width="1" height="1" /><rect x="2" y="6" width="1" height="1" /><rect x="3" y="6" width="1" height="1" /><rect x="4" y="6" width="1" height="1" /><rect x="3" y="7" width="1" height="1" /></svg>
        <span>{{ copied ? "Copied" : "Copy page" }}</span>
      </button>
      <button type="button" class="page-actions__chevron" :aria-expanded="open" aria-label="More ways to use this page" @click.stop="open = !open">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      <div v-if="open" class="page-actions__menu" role="menu">
        <button type="button" class="page-actions__item" role="menuitem" @click="viewMarkdown">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M16 13H8" /><path d="M16 17H8" /></svg>
          <span>View as Markdown</span>
          <i>↗</i>
        </button>
        <button type="button" class="page-actions__item" role="menuitem" @click="downloadMarkdown">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></svg>
          <span>Download .md</span>
        </button>
        <button v-for="p in providers" :key="p.name" type="button" class="page-actions__item" role="menuitem" @click="openIn(p)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></svg>
          <span>Open in {{ p.name }}</span>
          <i>↗</i>
        </button>
      </div>
    </div>
  </div>
</template>
