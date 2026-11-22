// Écran « Gérer les comptes » avec le vrai serveur Vigie lancé en local (comptes en mémoire, BOAMP simulé).
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

async function preparer(page) {
  await page.route(u => !u.href.startsWith("http://localhost"), async route => {
    const u = route.request().url();
    // recherche directe sur les plateformes : pas d'appel extérieur pendant les tests
    if (u.startsWith(SERVEUR + "/plateformes")) return route.fulfill({ json: { ok: true, plateformes: [] }, headers: { "Access-Control-Allow-Origin": "*" } });
    if (u.startsWith(SERVEUR)) {
      const r = await route.fetch({ url: serveur.base + u.slice(SERVEUR.length), headers: { ...route.request().headers(), origin: "http://localhost:4173" } });
      return route.fulfill({ response: r });
    }
    if (u.includes("/catalog/datasets/boamp/records")) return route.fulfill({ json: BOAMP, headers: { "Access-Control-Allow-Origin": "*" } });
    if (u.includes("cdnjs.cloudflare.com")) return route.fulfill({ body: "window.JSZip=function(){};", contentType: "text/javascript" });
    return route.abort();
  });
}
async function seConnecter(page, email, motdepasse) {
  await page.goto("/index.html");
  await page.fill(".cx-voile input[name=email]", email);
  await page.fill(".cx-voile input[name=motdepasse]", motdepasse);
  await page.click(".cx-voile button[type=submit]");
  await expect(page.locator(".cx-voile")).toHaveCount(0);
}
async function ouvrirGestion(page) {
  await page.click("#btnCompte");
  await page.click(".cx-menu button:has-text('Gérer les comptes')");
  await expect(page.locator("dialog.cx-dlg")).toBeVisible();
}

test("l'administrateur Vigie crée une société et son administrateur, qui gère ensuite ses comptes", async ({ page, browser }) => {
  const erreurs = []; page.on("pageerror", e => erreurs.push(e.message));
  await preparer(page);
  await seConnecter(page, "farid@exemple.fr", "motdepasse-farid");
  await ouvrirGestion(page);
  const d = page.locator("dialog.cx-dlg");
  await expect(d).toContainText("Société principale");

  // nouvelle société avec 2 comptes
  await d.locator("input[name=nom]").first().fill("BTP Martin");
  await d.locator("input[name=places]").fill("2");
  await d.locator("button:has-text('Créer la société')").click();
  await expect(d.locator(".cx-msg.ok")).toContainText("Société créée");
  await expect(d.locator("tr:has-text('BTP Martin')").first()).toContainText("0 / 2");

  // son administrateur
  const form = d.locator("form:has(button:has-text('Créer le compte'))");
  await form.locator("input[name=nom]").fill("Paul Martin");
  await form.locator("input[name=email]").fill("paul@btp-martin.fr");
  await d.locator("select[name=role]").selectOption("gerant");
  await expect(d.locator("select[name=societe] option:checked")).toHaveText("BTP Martin");
  await form.locator("button:has-text('Créer le compte')").click();
  const mdp = (await d.locator(".cx-code").textContent()).trim();
  expect(mdp).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  await expect(d.locator("tr:has-text('paul@btp-martin.fr')")).toContainText("Paul Martin");

  // renommer la société principale
  page.once("dialog", x => x.accept("Cauchy"));
  await d.locator("tr:has-text('Société principale') button:has-text('Renommer')").click();
  await expect(d.locator("table").first()).toContainText("Cauchy (la vôtre)");

  // l'administrateur de la société se connecte dans un autre navigateur
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  p2.on("pageerror", e => erreurs.push(e.message));
  await preparer(p2);
  await seConnecter(p2, "paul@btp-martin.fr", mdp);
  // mot de passe provisoire : changement obligatoire
  const dm = p2.locator("dialog.cx-dlg");
  await dm.locator("input[name=ancien]").fill(mdp);
  await dm.locator("input[name=nouveau]").fill("motdepasse-paul");
  await dm.locator("input[name=confirmation]").fill("motdepasse-paul");
  await dm.locator("button[type=submit]").click();
  await dm.locator("button:has-text('Fermer')").click();
  await ouvrirGestion(p2);
  const d2 = p2.locator("dialog.cx-dlg");
  await expect(d2).toContainText("Société « BTP Martin » : 1 compte(s) sur 2 prévus");
  await expect(d2).not.toContainText("Sociétés clientes");
  await expect(d2).not.toContainText("farid@exemple.fr");
  await expect(d2.locator("select[name=role] option")).toHaveText(["Administrateur de la société", "Utilisateur"]);
  const f2 = d2.locator("form:has(button:has-text('Créer le compte'))");
  await f2.locator("input[name=nom]").fill("Léa");
  await f2.locator("input[name=email]").fill("lea@btp-martin.fr");
  await f2.locator("button:has-text('Créer le compte')").click();
  await expect(d2.locator(".cx-code")).toBeVisible();
  // société pleine
  await f2.locator("input[name=nom]").fill("Trop");
  await f2.locator("input[name=email]").fill("trop@btp-martin.fr");
  await f2.locator("button:has-text('Créer le compte')").click();
  await expect(d2.locator(".cx-msg.err")).toContainText("sont tous utilisés");
  await ctx2.close();

  // l'administrateur Vigie voit 2 / 2 et peut télécharger une sauvegarde
  await page.reload();
  await ouvrirGestion(page);
  await expect(page.locator("dialog.cx-dlg tr:has-text('BTP Martin')").first()).toContainText("2 / 2");
  const [telechargement] = await Promise.all([page.waitForEvent("download"), page.click("dialog.cx-dlg button:has-text('Télécharger une sauvegarde')")]);
  const contenu = JSON.parse(fs.readFileSync(await telechargement.path(), "utf8"));
  expect(contenu.comptes.map(c => c.e).sort()).toEqual(["farid@exemple.fr", "lea@btp-martin.fr", "paul@btp-martin.fr"]);
  expect(erreurs).toEqual([]);
});
