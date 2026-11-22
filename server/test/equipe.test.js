// Travail d'équipe : un marché pris par un seul collaborateur, attribution par l'administrateur
// de la société, étapes de l'offre partagées, sociétés étanches entre elles.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { demarrerServeur, baseNeuve } = require("./aide");

const empreinte = mdp => { const sel = crypto.randomBytes(8).toString("hex"); return sel + ":" + crypto.scryptSync(mdp, sel, 32).toString("hex"); };
const COMPTES = () => JSON.stringify({ v: 2,
  societes: [{ id: "soc_a", nom: "BTP Martin", places: null, actif: true }, { id: "soc_b", nom: "Autre", places: null, actif: true }],
  comptes: [
    { e: "chef@a.fr", n: "Paul Chef", r: "gerant", s: "soc_a", h: empreinte("mdp-chef-a-123"), v: 1 },
    { e: "lea@a.fr", n: "Léa", r: "utilisateur", s: "soc_a", h: empreinte("mdp-lea-a-123"), v: 1 },
    { e: "marc@a.fr", n: "Marc", r: "utilisateur", s: "soc_a", h: empreinte("mdp-marc-a-123"), v: 1 },
    { e: "zoe@b.fr", n: "Zoé", r: "gerant", s: "soc_b", h: empreinte("mdp-zoe-b-1234"), v: 1 },
  ] });
const M = { idweb: "26-123456", objet: "Travaux CVC du Palais", acheteur: "Sénat", limite: "2026-12-15T11:00:00Z" };

for (const mode of ["variable", "base"]) test("équipe (" + mode + ")", { skip: mode === "base" && !process.env.TEST_DATABASE_URL && "TEST_DATABASE_URL absent" }, async t => {
  const s = await demarrerServeur({ VIGIE_COMPTES: COMPTES(), ...(mode === "base" ? { DATABASE_URL: await baseNeuve() } : {}) });
  t.after(s.arreter);
  const j = {};
  for (const [e, m] of [["chef@a.fr", "mdp-chef-a-123"], ["lea@a.fr", "mdp-lea-a-123"], ["marc@a.fr", "mdp-marc-a-123"], ["zoe@b.fr", "mdp-zoe-b-1234"]]) {
    const r = await s.appel("/compte/connexion", { corps: { email: e, motdepasse: m } });
    assert.equal(r.statut, 200, r.texte); j[e] = r.json.jeton;
  }
  const eq = (qui, chemin, corps) => s.appel("/equipe/" + chemin, { jeton: j[qui], corps });

  await t.test("sans session : refusé", async () => {
    assert.equal((await s.appel("/equipe/liste")).statut, 401);
  });
  await t.test("Léa prend le marché", async () => {
    const r = await eq("lea@a.fr", "prendre", { id: M.idweb, m: M });
    assert.equal(r.statut, 200, r.texte);
    assert.equal(r.json.entree.collab, "lea@a.fr");
    assert.equal(r.json.entree.collabNom, "Léa");
    assert.equal(r.json.entree.etape, "prepa");
  });
  await t.test("pas de doublon : Marc ne peut pas le prendre", async () => {
    const r = await eq("marc@a.fr", "prendre", { id: M.idweb, m: M });
    assert.equal(r.statut, 409);
    assert.match(r.json.message, /Déjà pris par Léa/);
    assert.equal((await eq("marc@a.fr", "etape", { id: M.idweb, etape: "depose" })).statut, 403);
    assert.equal((await eq("marc@a.fr", "liberer", { id: M.idweb })).statut, 403);
    assert.equal((await eq("marc@a.fr", "prendre", { id: "autre", m: M, pour: "lea@a.fr" })).statut, 403, "un utilisateur n'attribue pas");
  });
  await t.test("toute la société voit qui répond ; l'autre société ne voit rien", async () => {
    let r = await s.appel("/equipe/liste", { jeton: j["marc@a.fr"] });
    assert.deepEqual(r.json.entrees.map(e => [e.id, e.collabNom]), [[M.idweb, "Léa"]]);
    assert.equal(r.json.chef, false);
    assert.deepEqual(r.json.membres.map(x => x.email).sort(), ["chef@a.fr", "lea@a.fr", "marc@a.fr"]);
    r = await s.appel("/equipe/liste", { jeton: j["zoe@b.fr"] });
    assert.deepEqual(r.json.entrees, []);
    assert.deepEqual(r.json.membres.map(x => x.email), ["zoe@b.fr"]);
    assert.equal((await eq("zoe@b.fr", "prendre", { id: M.idweb, m: M })).statut, 200, "chaque société a son propre suivi");
  });
  await t.test("l'administrateur de la société attribue le marché à Marc", async () => {
    assert.equal((await eq("chef@a.fr", "prendre", { id: M.idweb, pour: "zoe@b.fr" })).statut, 400, "pas hors de la société");
    const r = await eq("chef@a.fr", "prendre", { id: M.idweb, pour: "marc@a.fr" });
    assert.equal(r.statut, 200, r.texte);
    assert.equal(r.json.entree.collabNom, "Marc");
    assert.equal(r.json.entree.parNom, "Paul Chef");
    assert.equal(r.json.entree.m.objet, M.objet, "le marché est gardé");
  });
  await t.test("Marc dépose l'offre, puis elle est gagnée", async () => {
    let r = await eq("marc@a.fr", "etape", { id: M.idweb, etape: "depose", montant: 185000 });
    assert.equal(r.statut, 200, r.texte);
    assert.equal(r.json.entree.etape, "depose");
    assert.equal(r.json.entree.montant, 185000);
    assert.match(r.json.entree.dateDepot, /^\d{4}-\d{2}-\d{2}$/, "date du jour par défaut");
    r = await eq("marc@a.fr", "etape", { id: M.idweb, etape: "depose", dateDepot: "2026-11-20" });
    assert.equal(r.json.entree.dateDepot, "2026-11-20");
    assert.equal((await eq("marc@a.fr", "etape", { id: M.idweb, etape: "depose", dateDepot: "hier" })).statut, 400);
    assert.equal((await eq("marc@a.fr", "etape", { id: M.idweb, etape: "nimporte" })).statut, 400);
    r = await eq("chef@a.fr", "etape", { id: M.idweb, etape: "gagne" });
    assert.equal(r.json.entree.etape, "gagne");
    assert.equal(r.json.entree.montant, 185000, "le montant reste");
    assert.equal(r.json.entree.dateDepot, "2026-11-20", "la date de dépôt reste");
  });
  await t.test("une étape sur un marché que personne ne suit le crée pour soi", async () => {
    const r = await eq("lea@a.fr", "etape", { id: "26-999", etape: "depose", m: { objet: "Autre marché" } });
    assert.equal(r.statut, 200);
    assert.equal(r.json.entree.collab, "lea@a.fr");
  });
  await t.test("libérer un marché", async () => {
    assert.equal((await eq("lea@a.fr", "liberer", { id: "26-999" })).statut, 200);
    const r = await s.appel("/equipe/liste", { jeton: j["chef@a.fr"] });
    assert.deepEqual(r.json.entrees.map(e => e.id), [M.idweb]);
    assert.equal(r.json.chef, true);
  });
});
