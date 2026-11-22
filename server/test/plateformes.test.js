// Recherche directe sur PLACE / Maximilien (Atexo) et AWS-Achat : lecture des pages de résultats,
// pages suivantes, découpage quand AWS refuse une recherche trop large, panne d'une plateforme.
// Aucun appel extérieur : les plateformes sont simulées à partir de pages réelles réduites.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const P = require("../plateformes");

const BLOC = fs.readFileSync(path.join(__dirname, "donnees", "atexo-bloc.html"), "utf8");
const PAGE_AWS = fs.readFileSync(path.join(__dirname, "donnees", "aws-page.html"), "utf8");

function blocAtexo(n, o = {}) {
  const v = { ID: String(3085000 + n), PROC: "Appel d'offres ouvert", PROCC: "AOO", CAT: "Travaux", REF: "27-0" + n, TITRE: "Travaux de peinture n° " + n, OBJET: "Travaux de peinture du bâtiment " + n + ", Boulogne-Billancourt.", ORG: "Etablissements de Santé", ...o };
  return BLOC.replace(/__N__/g, String(n)).replace(/__(\w+)__/g, (m, k) => v[k] ?? m);
}
function pageAtexo(blocs, total, page = 1) {
  return `<html><body><form id="ctl0_ctl1" method="post"><input type="hidden" name="PRADO_PAGESTATE" value="etat${page}">
  <span>Nombre de résultats : ${total}</span>
  <select name="ctl0$CONTENU_PAGE$resultSearch$listePageSizeTop"><option value="10">10</option><option selected="selected" value="20">20</option></select>
  <input name="ctl0$CONTENU_PAGE$resultSearch$numPageTop" value="${page}">${blocs.join("\n")}</form></body></html>`;
}
const rep = (corps, statut = 200) => ({ rep: { ok: statut < 400, status: statut, text: async () => corps } });

test("lecture d'une page de résultats Atexo (PLACE, Maximilien)", () => {
  const r = P.lireResultatsAtexo(pageAtexo([blocAtexo(1), blocAtexo(2, { CAT: "Services", PROC: "Procédure adaptée", PROCC: "MAPA" })], 85), "https://www.marches-publics.gouv.fr");
  assert.equal(r.total, 85);
  assert.equal(r.items.length, 2);
  const a = r.items[0];
  assert.equal(a.id, "3085001");
  assert.equal(a.org, "x7c");
  assert.equal(a.reference, "27-01");
  assert.equal(a.intitule, "Travaux de peinture n° 1");
  assert.equal(a.objet, "Travaux de peinture du bâtiment 1, Boulogne-Billancourt.");
  assert.equal(a.acheteur, "Etablissements de Santé");
  assert.equal(a.procedure, "Appel d'offres ouvert");
  assert.deepEqual(a.types, ["TRAVAUX"]);
  assert.deepEqual(a.deps, ["75", "77", "92"]); // liste complète (infobulle), pas seulement les deux premiers
  assert.equal(a.lots, 3);
  assert.equal(a.parution, "2026-11-09T23:00:00.000Z");
  assert.equal(a.limite, "2027-01-15T15:00:00.000Z"); // 16:00 heure de Paris
  assert.equal(a.url, "https://www.marches-publics.gouv.fr/app.php/entreprise/consultation/3085001?orgAcronyme=x7c");
  assert.deepEqual(r.items[1].types, ["SERVICES"]);
  assert.equal(r.items[1].procedure, "Procédure adaptée");
});

test("lecture d'une page de résultats AWS-Achat", () => {
  const r = P.lireResultatsAws(PAGE_AWS, "TRAVAUX");
  assert.equal(r.trop, 0);
  assert.equal(r.pages, 3);
  assert.equal(r.items.length, 2);
  const a = r.items[0];
  assert.equal(a.id, "1885328"); // numéro IDM (celui du DCE), pas celui de la page de l'avis
  assert.equal(a.reference, "SCI2026-11");
  assert.equal(a.objet, "Réhabilitation d’un ensemble immobilier situé au 3/9/15 rue Jacques HILLAIRET à PARIS XII.");
  assert.equal(a.acheteur, "Fonds de Garantie des Assurances Obligatoires de Dommages");
  assert.deepEqual(a.deps, ["94"]);
  assert.equal(a.lots, 3);
  assert.equal(a.rectifie, true);
  assert.equal(a.parution, "2026-10-06T22:00:00.000Z");
  assert.equal(a.limite, "2026-11-23T11:00:00.000Z");
  assert.equal(a.url, "https://www.marches-publics.info/Annonces/MPI-pub-2026281811.htm");
  assert.match(a.urlDce, /type=DCE&IDM=1885328$/);
  assert.equal(r.items[1].lots, 0);
  assert.equal(r.items[1].reference, "2026-1105");
  const trop = P.lireResultatsAws("<p>Votre recherche trouve 217 résultats. Veuillez préciser votre recherche à  l&#039;aide des critères</p>", "TRAVAUX");
  assert.equal(trop.trop, 217);
});

