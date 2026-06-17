import { defineConfig } from "vitepress";
import llmstxt from "vitepress-plugin-llms";
import { copyOrDownloadAsMarkdownButtons } from "vitepress-plugin-llms";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const pagesBase =
  process.env.GITHUB_ACTIONS && repositoryName
    ? `/${repositoryName}/`
    : "/";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  base: pagesBase,
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
        ],
      },
      {
        text: "MCP",
        items: [
          { text: "@atomicmail/mcp-gh-pages", link: "/mcp" },
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
          { text: "REST authentication flow", link: "/rest-auth" },
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
