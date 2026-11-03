import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "browser-tests",
  timeout: 60000,
  use: { baseURL: "http://127.0.0.1:4173", acceptDownloads: true },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: "python3 -m http.server 4173 --bind 127.0.0.1 --directory dist",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
  },
});