test("départements : lieux d'exécution, codes postaux, codes AWS", () => {
  assert.deepEqual(P.departements("(2A) Corse-du-Sud, (971) Guadeloupe, (2A) x"), ["2A", "971"]);
  assert.equal(P.depDuCodePostal("75253"), "75");
  assert.equal(P.depDuCodePostal("97400"), "974");
  assert.equal(P.depDuCodePostal("20000"), "");
  assert.equal(P.depAws("01"), "1");
  assert.equal(P.depAws("2A"), "2a");
  assert.equal(P.depAws("75"), "75");
});

test("Atexo : pages suivantes par postback, mots-clés séparés, sans doublon", async () => {
  P.viderCache();
  const appels = [];
  const requete = async (url, jar, opts = {}) => {
    const corps = opts.body ? new URLSearchParams(String(opts.body)) : null;
    appels.push({ url, cible: corps && corps.get("PRADO_POSTBACK_TARGET"), etat: corps && corps.get("PRADO_PAGESTATE") });
    const mot = new URL(url).searchParams.get("keyWord");
    if (mot === "peinture") {
      if (!corps) return rep(pageAtexo([1, 2].map(n => blocAtexo(n)), 3, 1));
      assert.equal(corps.get("PRADO_POSTBACK_TARGET"), "ctl0$CONTENU_PAGE$resultSearch$PagerTop$ctl3");
      assert.equal(corps.get("PRADO_PAGESTATE"), "etat1");
      return rep(pageAtexo([blocAtexo(3)], 3, 2));
    }
    if (mot === "revêtements") return rep(pageAtexo([blocAtexo(2), blocAtexo(9)], 2, 1)); // la n° 2 est déjà vue
    throw new Error("adresse inattendue " + url);
  };
  const [r] = await P.rechercherPlateformes({ sources: ["place"], termes: ["peinture", "revêtements"] }, requete);
  assert.equal(r.ok, true);
  assert.deepEqual(r.items.map(x => x.id).sort(), ["3085001", "3085002", "3085003", "3085009"]);
  assert.equal(r.partiel, false);
  // même recherche dans les 30 minutes : servie par le cache, aucune requête de plus
  const n = appels.length;
  await P.rechercherPlateformes({ sources: ["place"], termes: ["peinture", "revêtements"], deps: ["93"] }, requete);
  assert.equal(appels.length, n);
});

test("AWS : recherche trop large découpée par département, puis limitée aux avis récents", async () => {
  P.viderCache();
  const envois = [];
  const requete = async (url, jar, opts = {}) => {
    if (!opts.body) return rep(PAGE_AWS.replace(/1885328/g, "1885999").replace(/1891674/g, "1891999").replace(/pager_t=\d/g, "")); // page 2
    const f = new URLSearchParams(String(opts.body));
    envois.push(f.get("IDN") + ":" + f.get("IDR") + ":" + f.get("dateParution"));
    if (f.get("IDR") === "75,92") return rep("Votre recherche trouve 217 résultats. Veuillez préciser");
    if (f.get("IDR") === "92" && !f.get("dateParution")) return rep("Votre recherche trouve 130 résultats. Veuillez préciser");
    if (f.get("IDR") === "92") return rep(PAGE_AWS.replace(/1885328/g, "1700001").replace(/1891674/g, "1700002").replace(/pager_t=\d/g, ""));
    return rep(PAGE_AWS);
  };
  const [r] = await P.rechercherPlateformes({ sources: ["aws"], type: "TRAVAUX", deps: ["92", "75"] }, requete);
  assert.equal(r.ok, true);
  assert.deepEqual(envois, ["T:75,92:", "T:75:", "T:92:", "T:92: < 30"]);
  assert.deepEqual(r.items.map(x => x.id).sort(), ["1700001", "1700002", "1885328", "1885999", "1891674", "1891999"]);
  assert.ok(r.items.every(x => x.depsFiltres));
  assert.equal(r.partiel, true); // le 92 n'a que les avis des 30 derniers jours
});

test("une plateforme en panne n'empêche pas les autres de répondre", async () => {
  P.viderCache();
  const requete = async (url) => {
    if (/maximilien/.test(url)) return rep("Service indisponible", 503);
    if (/marches-publics\.info/.test(url)) throw new Error("connexion refusée");
    return rep(pageAtexo([blocAtexo(1)], 1));
  };
  const r = await P.rechercherPlateformes({ mots: "peinture" }, requete);
  const parSource = Object.fromEntries(r.map(x => [x.source, x]));
  assert.equal(parSource.place.ok, true);
  assert.equal(parSource.place.items.length, 1);
  assert.equal(parSource.maximilien.ok, false);
  assert.match(parSource.maximilien.message, /Maximilien n'a pas répondu \(la plateforme répond 503\)/);
  assert.equal(parSource.aws.ok, false);
  assert.match(parSource.aws.message, /AWS-Achat n'a pas répondu/);
  // l'erreur n'est pas gardée en cache : la recherche suivante réinterroge la plateforme
  let rappel = 0;
  await P.rechercherPlateformes({ sources: ["maximilien"], mots: "peinture" }, async () => { rappel++; return rep(pageAtexo([blocAtexo(5)], 1)); });
  assert.equal(rappel, 1);
});
