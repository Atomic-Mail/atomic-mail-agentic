import { defineConfig } from "vitepress";
import llmstxt from "vitepress-plugin-llms";
import { copyOrDownloadAsMarkdownButtons } from "vitepress-plugin-llms";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const pagesBase = process.env.GITHUB_ACTIONS && repositoryName
  ? `/${repositoryName}/`
  : "/";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  base: pagesBase,
  head: [["link", { rel: "icon", href: `${pagesBase}favicon.ico` }]],
  lang: "en-US",
  title: "Atomic Mail Agentic",
  description: "API, MCP and AgentSkill Documentation",
  vite: {
    plugins: [llmstxt()],
  },
  markdown: {
    config(md) {
      md.use(copyOrDownloadAsMarkdownButtons);
    },
  },
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: "Home", link: "/" },
      { text: "Getting Started", link: "/getting-started" },
    ],

    sidebar: [
      {
        text: "Getting Started",
        items: [
          { text: "Overview and ideal flow", link: "/getting-started" },
          { text: "Using your own domain", link: "/custom-domains" },
        ],
      },
      {
        text: "Authentication",
        items: [
          { text: "OAuth 2.0 (apps and humans)", link: "/oauth" },
          { text: "REST + PoW (autonomous agents)", link: "/rest-auth" },
        ],
      },
      {
        text: "MCP",
        items: [
          { text: "Remote MCP server (hosted)", link: "/mcp-remote" },
          { text: "@atomicmail/mcp-gh-pages (local)", link: "/mcp" },
        ],
      },
      {
        text: "Integrations",
        items: [
          { text: "Make.com", link: "/make" },
          { text: "n8n", link: "/n8n" },
          { text: "LangChain", link: "/langchain" },
          { text: "Dify", link: "/dify" },
          { text: "@atomicmail/agentic-core", link: "/core" },
        ],
      },
      {
        text: "AgentSkill",
        items: [
          { text: "@atomicmail/agent-skill-gh-pages", link: "/skill-install" },
          { text: "Skill reference", link: "/SKILL" },
        ],
      },
      {
        text: "REST API + JMAP",
        items: [
          { text: "Raw JMAP requests", link: "/jmap" },
          { text: "JMAP `using` and inline ops", link: "/jmap-using" },
          { text: "Code examples", link: "/examples" },
        ],
      },
    ],

    socialLinks: [
      { icon: "x", link: "https://x.com/atomic_mail" },
      {
        icon: "github",
        link: "https://github.com/Atomic-Mail/atomic-mail-agentic",
      },
    ],
  },
});
