import { defineConfig } from "vitepress";
import llmstxt from "vitepress-plugin-llms";
import { copyOrDownloadAsMarkdownButtons } from "vitepress-plugin-llms";

export default defineConfig({
    vite: {
        plugins: [llmstxt()],
    },
    markdown: {
        config(md) {
            md.use(copyOrDownloadAsMarkdownButtons);
        },
    },
});
