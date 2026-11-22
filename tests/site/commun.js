// Préparation commune : session Vigie simulée, BOAMP simulé, tout autre appel extérieur coupé.
"use strict";
const base = require("@playwright/test");
const fs = require("fs"), path = require("path");
const BOAMP = JSON.parse(fs.readFileSync(path.join(__dirname, "donnees", "boamp.json"), "utf8"));
const SERVEUR = "https://vigie-marches-dce.onrender.com";
const COMPTE = { email: "test@exemple.fr", nom: "Test", role: "admin" };

const test = base.test.extend({
  appels: async ({}, use) => { await use([]); },
  erreurs: async ({}, use) => { await use([]); },
  page: async ({ page, appels, erreurs }, use) => {
    await page.addInitScript(compte => {
      const p = btoa(JSON.stringify({ e: compte.email, x: Date.now() + 10 * 864e5 })).replace(/=+$/, "");
      if (!localStorage.getItem("vigie.session.v1")) localStorage.setItem("vigie.session.v1", JSON.stringify({ jeton: p + ".sig", lien: p + ".sig", compte }));
    }, COMPTE);
    await page.route(u => !u.href.startsWith("http://localhost"), route => {
      const u = route.request().url();
      appels.push(u);
      const cors = { "Access-Control-Allow-Origin": "*" };
      if (u.startsWith(SERVEUR + "/compte/moi")) return route.fulfill({ json: { lien: "a.b", compte: COMPTE }, headers: cors });
      if (u.startsWith(SERVEUR + "/compte/etat")) return route.fulfill({ json: { installe: true }, headers: cors });
      if (u.includes("/catalog/datasets/boamp/records")) return route.fulfill({ json: BOAMP, headers: cors });
      if (u.includes("cdnjs.cloudflare.com")) return route.fulfill({ body: "window.JSZip=function(){};", contentType: "text/javascript" });
      return route.abort();
    });
    page.on("pageerror", e => erreurs.push(e.message));
    await use(page);
  },
});

async function ouvrir(page) {
  await page.goto("/index.html");
  await base.expect(page.locator("#liste .carte").first()).toBeVisible();
}

module.exports = { test, expect: base.expect, ouvrir, BOAMP };
