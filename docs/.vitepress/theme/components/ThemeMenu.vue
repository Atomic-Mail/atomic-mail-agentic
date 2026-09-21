<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useData } from "vitepress";

/** Header theme button: System / Light / Dark in a small menu (replaces VitePress's switch). */
type Mode = "auto" | "light" | "dark";
const KEY = "vitepress-theme-appearance"; // the key VitePress itself reads on load
const { isDark } = useData();
const mode = ref<Mode>("dark");
const open = ref(false);
const root = ref<HTMLElement | null>(null);

const options: { id: Mode; label: string }[] = [
  { id: "auto", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

function systemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
function apply(m: Mode) {
  mode.value = m;
  const dark = m === "auto" ? systemDark() : m === "dark";
  isDark.value = dark;
  document.documentElement.classList.toggle("dark", dark);
  try { localStorage.setItem(KEY, m === "auto" ? "auto" : m); } catch {}
}
function pick(m: Mode) {
  apply(m);
  open.value = false;
}
/** Left click flips light/dark; the full menu (with System) is on right-click. */
function toggle() {
  open.value = false;
  apply(isDark.value ? "light" : "dark");
}

function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") open.value = false;
}
let mq: MediaQueryList | null = null;
const onSystem = () => { if (mode.value === "auto") apply("auto"); };

onMounted(() => {
  try {
    const saved = localStorage.getItem(KEY);
    mode.value = saved === "auto" ? "auto" : saved === "light" ? "light" : saved === "dark" ? "dark" : document.documentElement.classList.contains("dark") ? "dark" : "light";
  } catch {}
  mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onSystem);
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
  mq?.removeEventListener("change", onSystem);
  document.removeEventListener("click", onDocClick);
  document.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div ref="root" class="theme-menu">
    <button type="button" class="theme-menu__btn" :class="{ 'is-dark': isDark }" :aria-expanded="open" aria-label="Switch theme" title="Switch theme (right-click for System)" @click.stop="toggle()" @contextmenu.prevent.stop="open = !open">
      <span class="theme-menu__icons" aria-hidden="true">
        <svg class="theme-menu__sun" viewBox="0 0 9 9" fill="currentColor" shape-rendering="crispEdges"><rect x="4" y="2" width="1" height="1"/><rect x="3" y="3" width="1" height="1"/><rect x="4" y="3" width="1" height="1"/><rect x="5" y="3" width="1" height="1"/><rect x="2" y="4" width="1" height="1"/><rect x="3" y="4" width="1" height="1"/><rect x="4" y="4" width="1" height="1"/><rect x="5" y="4" width="1" height="1"/><rect x="6" y="4" width="1" height="1"/><rect x="3" y="5" width="1" height="1"/><rect x="4" y="5" width="1" height="1"/><rect x="5" y="5" width="1" height="1"/><rect x="4" y="6" width="1" height="1"/><rect x="4" y="0" width="1" height="1"/><rect x="4" y="8" width="1" height="1"/><rect x="0" y="4" width="1" height="1"/><rect x="8" y="4" width="1" height="1"/><rect x="1" y="1" width="1" height="1"/><rect x="7" y="1" width="1" height="1"/><rect x="1" y="7" width="1" height="1"/><rect x="7" y="7" width="1" height="1"/></svg>
        <svg class="theme-menu__moon" viewBox="0 0 9 9" fill="currentColor" shape-rendering="crispEdges"><rect x="3" y="0" width="1" height="1"/><rect x="1" y="1" width="1" height="1"/><rect x="2" y="1" width="1" height="1"/><rect x="1" y="2" width="1" height="1"/><rect x="2" y="2" width="1" height="1"/><rect x="0" y="3" width="1" height="1"/><rect x="1" y="3" width="1" height="1"/><rect x="2" y="3" width="1" height="1"/><rect x="0" y="4" width="1" height="1"/><rect x="1" y="4" width="1" height="1"/><rect x="2" y="4" width="1" height="1"/><rect x="0" y="5" width="1" height="1"/><rect x="1" y="5" width="1" height="1"/><rect x="2" y="5" width="1" height="1"/><rect x="1" y="6" width="1" height="1"/><rect x="2" y="6" width="1" height="1"/><rect x="3" y="6" width="1" height="1"/><rect x="1" y="7" width="1" height="1"/><rect x="2" y="7" width="1" height="1"/><rect x="3" y="7" width="1" height="1"/><rect x="4" y="7" width="1" height="1"/><rect x="5" y="7" width="1" height="1"/><rect x="6" y="7" width="1" height="1"/><rect x="7" y="7" width="1" height="1"/><rect x="3" y="8" width="1" height="1"/><rect x="4" y="8" width="1" height="1"/><rect x="5" y="8" width="1" height="1"/></svg>
      </span>
    </button>
    <Transition name="cl-pop">
      <div v-if="open" class="theme-menu__panel" role="menu">
        <button v-for="o in options" :key="o.id" type="button" role="menuitemradio" :aria-checked="mode === o.id" class="theme-menu__item" :class="{ on: mode === o.id }" @click="pick(o.id)">
          <svg v-if="o.id === 'auto'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="14" x="2" y="3" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" /></svg>
          <svg v-else-if="o.id === 'light'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" /></svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>
          <span>{{ o.label }}</span>
          <svg v-if="mode === o.id" class="theme-menu__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
        </button>
      </div>
    </Transition>
  </div>
</template>
