import { defineConfig } from "vitepress";
import llmstxt from "vitepress-plugin-llms";
import { copyOrDownloadAsMarkdownButtons } from "vitepress-plugin-llms";
import type { ShikiTransformer } from "shiki";

type HastNode = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] };

/**
 * Code blocks soft-wrap (custom.css), and browsers happily break a line after
 * a hyphen — so `--username` could split into `--` / `username`. This wraps
 * every run of non-space characters in a nowrap span, so lines only break at
 * spaces. Copying is unaffected: spans carry the original text.
 */
const nowrapWords: ShikiTransformer = {
  name: "atomicmail:nowrap-words",
  line(node) {
    const text = (n: HastNode): string =>
      n.type === "text" ? (n.value ?? "") : (n.children ?? []).map(text).join("");
    const out: HastNode[] = [];
    let group: HastNode[] = [];
    const NOWRAP_MAX = 40; // longer "words" (a JSON blob, a URL) may still break rather than overflow
    const flush = () => {
      if (!group.length) return;
      const len = group.map(text).join("").length;
      if (len > NOWRAP_MAX) out.push(...group);
      else out.push({ type: "element", tagName: "span", properties: { className: ["nb"] }, children: group });
      group = [];
    };
    const pieces = (n: HastNode): HastNode[] => {
      // split a node into alternating word / whitespace nodes with the same styling
      const t = text(n);
      const parts = t.match(/\s+|\S+/g) ?? [];
      if (parts.length <= 1) return [n];
      const make = (value: string): HastNode =>
        n.type === "text"
          ? { type: "text", value }
          : { ...n, children: [{ type: "text", value }] };
      return parts.map(make);
    };
    for (const child of node.children as HastNode[]) {
      const simple = child.type === "text" || (child.children?.length === 1 && child.children[0].type === "text");
      for (const piece of simple ? pieces(child) : [child]) {
        if (/^\s+$/.test(text(piece))) {
          flush();
          out.push(piece);
        } else {
          group.push(piece);
        }
      }
    }
    flush();
    node.children = out as never;
  },
};

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const pagesBase = process.env.GITHUB_ACTIONS && repositoryName
  ? `/${repositoryName}/`
  : "/";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  base: pagesBase,
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: `${pagesBase}favicon.svg` }],
    ["link", { rel: "alternate icon", href: `${pagesBase}favicon.ico` }],
  ],
  lang: "en-US",
  title: "Atomic Mail Docs",
  description: "Email API built for AI agents: quickstart, AgentSkill, MCP, REST + JMAP and integrations.",
  appearance: "dark",
  lastUpdated: true,
  // Emit sitemap.xml at build so search engines (and LLM crawlers) can find
  // every page. Served at https://docs.atomicmail.ai/sitemap.xml.
  sitemap: { hostname: "https://docs.atomicmail.ai" },
  // Make.com is not ready: keep the draft in the repo, out of the build.
  srcExclude: ["make.md"],

  // Release pages (changelog/[version].md) take their title and labels from the route params.
  transformPageData(pageData) {
    // SKILL.md is the published skill file (its headings are numbered for the
    // agent); keep only its sections in the outline.
    if (pageData.relativePath === "SKILL.md") pageData.frontmatter.outline = 2;
    const v = pageData.params?.version as string | undefined;
    if (v && pageData.relativePath.startsWith("changelog/")) {
      pageData.title = v;
      pageData.description = `Atomic Mail agent packages ${v}: what changed.`;
      pageData.frontmatter.outline = 2;
      pageData.frontmatter.prev = false;
      pageData.frontmatter.next = false;
    }
  },

  vite: {
    plugins: [llmstxt({ ignoreFiles: ["make.md", "changelog/*.md"] })],
  },
  markdown: {
    codeTransformers: [nowrapWords],
    config(md) {
      md.use(copyOrDownloadAsMarkdownButtons);
    },
  },
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    logo: { light: "/logo-light.svg", dark: "/logo-dark.svg", alt: "Atomic Mail" },
    siteTitle: false,

    search: { provider: "local" },

    notFound: {
      code: "404",
      title: "Page not found",
      quote: "The page moved or never existed. The quickstart is the fastest way back in.",
      linkText: "Go to the quickstart",
      linkLabel: "Go to the quickstart",
    },

    // Site link and socials live in the page footer (DocFooter.vue).
    nav: [
      { text: "Dashboard", link: "https://dashboard.atomicmail.ai" },
    ],

    // Order mirrors the Quickstart switcher: AgentSkill, MCP, REST.
    // Pages not listed here (oauth, rest-auth, make) stay reachable by link.
    // Agno-style: bold section labels, plain pages under them, chevrons only on
    // the three client groups. Pages not listed here (oauth, rest-auth, make)
    // stay reachable by link.
    sidebar: [
      {
        text: "Get started",
        items: [
          { text: "Overview", link: "/overview" },
          { text: "Quickstart", link: "/" },
          { text: "Agent flow", link: "/getting-started" },
          {
            text: "Authentication",
            collapsed: true,
            items: [
              { text: "Overview", link: "/authentication" },
              { text: "REST authentication flow", link: "/rest-auth" },
              { text: "OAuth 2.0", link: "/oauth" },
            ],
          },
          { text: "Using your own domain", link: "/custom-domains" },
          { text: "Use cases", link: "/use-cases" },
        ],
      },
      {
        text: "Connect",
        items: [
          {
            text: "AgentSkill",
            collapsed: true,
            items: [
              { text: "Install", link: "/skill-install" },
              { text: "Skill reference", link: "/SKILL" },
            ],
          },
          {
            text: "MCP",
            collapsed: true,
            items: [
              { text: "Hosted server", link: "/mcp-remote" },
              { text: "Local server", link: "/mcp" },
            ],
          },
          {
            text: "REST + JMAP",
            collapsed: true,
            items: [
              { text: "Raw JMAP requests", link: "/jmap" },
              { text: "JMAP using & inline ops", link: "/jmap-using" },
              { text: "Code examples", link: "/examples" },
            ],
          },
        ],
      },
      {
        text: "Integrations",
        items: [
          { text: "Zapier", link: "/zapier" },
          { text: "n8n", link: "/n8n" },
          { text: "Dify", link: "/dify" },
          { text: "LangChain", link: "/langchain" },
          { text: "Agentic core (npm)", link: "/core" },
        ],
      },
      {
        text: "Resources",
        items: [
          { text: "Changelog", link: "/changelog" },
          { text: "Support", link: "/support" },
        ],
      },
    ],

    outline: { level: [2, 3], label: "On this page" },
    docFooter: { prev: "Previous", next: "Next" },

  },
});
