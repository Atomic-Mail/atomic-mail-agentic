<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

/**
 * Generic synced tabs (languages, hosts…). All TabGroups on a page that share
 * the same `group` switch together and remember the choice per browser.
 *
 *   <TabGroup group="lang" :tabs="[{ id: 'js', label: 'JavaScript' }, { id: 'py', label: 'Python' }]">
 *   <template #js> … </template>
 *   <template #py> … </template>
 *   </TabGroup>
 */
const props = defineProps<{
  tabs: { id: string; label: string }[];
  group?: string;
}>();

const group = props.group ?? "lang";
const KEY = `atomicmail-docs-tab-${group}`;
const EVENT = `atomicmail-tab-${group}`;
const current = ref(props.tabs[0]?.id ?? "");

function onEvent(e: Event) {
  const id = (e as CustomEvent<string>).detail;
  if (props.tabs.some((t) => t.id === id)) current.value = id;
}
onMounted(() => {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && props.tabs.some((t) => t.id === saved)) current.value = saved;
  } catch {}
  window.addEventListener(EVENT, onEvent);
});
onBeforeUnmount(() => window.removeEventListener(EVENT, onEvent));

function pick(id: string) {
  current.value = id;
  try { localStorage.setItem(KEY, id); } catch {}
  window.dispatchEvent(new CustomEvent(EVENT, { detail: id }));
}
</script>

<template>
  <div class="tab-group">
    <div class="path-tabs__bar" role="tablist">
      <button v-for="t in tabs" :key="t.id" role="tab" type="button" :aria-selected="current === t.id" :class="{ on: current === t.id }" @click="pick(t.id)">
        {{ t.label }}
      </button>
    </div>
    <div class="tab-group__panel">
      <div v-for="t in tabs" :key="t.id" v-show="current === t.id">
        <slot :name="t.id" />
      </div>
    </div>
  </div>
</template>
