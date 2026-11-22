// Travail d'équipe avec le vrai serveur Vigie lancé en local : Léa prend un marché, Marc ne peut pas
// le prendre, l'administratrice de la société le réattribue à Marc, qui dépose l'offre.
"use strict";
const { test, expect } = require("@playwright/test");
const crypto = require("crypto");
const fs = require("fs"), path = require("path");
const { demarrerServeur } = require("../../server/test/aide");

const SERVEUR = "https://vigie-marches-dce.onrender.com";
const BOAMP = JSON.parse(fs.readFileSync(path.join(__dirname, "donnees", "boamp.json"), "utf8"));
const empreinte = mdp => { const sel = crypto.randomBytes(8).toString("hex"); return sel + ":" + crypto.scryptSync(mdp, sel, 32).toString("hex"); };
const MDP = "motdepasse-equipe";
const ID = "26-123456";

let serveur;
test.beforeAll(async () => {
  serveur = await demarrerServeur({
    ORIGINES_TEST: "http://localhost:4173",
    VIGIE_COMPTES: JSON.stringify({ v: 2, societes: [{ id: "soc_a", nom: "BTP Martin", places: null, actif: true }], comptes: [
      { e: "chef@a.fr", n: "Sophie Chef", r: "gerant", s: "soc_a", h: empreinte(MDP), v: 1 },
      { e: "lea@a.fr", n: "Léa", r: "utilisateur", s: "soc_a", h: empreinte(MDP), v: 1 },
      { e: "marc@a.fr", n: "Marc", r: "utilisateur", s: "soc_a", h: empreinte(MDP), v: 1 },
    ] }),
  });
});
test.afterAll(() => serveur && serveur.arreter());

