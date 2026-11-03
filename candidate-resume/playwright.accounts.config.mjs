import { defineConfig } from "@playwright/test";
import studio from "./playwright.config.mjs";
export default defineConfig({
  ...studio,
  testDir: "account-browser-tests",
  projects: [{ name: "candidate-account" }],
});
