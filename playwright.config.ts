import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const systemChromium = "/run/current-system/sw/bin/chromium";

export default defineConfig({
  testDir: "tests",
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1440, height: 900 },
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (existsSync(systemChromium) ? systemChromium : undefined) },
  },
  webServer: { command: "bun run build && bun run preview --host 127.0.0.1", port: 4173, reuseExistingServer: true },
});
