// Recherche directe sur PLACE, Maximilien et AWS-Achat : fusion avec le BOAMP sans doublon,
// filtres de Vigie, plateforme en panne signalée sans bloquer les autres.
"use strict";
const { test, expect } = require("./commun");
const SERVEUR = "https://vigie-marches-dce.onrender.com";

const conso = (o) => ({ reference: "", objet: "", acheteur: "Ville de Montreuil", procedure: "Procédure adaptée", types: ["TRAVAUX"], parution: "2026-11-20T09:00:00.000Z", limite: "2027-03-10T11:00:00.000Z", deps: ["93"], lieu: "(93) Seine-Saint-Denis", lots: 0, ...o });
const REPONSE = {
  ok: true,
  plateformes: [
    { source: "place", nom: "PLACE", ok: true, nb: 3, partiel: false, items: [
      // déjà au BOAMP : l'avis 26-123456 cite cette consultation (même numéro) -> masquée
      conso({ id: "3093977", org: "w3x", reference: "SENAT-CVC", intitule: "Rénovation CVC du Palais", deps: ["75"], url: "https://www.marches-publics.gouv.fr/app.php/entreprise/consultation/3093977?orgAcronyme=w3x" }),
      conso({ id: "3200001", org: "x7c", reference: "MAPA-26-14", intitule: "Travaux de peinture de l'école Jules Ferry", lots: 2, url: "https://www.marches-publics.gouv.fr/app.php/entreprise/consultation/3200001?orgAcronyme=x7c" }),
      // hors des départements choisis -> écartée par le filtre de Vigie
      conso({ id: "3200002", org: "x7c", reference: "LYON-1", intitule: "Peinture du gymnase", deps: ["69"], url: "https://www.marches-publics.gouv.fr/app.php/entreprise/consultation/3200002?orgAcronyme=x7c" }),
    ] },
    { source: "maximilien", nom: "Maximilien", ok: false, nb: 0, items: [], message: "Maximilien n'a pas répondu (la plateforme répond 503)" },
    { source: "aws", nom: "AWS-Achat", ok: true, nb: 1, partiel: true, items: [
      conso({ id: "1885328", reference: "SCI2026-11", objet: "Réhabilitation peinture des parties communes", acheteur: "Paris Habitat", types: ["TRAVAUX"], deps: ["93"], depsFiltres: true, rectifie: true,
        url: "https://www.marches-publics.info/Annonces/MPI-pub-2026281811.htm", urlDce: "https://www.marches-publics.info/mpiaws/index.cfm?fuseaction=dematEnt.login&type=DCE&IDM=1885328" }),
    ] },
  ],
};

test("consultations des plateformes ajoutées sous le BOAMP, sans doublon, avec l'état de chaque plateforme", async ({ page, erreurs }) => {
  const demandes = [];
  await page.route(u => u.href.startsWith(SERVEUR + "/plateformes"), route => {
    demandes.push(new URL(route.request().url()));
    return route.fulfill({ json: REPONSE, headers: { "Access-Control-Allow-Origin": "*" } });
  });
  await page.addInitScript(() => localStorage.setItem("vigie.filtres.v1", JSON.stringify({ type: "", metiers: [], regions: [], deps: ["75", "93"], mots: "", nature: "APPEL_OFFRE", enCours: true })));
  await page.goto("/index.html");
  const bloc = page.locator("#blocPlateformes");
  await expect(bloc.locator(".carte")).toHaveCount(2);
  // la demande au serveur reprend les filtres de Vigie
  const d = demandes[demandes.length - 1];
  expect(d.searchParams.get("sources")).toBe("place,maximilien,aws");
  expect(d.searchParams.get("deps")).toBe("75,93");
  // la consultation déjà publiée au BOAMP n'apparaît qu'une fois (dans la liste BOAMP)
  await expect(page.locator('.carte[data-id="PLACE-3093977"]')).toHaveCount(0);
  await expect(page.locator('#liste .carte[data-id="26-123456"]')).toHaveCount(1);
  await expect(page.locator('.carte[data-id="PLACE-3200002"]')).toHaveCount(0); // Rhône : hors filtre
  // encart : source, lots, procédure, boutons DCE directs (Atexo) ou par code (AWS)
  const place = bloc.locator('.carte[data-id="PLACE-3200001"]');
  await expect(place.locator(".badge.source-pf")).toHaveText("Sur PLACE · hors BOAMP");
  await expect(place).toContainText("2 lots");
  await expect(place).toContainText("Procédure adaptée");
  await expect(place).toContainText("PLACE · consultation n° 3200001 · Réf. MAPA-26-14");
  await expect(place.getByRole("link", { name: "⬇ Télécharger le DCE" })).toHaveAttribute("href", /\/dce\?.*id=3200001/);
  const aws = bloc.locator('.carte[data-id="AWS-1885328"]');
  await expect(aws.locator(".badge.source-pf")).toHaveText("Sur AWS-Achat · hors BOAMP");
  await expect(aws).toContainText("Avis rectifié");
  // état de chaque plateforme : la panne de Maximilien est signalée, les autres s'affichent
  await expect(bloc.locator(".pf-sources li.ok")).toHaveCount(2);
  await expect(bloc.locator(".pf-sources li.ko")).toContainText("Maximilien n'a pas répondu");
  await expect(bloc.locator(".pf-sources")).toContainText("AWS-Achat : 1 hors BOAMP (partiel)");
  await expect(bloc.locator(".pf-etat")).toContainText("1 consultation déjà publiée au BOAMP");
  // un statut se pose comme sur un marché BOAMP
  await place.getByRole("button", { name: "En réflexion" }).click();
  const st = await page.evaluate(() => statuts["PLACE-3200001"]);
  expect(st.statut).toBe("reflexion");
  expect(st.m.source).toBe("PLACE");
  expect(erreurs).toEqual([]);
});

test("mots-clés et type appliqués aux résultats des plateformes ; case décochée : plus d'appel", async ({ page }) => {
  let n = 0;
  await page.route(u => u.href.startsWith(SERVEUR + "/plateformes"), route => { n++; return route.fulfill({ json: REPONSE, headers: { "Access-Control-Allow-Origin": "*" } }); });
  await page.addInitScript(() => localStorage.setItem("vigie.filtres.v1", JSON.stringify({ type: "", metiers: [], regions: [], deps: [], mots: "école", nature: "APPEL_OFFRE", enCours: true })));
  await page.goto("/index.html");
  const bloc = page.locator("#blocPlateformes");
  await expect(bloc.locator(".carte")).toHaveCount(1);
  await expect(bloc.locator(".carte")).toHaveAttribute("data-id", "PLACE-3200001");
  await page.locator("#fPlateformes").uncheck();
  await expect(bloc).toBeHidden();
  const avant = n;
  await page.locator("#fMots").fill("peinture");
  await page.locator("form button[type=submit]").first().click();
  await page.waitForTimeout(900);
  expect(n).toBe(avant);
});

test("serveur injoignable : message clair, la liste BOAMP reste affichée", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#liste .carte").first()).toBeVisible();
  await expect(page.locator("#blocPlateformes .pf-etat")).toContainText("Les plateformes n'ont pas pu être interrogées");
});