// un navigateur par personne, déjà connecté
async function navigateur(browser, email, erreurs) {
  const r = await serveur.appel("/compte/connexion", { corps: { email, motdepasse: MDP } });
  const ctx = await browser.newContext({ locale: "fr-FR", timezoneId: "Europe/Paris" });
  await ctx.addInitScript(s => {
    if (!localStorage.getItem("vigie.session.v1")) localStorage.setItem("vigie.session.v1", JSON.stringify(s));
    window.showDirectoryPicker = () => Promise.reject(new DOMException("non", "AbortError")); // pas de dossier du PC dans les tests
  }, { jeton: r.json.jeton, lien: r.json.lien, compte: r.json.compte });
  await ctx.route(u => !u.href.startsWith("http://localhost"), async route => {
    const u = route.request().url();
    if (u.startsWith(SERVEUR)) return route.fulfill({ response: await route.fetch({ url: serveur.base + u.slice(SERVEUR.length), headers: { ...route.request().headers(), origin: "http://localhost:4173" } }) });
    if (u.includes("/catalog/datasets/boamp/records")) return route.fulfill({ json: BOAMP, headers: { "Access-Control-Allow-Origin": "*" } });
    if (/exceljs/.test(u)) return route.fulfill({ path: require.resolve("exceljs/dist/exceljs.min.js"), contentType: "text/javascript" });
    if (u.includes("cdnjs.cloudflare.com")) return route.fulfill({ body: "window.JSZip=function(){};", contentType: "text/javascript" });
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on("pageerror", e => erreurs.push(email + " : " + e.message));
  await page.goto("http://localhost:4173/index.html");
  await expect(page.locator(`#liste .carte[data-id="${ID}"]`)).toBeVisible();
  return page;
}
const carte = page => page.locator(`#liste .carte[data-id="${ID}"]`);

test("pas de doublon, attribution par l'administratrice, offre déposée, récapitulatif de l'équipe", async ({ browser }) => {
  test.setTimeout(60000);
  const erreurs = [];
  const lea = await navigateur(browser, "lea@a.fr", erreurs);
  await carte(lea).locator("button.statut[data-s=reponse]").click();
  await expect(carte(lea).locator(".badge.equipe")).toHaveText("👤 Vous");
  await expect(carte(lea).locator("button:has-text('Offre déposée')")).toBeVisible();

  // Marc voit que Léa a pris le marché et ne peut pas le prendre
  const marc = await navigateur(browser, "marc@a.fr", erreurs);
  await expect(carte(marc).locator(".badge.equipe")).toHaveText("👤 Léa");
  await carte(marc).locator("button.statut[data-s=reponse]").click();
  await expect(marc.locator(".toast, #toast").filter({ hasText: "Déjà pris par Léa" })).toBeVisible();
  await expect(carte(marc).locator("button.statut[data-s=reponse]")).toHaveAttribute("aria-pressed", "false");
  await expect(marc.locator("#nbSuivis")).toHaveText("0");
  await expect(carte(marc).locator("select.attribuer")).toHaveCount(0);

  // l'administratrice voit l'équipe et réattribue le marché à Marc
  const chef = await navigateur(browser, "chef@a.fr", erreurs);
  await expect(carte(chef).locator(".badge.equipe")).toHaveText("👤 Léa");
  await carte(chef).locator("select.attribuer").selectOption("marc@a.fr");
  await expect(carte(chef).locator(".badge.equipe")).toHaveText("👤 Marc");
  await chef.click('.onglet[data-vue="bord"]');
  const bloc = chef.locator(".encadre:has(h2:has-text('Équipe'))");
  await expect(bloc.locator("tr:has-text('Marc')").first()).toContainText("1");
  await expect(bloc.locator('select[aria-label="Responsable de l\'offre"]')).toHaveValue("marc@a.fr");

  // Marc reçoit le marché dans « Mes marchés » et dépose l'offre
  await marc.reload();
  await expect(carte(marc).locator(".badge.equipe")).toHaveText("👤 Vous");
  await expect(marc.locator("#nbSuivis")).toHaveText("1");
  await carte(marc).locator("button:has-text('Offre déposée')").click();
  await expect(carte(marc).locator(".badge.equipe")).toContainText("👤 Vous · Déposée le ");
  await expect(carte(marc).locator(".responsable")).toContainText("Responsable de l'offre");
  await expect(carte(marc).locator(".responsable-nom")).toHaveText("Marc (vous)");
  await expect(carte(marc).locator(".date-depot input")).toBeVisible();
  await carte(marc).locator(".date-depot input").fill("2026-11-20");
  await carte(marc).locator(".date-depot input").dispatchEvent("change");
  await expect(carte(marc).locator(".badge.equipe")).toHaveText("👤 Vous · Déposée le 20/11/2026");

  // Léa voit que c'est Marc maintenant ; l'administratrice voit l'offre déposée
  await lea.reload();
  await expect(carte(lea).locator(".badge.equipe")).toHaveText("👤 Marc · Déposée le 20/11/2026");
  await chef.reload();
  await chef.click('.onglet[data-vue="bord"]');
  const ligneMarc = chef.locator(".encadre:has(h2:has-text('Équipe')) tbody tr:has-text('Marc')").first();
  await expect(ligneMarc.locator("td").nth(2)).toHaveText("1");

  // récapitulatif Excel de l'équipe
  const [dl] = await Promise.all([chef.waitForEvent("download"), chef.click("button:has-text('Récapitulatif Excel')")]);
  expect(dl.suggestedFilename()).toMatch(/^Vigie_equipe_\d{4}-\d{2}-\d{2}\.xlsx$/);
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(await dl.path());
  const ws = wb.worksheets[0];
  expect(ws.getRow(1).getCell(4).text).toBe("Collaborateur désigné");
  expect(ws.getRow(2).getCell(1).text).toBe("Travaux de rénovation des réseaux CVC du Palais");
  expect(ws.getRow(2).getCell(4).text).toBe("Marc");
  expect(ws.getRow(2).getCell(5).text).toBe("Déposée");
  expect(ws.getRow(1).getCell(6).text).toBe("Date de dépôt");
  const depot = ws.getRow(2).getCell(6);
  expect(depot.value instanceof Date && depot.value.toISOString().slice(0, 10)).toBe("2026-11-20");
  expect(depot.numFmt).toBe("dd/mm/yyyy");
  expect(erreurs).toEqual([]);
});
