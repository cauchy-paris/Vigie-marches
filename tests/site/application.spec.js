// L'application s'ouvre, affiche les annonces et garde les statuts.
"use strict";
const { test, expect, ouvrir } = require("./commun");

test("ouverture sans erreur, avec les annonces du BOAMP", async ({ page, erreurs }) => {
  await ouvrir(page);
  await expect(page.locator("#liste .carte")).toHaveCount(3);
  await expect(page.locator("#nbRes")).toHaveText("3");
  await expect(page.locator("#liste")).toContainText("Travaux de rénovation des réseaux CVC du Palais");
  await expect(page.locator("#liste")).toContainText("Sénat");
  expect(erreurs).toEqual([]);
});

test("chaque encart a ses boutons RC, DCE et statuts", async ({ page }) => {
  await ouvrir(page);
  const carte = page.locator('#liste .carte[data-id="26-123456"]');
  for (const texte of ["Télécharger le RC", "Télécharger le DCE", "Lecture", "En réflexion", "J'y réponds", "Montant estimé", "850"]) await expect(carte).toContainText(texte);
});

test("un statut choisi est gardé et compté dans « Mes marchés »", async ({ page }) => {
  await ouvrir(page);
  await expect(page.locator("#nbSuivis")).toHaveText("0");
  await page.locator('#liste .carte[data-id="26-123457"] button:has-text("En réflexion")').click();
  await expect(page.locator("#nbSuivis")).toHaveText("1");
  const statuts = await page.evaluate(() => JSON.parse(localStorage.getItem("vigie.statuts.v1")));
  expect(statuts["26-123457"].statut).toBe("reflexion");
  await page.reload();
  await expect(page.locator("#nbSuivis")).toHaveText("1");
  await page.click('.onglet[data-vue="suivi"]');
  await expect(page.locator("#listeSuivi")).toContainText("Accord-cadre de maintenance électrique");
});

test("les onglets et les fenêtres principales s'ouvrent", async ({ page, erreurs }) => {
  await ouvrir(page);
  for (const vue of ["suivi", "attribues", "bord", "sources", "recherche"]) {
    await page.click(`.onglet[data-vue="${vue}"]`);
    await expect(page.locator(`.onglet[data-vue="${vue}"]`)).toHaveAttribute("aria-selected", "true");
  }
  for (const bouton of ["#btnOd", "#btnMail", "#btnAjout"]) {
    await page.click(bouton);
    await expect(page.locator(".captcha-fond")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".captcha-fond")).toHaveCount(0);
  }
  expect(erreurs).toEqual([]);
});

test("sans session, l'écran de connexion s'affiche", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("vigie.session.v1", "null"));
  await page.goto("/index.html");
  await expect(page.locator(".cx-voile")).toBeVisible();
  await expect(page.locator(".cx-voile")).toContainText("Mot de passe");
});
