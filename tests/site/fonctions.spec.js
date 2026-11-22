// Fonctions clés de l'application, appelées directement dans la page.
"use strict";
const { test, expect, ouvrir, BOAMP } = require("./commun");

test.beforeEach(async ({ page }) => { await ouvrir(page); });

test("lecture d'un avis MAPA : lien, montant, durée, CPV, ville, SIRET", async ({ page }) => {
  const m = await page.evaluate(r => normaliser(r), BOAMP.results[0]);
  expect(m.urlDocs).toBe("https://www.marches-publics.gouv.fr/app.php/entreprise/consultation/3093977?orgAcronyme=w3x");
  expect(m.montant.replace(/\s/g, " ")).toBe("850 000 € HT");
  expect(m.duree).toBe("24 mois");
  expect(m.cpv).toEqual(["45331000"]);
  expect(m.lieu).toBe("75006 Paris");
  expect(m.villeAcheteur).toBe("Paris");
  expect(m.siretAcheteur).toBe("20000007300011");
  expect(m.description).toMatch(/Palais du Luxembourg/);
  expect(m.accordCadre).toBe(false);
});

test("lecture d'un avis : accord-cadre, avis sans données, lien BOAMP par défaut", async ({ page }) => {
  const [ac, vide] = await page.evaluate(r => [normaliser(r[1]), normaliser(r[2])], BOAMP.results);
  expect(ac.accordCadre).toBe(true);
  expect(ac.urlAvis).toBe("https://www.boamp.fr/pages/avis/?q=idweb:26-123457");
  expect(vide.urlDocs).toBeNull();
  expect(vide.cpv).toEqual([]);
});

