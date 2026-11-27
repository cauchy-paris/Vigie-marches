// Accès démo : compte éphémère sans inscription, rien d'enregistré côté serveur, pas d'administration ni d'équipe.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { demarrerServeur } = require("./aide");
const empreinte = mdp => { const sel = crypto.randomBytes(8).toString("hex"); return sel + ":" + crypto.scryptSync(mdp, sel, 32).toString("hex"); };
const COMPTES = JSON.stringify([{ e: "chef@exemple.fr", n: "Chef", r: "admin", h: empreinte("motdepasse-solide"), v: 1, c: "2026-11-20" }]);
const charge = j => JSON.parse(Buffer.from(j.split(".")[0], "base64url").toString("utf8"));

test("démo : ouverture, droits limités, rien d'enregistré", async t => {
  const s = await demarrerServeur({ VIGIE_COMPTES: COMPTES });
  t.after(s.arreter);

  await t.test("l'état annonce la démo", async () => {
    const r = await s.appel("/compte/etat");
    assert.equal(r.json.demo, true);
  });

  let demo;
  await t.test("ouverture d'une démo sans inscription", async () => {
    const r = await s.appel("/compte/demo", { corps: {} });
    assert.equal(r.statut, 200, r.texte);
    assert.equal(r.json.compte.role, "demo");
    assert.match(r.json.compte.email, /^demo-[0-9a-f]{12}@demo\.vigie-marches$/);
    assert.equal(r.json.compte.societe, null);
    assert.equal(r.json.compte.demo.dossiers, 3);
    const fin = r.json.compte.demo.fin;
    assert.ok(fin > Date.now() + 47 * 3600e3 && fin <= Date.now() + 48 * 3600e3);
    assert.ok(charge(r.json.jeton).x <= fin && charge(r.json.lien).x <= fin);
    demo = r.json.jeton;
    const autre = await s.appel("/compte/demo", { corps: {} });
    assert.notEqual(autre.json.compte.email, r.json.compte.email);
  });

  await t.test("le jeton démo ouvre les routes du serveur", async () => {
    let r = await s.appel("/compte/moi", { jeton: demo });
    assert.equal(r.statut, 200);
    assert.equal(r.json.compte.role, "demo");
    r = await s.appel("/compte/chiffrer", { jeton: demo, corps: { texte: "secret" } });
    assert.equal(r.statut, 200);
  });

  await t.test("ni administration, ni mot de passe, ni équipe", async () => {
    for (const ch of ["liste", "creer", "motdepasse", "supprimer"]) {
      const r = await s.appel("/compte/" + ch, { jeton: demo, corps: ch === "liste" ? undefined : { email: "chef@exemple.fr", ancien: "x", nouveau: "y".repeat(12) } });
      assert.equal(r.statut, 403, ch + " " + r.texte);
    }
    let r = await s.appel("/equipe/liste", { jeton: demo });
    assert.equal(r.statut, 200);
    assert.deepEqual(r.json.entrees, []);
    assert.equal(r.json.membres.length, 1);
    r = await s.appel("/equipe/prendre", { jeton: demo, corps: { id: "26-12345", m: { objet: "Test" } } });
    assert.equal(r.statut, 403);
  });

  await t.test("aucun compte n'est créé pour la démo", async () => {
    const admin = (await s.appel("/compte/connexion", { corps: { email: "chef@exemple.fr", motdepasse: "motdepasse-solide" } })).json.jeton;
    const r = await s.appel("/compte/liste", { jeton: admin });
    assert.deepEqual(r.json.comptes.map(c => c.email), ["chef@exemple.fr"]);
  });

  await t.test("un jeton démo modifié ou une adresse hors démo est refusé", async () => {
    const [p] = demo.split(".");
    const faux = Buffer.from(JSON.stringify({ ...charge(demo), e: "chef@exemple.fr" })).toString("base64url");
    assert.equal((await s.appel("/compte/moi", { jeton: faux + "." + demo.split(".")[1] })).statut, 401);
    assert.equal((await s.appel("/compte/moi", { jeton: p + ".xx" })).statut, 401);
  });

  await t.test("trop de démos depuis la même connexion", async () => {
    let dernier;
    for (let i = 0; i < 9; i++) dernier = await s.appel("/compte/demo", { corps: {}, ipFixe: "10.9.9.9" });
    assert.equal(dernier.statut, 429);
  });
});

test("démo fermée avec VIGIE_DEMO=non", async t => {
  const s = await demarrerServeur({ VIGIE_COMPTES: COMPTES, VIGIE_DEMO: "non" });
  t.after(s.arreter);
  assert.equal((await s.appel("/compte/etat")).json.demo, false);
  assert.equal((await s.appel("/compte/demo", { corps: {} })).statut, 403);
});
