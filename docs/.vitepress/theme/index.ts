import DefaultTheme from "vitepress/theme";
import "./custom.css";
import { onMounted, watch } from "vue";
import { useRoute, useRouter } from "vitepress";
import type { Theme } from "vitepress";

import Layout from "./Layout.vue";
import CopyPageButtons from "./components/CopyPageButtons.vue";
import PathTabs from "./components/PathTabs.vue";
import LinkRows from "./components/LinkRows.vue";
import TabGroup from "./components/TabGroup.vue";
import ChangelogTimeline from "./components/ChangelogTimeline.vue";
import ReleaseNav from "./components/ReleaseNav.vue";

/**
 * "On this page": our own scroll-spy, replacing VitePress's.
 *
 * VitePress lights the last heading above a line near the top of the viewport,
 * throttled at 100 ms, and at the very bottom lights the last heading — one
 * pixel up it flips back. That reads as lag and as jumping when headings sit
 * close together. This one:
 *   - runs on every frame the page scrolls (no throttle);
 *   - keeps a heading lit until the reader has moved a real distance past the
 *     point where the next one would take over (hysteresis);
 *   - lights a clicked heading at once and keeps it until the reader scrolls
 *     away from where the click landed;
 *   - keeps the last heading lit near the bottom of the page.
 * VitePress still sets its own class; a MutationObserver puts ours back the
 * same tick, before paint, so the two never flicker.
 */
function steadyOutline() {
  const SEL = ".VPDocAsideOutline .outline-link";
  const LINE = 120; // px from the viewport top where a heading takes over
  const HYSTERESIS = 48; // px past a heading before it can hand over again
  const CLICK_DRIFT = 60; // px away from the landing spot before a click lets go

  let desired: HTMLElement | null = null;
  let pinned: HTMLElement | null = null;
  let pinY = -1; // where the page settled after a click; -1 = still moving
  let settle = 0;
  let raf = 0;

  const links = () => Array.from(document.querySelectorAll<HTMLElement>(SEL));
  const maxScroll = () => document.documentElement.scrollHeight - window.innerHeight;

  const headingTop = (link: HTMLElement) => {
    const id = decodeURIComponent(link.getAttribute("href")?.split("#")[1] ?? "");
    const el = id && document.getElementById(id);
    return el ? el.getBoundingClientRect().top + window.scrollY : NaN;
  };

  // One highlight plaque glides between items instead of two plaques
  // swapping, so nearby headings hand over smoothly.
  const movePill = () => {
    const box = document.querySelector<HTMLElement>(".VPDocAsideOutline .content");
    if (!box) return;
    let pill = box.querySelector<HTMLElement>(":scope > .outline-pill");
    const fresh = !pill;
    if (!pill) {
      pill = document.createElement("div");
      pill.className = "outline-pill";
      box.prepend(pill);
    }
    if (!desired || !desired.isConnected) {
      pill.style.opacity = "0";
      return;
    }
    const b = box.getBoundingClientRect();
    const r = desired.getBoundingClientRect();
    if (fresh) pill.style.transition = "none";
    pill.style.opacity = "1";
    pill.style.transform = `translateY(${r.top - b.top}px)`;
    pill.style.height = `${r.height}px`;
    if (fresh) {
      // first placement is instant; every later move glides
      void pill.offsetHeight;
      pill.style.transition = "";
    }
  };

  // Only touch classes that actually change: setting an attribute to its
  // current value still fires the observer, which would loop forever.
  const apply = () => {
    for (const el of links()) {
      const on = el === desired;
      if (el.classList.contains("active") !== on) el.classList.toggle("active", on);
    }
    movePill();
  };

  const compute = () => {
    const all = links();
    if (!all.length) { desired = null; return; }
    const y = window.scrollY;
    const last = all[all.length - 1];

    const tops = all.map((l) => ({ l, top: headingTop(l) })).filter((h) => !Number.isNaN(h.top));

    // 1. A click pins its heading until the page moves away from where it landed.
    if (pinned && pinY >= 0 && Math.abs(y - pinY) > CLICK_DRIFT) pinned = null;
    if (pinned) { desired = pinned; return; }

    // 2. The line a heading must cross sits LINE px from the top — except in
    //    the last stretch of the page, where it slides down towards the bottom
    //    edge, so the short sections that can never reach the top still get
    //    their turn, in order, and the last one is lit at the very bottom.
    const vh = window.innerHeight;
    const ms = maxScroll();
    const stretch = vh * 0.6;
    const t = ms > 0 ? Math.min(1, Math.max(0, 1 - (ms - y) / stretch)) : 1;
    const line = LINE + (vh - LINE - 24) * t;

    // 3. The last heading above the line, with hysteresis so the current one
    //    keeps its light until the next is clearly past the line.
    let next: HTMLElement | null = null;
    for (const h of tops) {
      const threshold = h.l === desired ? y + line + HYSTERESIS : y + line;
      if (h.top <= threshold) next = h.l;
      else break;
    }
    const cur = tops.find((h) => h.l === desired);
    if (cur && next !== desired && cur.top <= y + line + HYSTERESIS && cur.top > y + line) {
      next = desired;
    }
    desired = next ?? tops[0].l;
  };

  const tick = () => {
    raf = 0;
    compute();
    apply();
  };
  const schedule = () => { if (!raf) raf = window.requestAnimationFrame(tick); };

  document.addEventListener("click", (e) => {
    const link = (e.target as HTMLElement | null)?.closest<HTMLElement>(SEL);
    if (!link) return;
    pinned = link;
    pinY = -1;
    desired = link;
    apply();
  });

  window.addEventListener(
    "scroll",
    () => {
      // A click's smooth scroll: remember where it settled.
      if (pinned && pinY < 0) {
        window.clearTimeout(settle);
        settle = window.setTimeout(() => { if (pinned && pinY < 0) pinY = window.scrollY; }, 150);
      }
      schedule();
    },
    { passive: true },
  );
  window.addEventListener("resize", schedule, { passive: true });

  // VitePress re-applies its own .active; put ours back before the next paint.
  // The outline is rebuilt on every route change, so watch the body and only
  // react to class changes on outline links.
  new MutationObserver((records) => {
    if (records.some((r) => (r.target as HTMLElement).matches?.(SEL))) apply();
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });

  schedule();

  return () => {
    pinned = null;
    pinY = -1;
    desired = null;
    // the new page's outline renders a moment after the route changes
    window.setTimeout(schedule, 50);
    window.setTimeout(schedule, 300);
  };
}

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    // The markdown plugin injects <CopyOrDownloadAsMarkdownButtons /> after
    // every H1; our own component answers to that name.
    app.component("CopyOrDownloadAsMarkdownButtons", CopyPageButtons);
    app.component("PathTabs", PathTabs);
    app.component("LinkRows", LinkRows);
    app.component("TabGroup", TabGroup);
    app.component("ChangelogTimeline", ChangelogTimeline);
    app.component("ReleaseNav", ReleaseNav);
  },
  setup() {
    const router = useRouter();
    const route = useRoute();
    // The sidebar only lights an entry on an exact path match; expose the
    // current path so CSS can light "Changelog" on /changelog/<release> too.
    watch(
      () => route.path,
      (p) => {
        if (typeof document === "undefined") return; // SSR
        document.documentElement.dataset.path = p.replace(/\.html$/, "");
      },
      { immediate: true, flush: "post" },
    );
    onMounted(() => {
      const reset = steadyOutline();
      router.onAfterRouteChanged = () => reset();
    });
  },
} satisfies Theme;
