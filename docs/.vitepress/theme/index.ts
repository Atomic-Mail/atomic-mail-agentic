import DefaultTheme from "vitepress/theme";
import "./custom.css";
import type { Theme } from "vitepress";

// @ts-expect-error
import CopyOrDownloadAsMarkdownButtons from "vitepress-plugin-llms/vitepress-components/CopyOrDownloadAsMarkdownButtons.vue";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component(
      "CopyOrDownloadAsMarkdownButtons",
      CopyOrDownloadAsMarkdownButtons,
    );
  },
} satisfies Theme;
