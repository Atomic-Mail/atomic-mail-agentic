<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from "vue";

/**
 * One shared path selection for the whole page, remembered per browser.
 *
 * Usage in markdown:
 *   <PathTabs bar />                     – the single switcher bar (once, at the top)
 *   <PathTabs>                           – panels only, one per step
 *     <template #agentskill>…</template>
 *     <template #mcp>…</template>
 *     <template #rest>…</template>
 *   </PathTabs>
 */
const KEY = "atomicmail-docs-path";
const EVENT = "atomicmail-path";
const paths = [
  { id: "agentskill", label: "AgentSkill", hint: "For shell agents: Claude Code, Codex, Hermes, OpenClaw." },
  { id: "mcp", label: "MCP", hint: "For chat hosts such as Claude, Cursor and ChatGPT." },
  { id: "rest", label: "REST", hint: "For any language over plain HTTP, no wrapper." },
] as const;
type PathId = (typeof paths)[number]["id"];

const props = defineProps<{ bar?: boolean }>();
const current = ref<PathId>("agentskill");

function onEvent(e: Event) {
  current.value = (e as CustomEvent<PathId>).detail;
}

onMounted(() => {
  try {
    const saved = localStorage.getItem(KEY) as PathId | null;
    if (saved && paths.some((p) => p.id === saved)) current.value = saved;
  } catch {}
  window.addEventListener(EVENT, onEvent);
});

onBeforeUnmount(() => window.removeEventListener(EVENT, onEvent));

function pick(id: PathId) {
  current.value = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {}
  window.dispatchEvent(new CustomEvent(EVENT, { detail: id }));
}

const hint = computed(() => paths.find((p) => p.id === current.value)?.hint ?? "");
</script>

<template>
  <div v-if="props.bar" class="path-tabs path-tabs--bar">
    <div class="path-tabs__bar" role="tablist" aria-label="Integration path">
      <button
        v-for="p in paths"
        :key="p.id"
        role="tab"
        type="button"
        :aria-selected="current === p.id"
        :class="{ on: current === p.id }"
        @click="pick(p.id)"
      >
        {{ p.label }}
      </button>
    </div>
    <p class="path-tabs__hint">
      <span>{{ hint }}</span>
      <span v-if="current !== 'agentskill'"> Not sure? Start with AgentSkill.</span>
    </p>
  </div>
  <div v-else class="path-tabs__panel">
    <div v-show="current === 'agentskill'"><slot name="agentskill" /></div>
    <div v-show="current === 'mcp'"><slot name="mcp" /></div>
    <div v-show="current === 'rest'"><slot name="rest" /></div>
  </div>
</template>
