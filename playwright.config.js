// Tests du site Vigie (navigateur Chromium, réseau extérieur simulé).
const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "tests/site",
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:4173", locale: "fr-FR", timezoneId: "Europe/Paris", trace: "off" },
  webServer: { command: "node tests/serveur-statique.js", url: "http://localhost:4173/index.html", reuseExistingServer: !process.env.CI },
});
