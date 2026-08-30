import { defineConfig } from "vitest/config";
import { sveltekit } from "@sveltejs/kit/vite";
import { sveltePhosphorOptimize } from "phosphor-svelte/vite";
import { phosphorCatalog } from "./scripts/phosphor-catalog-plugin.js";

export default defineConfig({
  plugins: [phosphorCatalog(), sveltePhosphorOptimize(), sveltekit()],
  resolve: { conditions: ["browser"] },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test-setup.ts"],
  },
});
