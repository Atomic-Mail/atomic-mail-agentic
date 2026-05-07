import { defineConfig } from "vitepress";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  lang: "en-US",
  title: "Atomic Mail Agentic",
  description: "API, MCP and AgentSkill Documentation",
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
          { text: "@atomicmail/mcp", link: "/mcp" },
        ],
      },
      {
        text: "AgentSkill",
        items: [
          { text: "@atomicmail/agent-skill", link: "/skill-install" },
          { text: "Skill reference", link: "/SKILL" },
        ],
      },
      {
        text: "REST API + JMAP",
        items: [
          { text: "REST authentication flow", link: "/rest-auth" },
          { text: "Raw JMAP requests", link: "/jmap" },
          { text: "Code examples", link: "/examples" },
        ],
      },
    ],

    socialLinks: [
      { icon: "x", link: "https://x.com/atomic_mail" },
      { icon: "github", link: "https://github.com/atomicmail/agentic-clients" },
    ],
  },
});
