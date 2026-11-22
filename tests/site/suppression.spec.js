// « Mes marchés » : cases à cocher, bouton Supprimer, dossier de réponse mis à la corbeille.
"use strict";
const { test, expect } = require("./commun");

const marche = (idweb, objet, limite, ville) => ({ idweb, objet, acheteur: "Ville de " + ville, villeAcheteur: ville, limite, procedure: "Procédure adaptée",
  types: ["TRAVAUX"], deps: ["75"], descripteurs: [], lots: [], cpv: [], urls: [] });
const STATUTS = {
  "T-1": { statut: "reponse", date: "2026-11-20T10:00:00Z", m: marche("T-1", "Ravalement façade école", "2026-12-15T11:00:00Z", "Paris"), dce: { date: "2026-11-20T10:00:00Z", fichiers: 3, lieu: "PC" } },
  "T-2": { statut: "reflexion", date: "2026-11-20T10:00:00Z", m: marche("T-2", "Peinture gymnase", "2026-12-20T11:00:00Z", "Lyon") },
  "T-3": { statut: "reponse", date: "2026-11-20T10:00:00Z", m: marche("T-3", "Plomberie mairie", "2026-12-22T11:00:00Z", "Nantes") },
};

// dossier du PC simulé : système de fichiers privé du navigateur, enregistré comme dossier des réponses
async function preparer(page, dossiers) {
  await page.route(/exceljs/, route => route.fulfill({ path: require.resolve("exceljs/dist/exceljs.min.js"), contentType: "text/javascript" }));
  await page.addInitScript(s => { if (!localStorage.getItem("vigie.statuts.v1")) localStorage.setItem("vigie.statuts.v1", JSON.stringify(s)); }, STATUTS);
  await page.goto("/index.html");
  const noms = await page.evaluate(async dossiers => {
    const racine = await navigator.storage.getDirectory();
    const sortie = [];
    for (const [id, autreDate] of Object.entries(dossiers)) {
      let nom = nomDossier(statuts[id].m);
      if (autreDate) nom = "2026120110" + nom.slice(10); // date limite reportée depuis la création du dossier
      const d = await racine.getDirectoryHandle(nom, { create: true });
      const f = await (await (await d.getDirectoryHandle("DCE", { create: true })).getFileHandle("RC.pdf", { create: true })).createWritable();
      await f.write("pdf"); await f.close();
      sortie.push(nom);
    }
    await racine.getDirectoryHandle("Autre dossier", { create: true });
    // tableau Excel de suivi avec une ligne par marché
    const ExcelJS = await chargerExcelJS(), wb = new ExcelJS.Workbook(), ws = feuilleNeuve(wb), C = colonnes(ws);
    ["T-1", "T-2", "T-3"].forEach((id, i) => { ws.getCell(i + 2, C.ref).value = id; ws.getCell(i + 2, C.nom).value = statuts[id].m.objet; });
    const w = await (await racine.getFileHandle(NOM_EXCEL, { create: true })).createWritable(); await w.write(await wb.xlsx.writeBuffer()); await w.close();
    await idbSet("racine", racine);
    return sortie;
  }, dossiers);
  await page.click('.onglet[data-vue="suivi"]');
  return noms;
}
const dossiersPresents = page => page.evaluate(async () => { const r = []; for await (const [n, h] of (await navigator.storage.getDirectory()).entries()) if (h.kind === "directory") r.push(n); return r.sort(); });

test("cocher plusieurs marchés et les supprimer avec leur dossier de réponse", async ({ page, erreurs }) => {
  const noms = await preparer(page, { "T-1": false, "T-3": true });
  await expect(page.locator("#listeSuivi .suivi-ligne")).toHaveCount(3);
  await expect(page.locator("#btnSupprimer")).toBeDisabled();
  await page.check('#listeSuivi .suivi-coche input[value="T-1"]');
  await page.check('#listeSuivi .suivi-coche input[value="T-3"]');
  await expect(page.locator("#suiviNb")).toHaveText("2 sélectionnés");
  await page.click("#btnSupprimer");
  const boite = page.locator('[role="dialog"][aria-label="Supprimer des marchés"]');
  await expect(boite).toContainText("2 dossiers de réponse trouvés");
  await expect(boite).toContainText(noms[0]);
  await expect(boite).toContainText(noms[1]); // retrouvé malgré la date changée
  await expect(boite).not.toContainText("Peinture gymnase");
  await boite.locator("button.btn-supprimer").click();
  await expect(page.locator("#listeSuivi .suivi-ligne")).toHaveCount(1);
  await expect(page.locator("#listeSuivi")).toContainText("Peinture gymnase");
  await expect(page.locator("#nbSuivis")).toHaveText("1");
  expect(await dossiersPresents(page)).toEqual(["Autre dossier"]);
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem("vigie.statuts.v1")));
  expect(Object.keys(st)).toEqual(["T-2"]);
  await expect(page.locator(".journal")).toContainText("2 lignes retirées du tableau");
  const refs = await page.evaluate(async () => {
    const f = await (await (await navigator.storage.getDirectory()).getFileHandle(NOM_EXCEL)).getFile();
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await f.arrayBuffer()); const ws = wb.worksheets[0], C = colonnes(ws), r = [];
    ws.eachRow((row, i) => { if (i > 1) r.push(ws.getCell(i, C.ref).text); }); return r;
  });
  expect(refs).toEqual(["T-2"]);
  expect(erreurs).toEqual([]);
});

test("Annuler ne supprime rien ; décocher la case garde les dossiers", async ({ page }) => {
  const noms = await preparer(page, { "T-1": false });
  await page.check("#suiviTout");
  await expect(page.locator("#suiviNb")).toHaveText("3 sélectionnés");
  await page.click("#btnSupprimer");
  const boite = page.locator('[role="dialog"][aria-label="Supprimer des marchés"]');
  await expect(boite).toContainText("1 dossier de réponse trouvé");
  await boite.locator("button", { hasText: "Annuler" }).click();
  await expect(page.locator("#listeSuivi .suivi-ligne")).toHaveCount(3);
  await page.click("#btnSupprimer");
  await expect(boite).toContainText("1 dossier de réponse trouvé");
  await boite.locator(".supp-option input").uncheck();
  await expect(boite.locator("button.btn-supprimer")).toHaveText("Supprimer 3 marchés");
  await boite.locator("button.btn-supprimer").click();
  await expect(page.locator("#listeSuivi .suivi-ligne")).toHaveCount(0);
  expect(await dossiersPresents(page)).toEqual(["Autre dossier", noms[0]].sort());
});

test("un marché pris par un autre collaborateur : retiré de ma liste, son dossier est conservé", async ({ page }) => {
  const noms = await preparer(page, { "T-3": false });
  await page.evaluate(() => { Equipe.moi = "test@exemple.fr"; Equipe.entrees["T-3"] = { id: "T-3", collab: "lea@a.fr", collabNom: "Léa" }; });
  await page.check('#listeSuivi .suivi-coche input[value="T-3"]');
  await page.click("#btnSupprimer");
  const boite = page.locator('[role="dialog"][aria-label="Supprimer des marchés"]');
  await expect(boite).toContainText("Pris par Léa");
  await expect(boite.locator("button.btn-supprimer")).toHaveText("Supprimer 1 marché");
  await boite.locator("button.btn-supprimer").click();
  await expect(page.locator("#listeSuivi .suivi-ligne")).toHaveCount(2);
  expect(await dossiersPresents(page)).toEqual(["Autre dossier", noms[0]].sort());
});
