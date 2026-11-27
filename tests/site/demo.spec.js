// Accès démo avec le vrai serveur Vigie lancé en local : espace vierge, 3 dossiers au plus, tout effacé en quittant.
"use strict";
const { test, expect } = require("@playwright/test");
const crypto = require("crypto");
const fs = require("fs"), path = require("path");
const { demarrerServeur } = require("../../server/test/aide");

const SERVEUR = "https://vigie-marches-dce.onrender.com";
const BOAMP = JSON.parse(fs.readFileSync(path.join(__dirname, "donnees", "boamp.json"), "utf8"));
const empreinte = mdp => { const sel = crypto.randomBytes(8).toString("hex"); return sel + ":" + crypto.scryptSync(mdp, sel, 32).toString("hex"); };

let serveur;
test.beforeAll(async () => {
  serveur = await demarrerServeur({
    ORIGINES_TEST: "http://localhost:4173",
    VIGIE_COMPTES: JSON.stringify([{ e: "farid@exemple.fr", n: "Farid", r: "admin", h: empreinte("motdepasse-farid"), v: 1, c: "2026-11-20" }]),
  });
});
test.afterAll(() => serveur && serveur.arreter());

test.beforeEach(async ({ page }) => {
  await page.route(u => !u.href.startsWith("http://localhost"), async route => {
    const u = route.request().url();
    if (u.startsWith(SERVEUR + "/plateformes")) return route.fulfill({ json: { ok: true, plateformes: [] }, headers: { "Access-Control-Allow-Origin": "*" } });
    if (u.startsWith(SERVEUR)) {
      const r = await route.fetch({ url: serveur.base + u.slice(SERVEUR.length), headers: { ...route.request().headers(), origin: "http://localhost:4173" } });
      return route.fulfill({ response: r });
    }
    if (u.includes("/catalog/datasets/boamp/records")) return route.fulfill({ json: BOAMP, headers: { "Access-Control-Allow-Origin": "*" } });
    if (u.includes("cdnjs.cloudflare.com")) return route.fulfill({ body: "window.JSZip=function(){};", contentType: "text/javascript" });
    return route.abort();
  });
  page.on("dialog", d => d.accept());
});

const reponse = (page, i) => page.locator("#liste .carte").nth(i).locator("button.statut[data-s=reponse]");

test("démo : espace vierge, 3 dossiers au plus, tout effacé en quittant, le compte précédent retrouvé", async ({ page }) => {
  // un compte déjà utilisé sur ce navigateur
  await page.goto("/index.html");
  await page.fill(".cx-voile input[name=email]", "farid@exemple.fr");
  await page.fill(".cx-voile input[name=motdepasse]", "motdepasse-farid");
  await page.click(".cx-voile button[type=submit]");
  await expect(page.locator("#liste .carte").first()).toBeVisible();
  await page.locator("#liste .carte").first().locator("button.statut[data-s=lecture]").click();
  await expect(page.locator("#nbSuivis")).toHaveText("1");
  await page.click("#btnCompte");
  await page.click(".cx-menu button:has-text('Se déconnecter')");

  // écran de connexion : bouton démo
  const btnDemo = page.locator(".cx-voile button:has-text('Essayer la démo')");
  await expect(btnDemo).toBeVisible();
  await btnDemo.click();
  await expect(page.locator(".cx-bandeau-demo")).toContainText("0 dossier sur 3");
  await expect(page.locator("#liste .carte").first()).toBeVisible();
  await expect(page.locator("#nbSuivis")).toHaveText("0"); // rien du compte précédent

  for (let i = 0; i < 3; i++) { await reponse(page, i).click(); await expect(reponse(page, i)).toHaveAttribute("aria-pressed", "true"); }
  await expect(page.locator(".cx-bandeau-demo")).toContainText("3 dossiers sur 3");
  // 4e dossier refusé (« J'y réponds » comme « 📁 Dossier de réponse »)
  await page.evaluate(() => changerStatut({ idweb: "DEMO-4", objet: "Quatrième marché" }, "reponse"));
  await expect(page.locator("dialog.cx-dlg[open]")).toContainText("3 dossiers au maximum");
  expect(await page.evaluate(() => !!statuts["DEMO-4"])).toBe(false);
  await page.click("dialog.cx-dlg[open] button:has-text('Compris')");
  await page.evaluate(() => preparerDossier({ idweb: "DEMO-5", objet: "Cinquième marché" }));
  await expect(page.locator("dialog.cx-dlg[open]")).toContainText("3 dossiers au maximum");
  await page.click("dialog.cx-dlg[open] button:has-text('Compris')");
  // retirer puis remettre un dossier déjà compté reste possible
  await reponse(page, 0).click(); await reponse(page, 0).click();
  await expect(reponse(page, 0)).toHaveAttribute("aria-pressed", "true");
  // pas de synchronisation entre appareils en démo
  expect(await page.evaluate(() => localStorage.getItem("vigie.synchro.v1"))).toBeNull();

  // la démo survit au rechargement de la page
  await page.reload();
  await expect(page.locator(".cx-bandeau-demo")).toContainText("3 dossiers sur 3");
  await expect(page.locator("#nbSuivis")).toHaveText("3");

  await page.click(".cx-bandeau-demo button:has-text('Quitter la démo')");
  await expect(page.locator(".cx-voile button:has-text('Essayer la démo')")).toBeVisible();
  const reste = await page.evaluate(() => Object.keys(localStorage).filter(k => /^vigie\.(statuts|demo|session)/.test(k)));
  expect(reste).toEqual([]);

  // le compte précédent retrouve ses données
  await page.fill(".cx-voile input[name=email]", "farid@exemple.fr");
  await page.fill(".cx-voile input[name=motdepasse]", "motdepasse-farid");
  await page.click(".cx-voile button[type=submit]");
  await expect(page.locator("#nbSuivis")).toHaveText("1");
  await expect(page.locator(".cx-bandeau-demo")).toHaveCount(0);
});

test("lien direct #demo et démo expirée effacée", async ({ page }) => {
  await page.goto("/index.html#demo");
  await expect(page.locator(".cx-bandeau-demo")).toBeVisible();
  await reponse(page, 0).click();
  await expect(page.locator(".cx-bandeau-demo")).toContainText("1 dossier sur 3");
  // jeton arrivé à expiration
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("vigie.session.v1")); const p = btoa(JSON.stringify({ x: Date.now() - 1000 })); s.jeton = p + ".x"; localStorage.setItem("vigie.session.v1", JSON.stringify(s)); });
  await page.reload();
  await expect(page.locator(".cx-voile")).toContainText("La démo est terminée");
  expect(await page.evaluate(() => localStorage.getItem("vigie.statuts.v1"))).toBeNull();
});
