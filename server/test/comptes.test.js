// Comptes Vigie : installation, connexion, sessions, droits, mots de passe.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { demarrerServeur, baseNeuve } = require("./aide");

for (const mode of ["variable", "base"]) test("comptes : parcours complet (" + mode + ")", { skip: mode === "base" && !process.env.TEST_DATABASE_URL && "TEST_DATABASE_URL absent" }, async t => {
  const s = await demarrerServeur(mode === "base" ? { DATABASE_URL: await baseNeuve() } : {});
  t.after(s.arreter);

  await t.test("avant installation, aucun compte", async () => {
    const r = await s.appel("/compte/etat");
    assert.equal(r.statut, 200);
    assert.equal(r.json.installe, false);
    assert.equal(r.json.installable, true);
  });

  await t.test("installation refusée avec un mauvais code", async () => {
    const r = await s.appel("/compte/installation", { corps: { code: "faux", email: "chef@exemple.fr", motdepasse: "motdepasse-solide" } });
    assert.equal(r.statut, 403);
  });

  let admin;
  await t.test("installation du premier administrateur", async () => {
    const r = await s.appel("/compte/installation", { corps: { code: "code-test", nom: "Chef", email: "Chef@Exemple.fr", motdepasse: "motdepasse-solide" } });
    assert.equal(r.statut, 200, r.texte);
    assert.equal(r.json.compte.email, "chef@exemple.fr");
    assert.equal(r.json.compte.role, "admin");
    assert.ok(r.json.jeton && r.json.lien);
    admin = r.json.jeton;
  });

  await t.test("une seconde installation est refusée", async () => {
    const r = await s.appel("/compte/installation", { corps: { code: "code-test", email: "autre@exemple.fr", motdepasse: "motdepasse-solide" } });
    assert.equal(r.statut, 409);
  });

  await t.test("connexion : bon et mauvais mot de passe", async () => {
    assert.equal((await s.appel("/compte/connexion", { corps: { email: "chef@exemple.fr", motdepasse: "mauvais-mot" } })).statut, 401);
    assert.equal((await s.appel("/compte/connexion", { corps: { email: "inconnu@exemple.fr", motdepasse: "motdepasse-solide" } })).statut, 401);
    const r = await s.appel("/compte/connexion", { corps: { email: "CHEF@exemple.fr", motdepasse: "motdepasse-solide" } });
    assert.equal(r.statut, 200);
    assert.equal(r.json.compte.nom, "Chef");
  });

  await t.test("routes protégées sans session ou avec un faux jeton", async () => {
    let r = await s.appel("/compte/moi");
    assert.equal(r.statut, 401);
    assert.equal(r.entetes.get("x-vigie-connexion"), "1");
    r = await s.appel("/compte/moi", { jeton: admin.slice(0, -2) + "xx" });
    assert.equal(r.statut, 401);
    r = await s.appel("/compte/moi", { jeton: admin });
    assert.equal(r.statut, 200);
    assert.equal(r.json.compte.email, "chef@exemple.fr");
  });

  let mdpProvisoire;
  await t.test("l'administrateur crée un utilisateur", async () => {
    const r = await s.appel("/compte/creer", { jeton: admin, corps: { nom: "Léa", email: "lea@exemple.fr", role: "utilisateur" } });
    assert.equal(r.statut, 200, r.texte);
    assert.match(r.json.motdepasse, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    mdpProvisoire = r.json.motdepasse;
    assert.equal((await s.appel("/compte/creer", { jeton: admin, corps: { email: "lea@exemple.fr" } })).statut, 409);
    const l = await s.appel("/compte/liste", { jeton: admin });
    assert.deepEqual(l.json.comptes.map(c => c.email).sort(), ["chef@exemple.fr", "lea@exemple.fr"]);
    // les empreintes des mots de passe ne sortent jamais
    assert.ok(!/scrypt|"h"\s*:/.test(l.texte));
  });

  let lea;
  await t.test("l'utilisateur se connecte, change son mot de passe, l'ancienne session tombe", async () => {
    let r = await s.appel("/compte/connexion", { corps: { email: "lea@exemple.fr", motdepasse: mdpProvisoire } });
    assert.equal(r.statut, 200);
    assert.equal(r.json.compte.provisoire, true);
    const ancienne = r.json.jeton;
    r = await s.appel("/compte/motdepasse", { jeton: ancienne, corps: { ancien: mdpProvisoire, nouveau: "court" } });
    assert.equal(r.statut, 400);
    r = await s.appel("/compte/motdepasse", { jeton: ancienne, corps: { ancien: mdpProvisoire, nouveau: "nouveau-mot-de-passe" } });
    assert.equal(r.statut, 200, r.texte);
    assert.equal(r.json.compte.provisoire, false);
    lea = r.json.jeton;
    assert.equal((await s.appel("/compte/moi", { jeton: ancienne })).statut, 401);
    assert.equal((await s.appel("/compte/moi", { jeton: lea })).statut, 200);
  });

  await t.test("un utilisateur n'a pas accès à l'administration", async () => {
    assert.equal((await s.appel("/compte/liste", { jeton: lea })).statut, 403);
    assert.equal((await s.appel("/compte/creer", { jeton: lea, corps: { email: "x@exemple.fr" } })).statut, 403);
    assert.equal((await s.appel("/compte/supprimer", { jeton: lea, corps: { email: "chef@exemple.fr" } })).statut, 403);
  });

  await t.test("chiffrement d'un secret propre au compte", async () => {
    const r = await s.appel("/compte/chiffrer", { jeton: lea, corps: { texte: "mot-de-passe-imap" } });
    assert.equal(r.statut, 200);
    assert.match(r.json.chiffre, /^v1\./);
    assert.ok(!r.json.chiffre.includes("mot-de-passe-imap"));
  });

  await t.test("l'administrateur réinitialise puis supprime le compte", async () => {
    let r = await s.appel("/compte/reinitialiser", { jeton: admin, corps: { email: "lea@exemple.fr" } });
    assert.equal(r.statut, 200);
    assert.equal((await s.appel("/compte/moi", { jeton: lea })).statut, 401, "l'ancienne session doit tomber");
    assert.equal((await s.appel("/compte/supprimer", { jeton: admin, corps: { email: "chef@exemple.fr" } })).statut, 400, "pas de suppression de soi-même");
    r = await s.appel("/compte/supprimer", { jeton: admin, corps: { email: "lea@exemple.fr" } });
    assert.equal(r.statut, 200);
    assert.equal((await s.appel("/compte/connexion", { corps: { email: "lea@exemple.fr", motdepasse: "nouveau-mot-de-passe" } })).statut, 401);
  });

  await t.test("trop d'essais de mot de passe : blocage", async () => {
    let dernier;
    for (let i = 0; i < 9; i++) dernier = await s.appel("/compte/connexion", { ipFixe: "10.9.9.9", corps: { email: "chef@exemple.fr", motdepasse: "mauvais-" + i } });
    assert.equal(dernier.statut, 429);
  });
});

test("comptes : les comptes enregistrés dans VIGIE_COMPTES (ancien format) sont relus au démarrage", async t => {
  const crypto = require("crypto");
  const sel = "0123456789abcdef";
  const h = sel + ":" + crypto.scryptSync("motdepasse-solide", sel, 32).toString("hex");
  const s = await demarrerServeur({ VIGIE_COMPTES: JSON.stringify([{ e: "farid@exemple.fr", n: "Farid", r: "admin", h, v: 3, c: "2026-11-21" }]) });
  t.after(s.arreter);
  assert.equal((await s.appel("/compte/etat")).json.installe, true);
  const r = await s.appel("/compte/connexion", { corps: { email: "farid@exemple.fr", motdepasse: "motdepasse-solide" } });
  assert.equal(r.statut, 200);
  assert.equal(r.json.compte.role, "admin");
});