test("lecture d'un avis eForms", async ({ page }) => {
  const r = await page.evaluate(() => analyserDonnees({
    "cac:ProcurementProject": { "cbc:ID": "2026-CVC-01", "cbc:Description": [{ "@languageID": "FRA", "#text": "Maintenance des installations de chauffage" }],
      "cac:RealizedLocation": { "cac:Address": { "cbc:CityName": "Lyon", "cbc:PostalZone": "69003" } },
      "cac:PlannedPeriod": { "cbc:DurationMeasure": { "@unitCode": "MONTH", "#text": "36" } },
      "cac:RequestedTenderTotal": { "cbc:EstimatedOverallContractAmount": { "@currencyID": "EUR", "#text": "1200000" } },
      "cac:MainCommodityClassification": { "cbc:ItemClassificationCode": "50720000" } },
    "cac:CallForTendersDocumentReference": { "cbc:ID": "DCE-1", "cac:Attachment": { "cac:ExternalReference": { "cbc:URI": "https://marchespublics.auvergnerhonealpes.eu/sdm/ent2/gen/ent_detail.action?PCSLID=CSL_2026_abc" } } },
  }));
  expect(r.description).toBe("Maintenance des installations de chauffage");
  expect(r.lieu).toBe("69003 Lyon");
  expect(r.duree).toBe("36 mois");
  expect(r.montant.replace(/\s/g, " ")).toBe("1 200 000 € HT");
  expect(r.cpv).toEqual(["50720000"]);
  expect(r.refAcheteur).toBe("2026-CVC-01");
  expect(r.urlDocs).toMatch(/^https:\/\/marchespublics\.auvergnerhonealpes\.eu\//);
});

test("requête envoyée au BOAMP selon les filtres", async ({ page }) => {
  const where = await page.evaluate(() => {
    etat.type = "TRAVAUX"; etat.deps.splice(0, 99, "75", "93"); etat.regions.length = 0;
    $("#fAcheteur").value = "Sénat"; $("#fMots").value = 'chauffage "CVC"';
    $("#fTexteComplet").checked = false; $("#fEnCours").checked = true; $("#fPublie").value = "";
    return construireWhere();
  });
  expect(where).toContain('type_marche="TRAVAUX"');
  expect(where).toContain('(code_departement="75" OR code_departement="93")');
  expect(where).toContain('search(nomacheteur,"Sénat")');
  expect(where).toContain('search(objet,"chauffage \\"CVC\\"")');
  expect(where).toMatch(/datelimitereponse>=date'\d{4}-\d{2}-\d{2}'/);
});

test("une région donne tous ses départements", async ({ page }) => {
  const deps = await page.evaluate(() => depsCibles([REGIONS.find(r => /le-de-France/.test(r[1]))[0]], []));
  expect(deps.sort()).toEqual(["75", "77", "78", "91", "92", "93", "94", "95"]);
});

test("plateforme reconnue d'après le lien de la consultation", async ({ page }) => {
  const r = await page.evaluate(() => [
    "https://www.marches-publics.gouv.fr/app.php/entreprise/consultation/3093977?orgAcronyme=w3x",
    "https://marches.maximilien.fr/entreprise/consultation/912345?orgAcronyme=a1b",
    "https://www.boamp.fr/pages/avis/?q=idweb:26-123456",
    "https://www.exemple.fr/rien",
  ].map(l => { const x = pfDeLien(new URL(l)); return x && { pf: x.pf, cle: x.cle }; }));
  expect(r[0]).toEqual({ pf: "PLACE", cle: "marches-publics.gouv.fr:3093977:w3x" });
  expect(r[1]).toEqual({ pf: "Maximilien", cle: "marches.maximilien.fr:912345:a1b" });
  expect(r[2]).toEqual({ pf: "BOAMP", cle: "boamp:26-123456" });
  expect(r[3]).toBeFalsy();
});

test("consultations trouvées dans une alerte mail", async ({ page }) => {
  const r = await page.evaluate(() => consultationsDuMail({
    sujet: "Votre alerte PLACE", de: "alerte@marches-publics.gouv.fr",
    html: '<p>Nouvelles consultations :</p><a href="https://www.marches-publics.gouv.fr/app.php/entreprise/consultation/3093977?orgAcronyme=w3x">Travaux CVC du Sénat</a><br><a href="https://www.marches-publics.gouv.fr/app.php/entreprise/consultation/3097932?orgAcronyme=s2d">Maintenance Louvre</a><a href="https://www.exemple.fr">désinscription</a>',
    texte: "",
  }));
  const cles = r.map(c => c.cle).sort();
  expect(cles).toEqual(["marches-publics.gouv.fr:3093977:w3x", "marches-publics.gouv.fr:3097932:s2d"]);
});

test("nom du dossier de réponse : date limite, type, sujet, ville", async ({ page }) => {
  const [mapa, ac] = await page.evaluate(r => [nomDossier(normaliser(r[0])), nomDossier(normaliser(r[1]))], BOAMP.results);
  expect(mapa).toMatch(/^2026121512_MAPA_.+_Paris$/);
  expect(ac).toMatch(/^2026120516_AC_/);
});

test("note de pertinence selon le profil de l'entreprise", async ({ page }) => {
  const [dans, hors] = await page.evaluate(r => {
    ecrire(CLE_PROFIL, { metiers: ["cvc"], deps: ["75"], types: ["TRAVAUX"] });
    return [notePertinence(normaliser(r[0])), notePertinence(normaliser(r[2]))];
  }, BOAMP.results);
  expect(dans.score).toBeGreaterThan(hors.score);
  expect(dans.score).toBeGreaterThanOrEqual(0);
  expect(dans.score).toBeLessThanOrEqual(100);
});

test("tableau Excel : colonne « Collaborateur désigné », remplie avec son propre nom hors équipe", async ({ page }) => {
  const r = await page.evaluate(() => {
    statuts["26-123456"] = { statut: "reponse", m: { idweb: "26-123456" } };
    return { col: COLS.find(c => c.k === "collab"), nom: collaborateurDe("26-123456"), vide: collaborateurDe("inconnu") };
  });
  expect(r.col.titre).toBe("Collaborateur désigné");
  expect(r.nom).toBe("Test");
  expect(r.vide).toBe("");
});

test("lien du DCE Atexo : référence, intitulé et date limite joints pour le repli du serveur", async ({ page }) => {
  const r = await page.evaluate(() => {
    const m = { objet: "Dispositifs médicaux consommables", refDocs: "REF-42", limite: "2027-01-08T15:00:00Z", acheteur: "AP-HP" };
    const atx = avecContexte(atexoLiens("https://marches.maximilien.fr/entreprise/consultation/912345?orgAcronyme=a1b"), m);
    return Object.fromEntries(new URL(atx.dceAuto).searchParams);
  });
  expect(r).toMatchObject({ origine: "https://marches.maximilien.fr", id: "912345", org: "a1b", reference: "REF-42", objet: "Dispositifs médicaux consommables", limite: "2027-01-08", acheteur: "AP-HP" });
});
