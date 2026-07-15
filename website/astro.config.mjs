import { fileURLToPath } from "node:url";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

const github = "https://github.com/0xmiki/figmaboy";

export default defineConfig({
  site: "https://0xmiki.github.io",
  base: "/figmaboy",
  publicDir: fileURLToPath(new URL("../static", import.meta.url)),
  integrations: [
    starlight({
      title: "Figmaboy Docs",
      description: "Install Figmaboy, connect Codex, and build editable interface designs with native layers.",
      favicon: "/favicon.png",
      logo: {
        light: "../static/figmaboy-dark.svg",
        dark: "../static/figmaboy.svg",
        alt: "Figmaboy",
        replacesTitle: false,
      },
      social: [
        { icon: "github", label: "GitHub", href: github },
      ],
      editLink: {
        baseUrl: `${github}/edit/main/website/`,
      },
      lastUpdated: true,
      customCss: [
        "./src/styles/fonts.css",
        "./src/styles/docs.css",
      ],
      head: [
        { tag: "meta", attrs: { name: "theme-color", content: "#f3f0e8" } },
        { tag: "meta", attrs: { property: "og:image", content: `${github}/raw/main/docs/assets/figmaboy-codex-workflow.png` } },
        { tag: "script", content: "try { if (!localStorage.getItem('starlight-theme')) localStorage.setItem('starlight-theme', 'light'); } catch {}" },
      ],
      sidebar: [
        {
          label: "Getting started",
          items: [
            { label: "Overview", slug: "docs" },
            { label: "Install & connect", slug: "docs/getting-started/install" },
            { label: "Quickstart", slug: "docs/getting-started/quickstart" },
          ],
        },
        {
          label: "Core concepts",
          items: [
            { label: "Canvas and native layers", slug: "docs/core-concepts/canvas-and-layers" },
            { label: "Codex and the MCP", slug: "docs/core-concepts/codex-mcp" },
            { label: "Local data and autosave", slug: "docs/core-concepts/local-data" },
          ],
        },
        {
          label: "Workflows",
          items: [
            { label: "Build with Codex", slug: "docs/workflows/build-with-codex" },
            { label: "Use a saved design offline", slug: "docs/workflows/offline-context" },
            { label: "Review and refine", slug: "docs/workflows/review-and-refine" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "MCP tools", slug: "docs/reference/mcp-tools" },
            { label: "Keyboard shortcuts", slug: "docs/reference/shortcuts" },
            { label: "Files and paths", slug: "docs/reference/files-and-paths" },
            { label: "Troubleshooting", slug: "docs/reference/troubleshooting" },
          ],
        },
      ],
    }),
  ],
});
