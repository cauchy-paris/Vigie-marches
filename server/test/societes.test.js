// Sociétés clientes : administrateur Vigie, administrateur de société, nombre de comptes, suspension,
// migration des anciens comptes, base Postgres (rien perdu au redémarrage) et sauvegardes.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { demarrerServeur, baseNeuve, requete } = require("./aide");

const SANS_BASE = !process.env.TEST_DATABASE_URL && "TEST_DATABASE_URL absent";
const empreinte = mdp => { const sel = crypto.randomBytes(8).toString("hex"); return sel + ":" + crypto.scryptSync(mdp, sel, 32).toString("hex"); };
// comptes tels qu'ils sont aujourd'hui dans VIGIE_COMPTES (avant les sociétés)
const ANCIENS = () => JSON.stringify([
  { e: "farid@exemple.fr", n: "Farid", r: "admin", h: empreinte("motdepasse-farid"), v: 4, c: "2026-11-20" },
  { e: "collegue@exemple.fr", n: "Collègue", r: "utilisateur", h: empreinte("motdepasse-collegue"), v: 1, t: 1, c: "2026-11-21" },
]);
const connecter = async (s, email, motdepasse) => {
  const r = await s.appel("/compte/connexion", { corps: { email, motdepasse } });
  assert.equal(r.statut, 200, email + " : " + r.texte);
  return r.json;
};

for (const mode of ["variable", "base"]) test("sociétés et droits (" + mode + ")", { skip: mode === "base" && SANS_BASE }, async t => {
  const env = { VIGIE_COMPTES: ANCIENS(), ...(mode === "base" ? { DATABASE_URL: await baseNeuve() } : {}) };
  const s = await demarrerServeur(env);
  t.after(s.arreter);
  const farid = await connecter(s, "farid@exemple.fr", "motdepasse-farid");
  const A = farid.jeton;

  await t.test("les anciens comptes sont gardés et rangés dans une « Société principale »", async () => {
    assert.equal(farid.compte.role, "admin");
    assert.equal(farid.compte.societe.nom, "Société principale");
    const c = await connecter(s, "collegue@exemple.fr", "motdepasse-collegue");
    assert.equal(c.compte.provisoire, true);
    assert.equal(c.compte.societe.id, farid.compte.societe.id);
  });

  let btp;
  await t.test("l'administrateur Vigie crée une société cliente avec 2 comptes", async () => {
    let r = await s.appel("/compte/societe/creer", { jeton: A, corps: { nom: "BTP Martin", places: 2 } });
    assert.equal(r.statut, 200, r.texte);
    btp = r.json.societe;
    assert.equal(btp.places, 2);
    assert.equal((await s.appel("/compte/societe/creer", { jeton: A, corps: { nom: "btp martin" } })).statut, 409, "nom déjà pris");
    r = await s.appel("/compte/societe/modifier", { jeton: A, corps: { id: farid.compte.societe.id, nom: "Cauchy" } });
    assert.equal(r.json.societe.nom, "Cauchy");
  });

  let gerantMdp;
  await t.test("il crée l'administrateur de cette société", async () => {
    const r = await s.appel("/compte/creer", { jeton: A, corps: { nom: "Paul Martin", email: "paul@btp-martin.fr", role: "gerant", societe: btp.id } });
    assert.equal(r.statut, 200, r.texte);
    gerantMdp = r.json.motdepasse;
  });

  let G, employeMdp;
  await t.test("l'administrateur de société gère seulement les comptes de sa société", async () => {
    const g = await connecter(s, "paul@btp-martin.fr", gerantMdp);
    assert.equal(g.compte.role, "gerant");
    assert.equal(g.compte.societe.nom, "BTP Martin");
    G = g.jeton;
    let r = await s.appel("/compte/creer", { jeton: G, corps: { nom: "Employé", email: "employe@btp-martin.fr", role: "admin", societe: farid.compte.societe.id } });
    assert.equal(r.statut, 200, r.texte);
    employeMdp = r.json.motdepasse;
    r = await s.appel("/compte/liste", { jeton: G });
    assert.deepEqual(r.json.comptes.map(c => c.email), ["employe@btp-martin.fr", "paul@btp-martin.fr"]);
    assert.deepEqual(r.json.societes.map(x => x.nom), ["BTP Martin"]);
    assert.deepEqual(r.json.roles, ["gerant", "utilisateur"]);
    const e = r.json.comptes.find(c => c.email === "employe@btp-martin.fr");
    assert.equal(e.role, "utilisateur", "un administrateur de société ne peut pas créer d'administrateur Vigie");
    assert.equal(e.societe.id, btp.id, "ni créer un compte dans une autre société");
  });

  await t.test("il ne voit ni ne touche les autres sociétés", async () => {
    for (const [chemin, corps] of [["reinitialiser", { email: "collegue@exemple.fr" }], ["supprimer", { email: "farid@exemple.fr" }], ["modifier", { email: "collegue@exemple.fr", nom: "x" }]]) {
      assert.equal((await s.appel("/compte/" + chemin, { jeton: G, corps })).statut, 404, chemin);
    }
    assert.equal((await s.appel("/compte/societe/creer", { jeton: G, corps: { nom: "Pirate" } })).statut, 403);
    assert.equal((await s.appel("/compte/sauvegarde", { jeton: G })).statut, 403);
    assert.equal((await s.appel("/compte/modifier", { jeton: G, corps: { email: "employe@btp-martin.fr", role: "admin" } })).statut, 403);
    assert.equal((await s.appel("/compte/modifier", { jeton: G, corps: { email: "paul@btp-martin.fr", role: "utilisateur" } })).statut, 400, "pas de changement de son propre rôle");
  });

  await t.test("le nombre de comptes de l'abonnement est respecté", async () => {
    let r = await s.appel("/compte/creer", { jeton: G, corps: { email: "trop@btp-martin.fr" } });
    assert.equal(r.statut, 409);
    assert.match(r.json.message, /2 comptes/);
    r = await s.appel("/compte/modifier", { jeton: A, corps: { email: "collegue@exemple.fr", societe: btp.id } });
    assert.equal(r.statut, 409, "pas de déplacement vers une société pleine");
    await s.appel("/compte/societe/modifier", { jeton: A, corps: { id: btp.id, places: 3 } });
    r = await s.appel("/compte/creer", { jeton: G, corps: { email: "trois@btp-martin.fr" } });
    assert.equal(r.statut, 200);
    r = await s.appel("/compte/supprimer", { jeton: G, corps: { email: "trois@btp-martin.fr" } });
    assert.equal(r.statut, 200);
  });

  await t.test("une utilisatrice simple n'a aucun accès à l'administration", async () => {
    const e = await connecter(s, "employe@btp-martin.fr", employeMdp);
    assert.equal((await s.appel("/compte/liste", { jeton: e.jeton })).statut, 403);
  });

  await t.test("société suspendue : plus de connexion ni de session, puis réactivation", async () => {
    let r = await s.appel("/compte/societe/modifier", { jeton: A, corps: { id: btp.id, actif: false } });
    assert.equal(r.statut, 200);
    assert.equal((await s.appel("/compte/moi", { jeton: G })).statut, 401);
    r = await s.appel("/compte/connexion", { corps: { email: "paul@btp-martin.fr", motdepasse: gerantMdp } });
    assert.equal(r.statut, 403);
    assert.match(r.json.message, /suspendu/);
    assert.equal((await s.appel("/compte/societe/modifier", { jeton: A, corps: { id: farid.compte.societe.id, actif: false } })).statut, 400, "pas sa propre société");
    await s.appel("/compte/societe/modifier", { jeton: A, corps: { id: btp.id, actif: true } });
    assert.equal((await s.appel("/compte/moi", { jeton: G })).statut, 200);
  });

  await t.test("une société ne se supprime que vide", async () => {
    assert.equal((await s.appel("/compte/societe/supprimer", { jeton: A, corps: { id: btp.id } })).statut, 400);
    const r = await s.appel("/compte/societe/creer", { jeton: A, corps: { nom: "Vide" } });
    assert.equal((await s.appel("/compte/societe/supprimer", { jeton: A, corps: { id: r.json.societe.id } })).statut, 200);
  });

  await t.test("l'administrateur Vigie télécharge une sauvegarde complète", async () => {
    const r = await s.appel("/compte/sauvegarde", { jeton: A });
    assert.equal(r.statut, 200);
    assert.match(r.entetes.get("content-disposition"), /vigie-comptes-\d{4}-\d{2}-\d{2}\.json/);
    assert.equal(r.json.v, 2);
    assert.deepEqual(r.json.societes.map(x => x.nom).sort(), ["BTP Martin", "Cauchy"]);
    assert.equal(r.json.comptes.length, 4);
    assert.ok(r.json.comptes.every(c => c.h && c.s));
  });
});

test("base Postgres : rien n'est perdu au redémarrage, copie du jour, et restauration depuis une sauvegarde", { skip: SANS_BASE }, async t => {
  const url = await baseNeuve();
  let s = await demarrerServeur({ DATABASE_URL: url, VIGIE_COMPTES: ANCIENS() });
  let A = (await connecter(s, "farid@exemple.fr", "motdepasse-farid")).jeton;
  const soc = (await s.appel("/compte/societe/creer", { jeton: A, corps: { nom: "Client Un", places: 5 } })).json.societe;
  const mdp = (await s.appel("/compte/creer", { jeton: A, corps: { email: "client@un.fr", role: "gerant", societe: soc.id } })).json.motdepasse;
  await s.appel("/compte/motdepasse", { jeton: A, corps: { ancien: "motdepasse-farid", nouveau: "nouveau-farid-2026" } });
  await new Promise(r => setTimeout(r, 300)); // la copie du jour s'écrit en arrière-plan
  const sauvegarde = (await s.appel("/compte/sauvegarde", { jeton: (await connecter(s, "farid@exemple.fr", "nouveau-farid-2026")).jeton })).json;
  await s.arreter();

  // redémarrage avec une VIGIE_COMPTES vide : tout vient de la base
  s = await demarrerServeur({ DATABASE_URL: url });
  t.after(() => s.arreter());
  await connecter(s, "farid@exemple.fr", "nouveau-farid-2026");
  assert.equal((await s.appel("/compte/connexion", { corps: { email: "farid@exemple.fr", motdepasse: "motdepasse-farid" } })).statut, 401, "l'ancien mot de passe ne marche plus");
  const c = await connecter(s, "client@un.fr", mdp);
  assert.equal(c.compte.societe.nom, "Client Un");
  assert.equal(c.compte.role, "gerant");

  const lignes = await requete(url, "select email, role from vigie_comptes order by email");
  assert.deepEqual(lignes.map(l => l.email), ["client@un.fr", "collegue@exemple.fr", "farid@exemple.fr"]);
  assert.ok(!JSON.stringify(lignes).includes("nouveau-farid-2026"), "aucun mot de passe en clair");
  const copies = await requete(url, "select jour, jsonb_array_length(contenu->'comptes') as n from vigie_sauvegardes");
  assert.equal(copies.length, 1);
  assert.equal(copies[0].n, 3);

  A = (await connecter(s, "farid@exemple.fr", "nouveau-farid-2026")).jeton;
  const liste = await s.appel("/compte/copies", { jeton: A });
  assert.equal(liste.json.copies.length, 1);
  const jour = liste.json.copies[0].jour;
  const copie = await s.appel("/compte/sauvegarde?jour=" + jour, { jeton: A });
  assert.equal(copie.json.comptes.length, 3);

  // restauration : une base vide + la sauvegarde téléchargée dans VIGIE_COMPTES
  const url2 = await baseNeuve();
  const s2 = await demarrerServeur({ DATABASE_URL: url2, VIGIE_COMPTES: JSON.stringify(sauvegarde) });
  t.after(() => s2.arreter());
  const r = await connecter(s2, "client@un.fr", mdp);
  assert.equal(r.compte.societe.nom, "Client Un");
  const socs = await requete(url2, "select nom, places from vigie_societes order by nom");
  assert.deepEqual(socs.map(x => [x.nom, x.places]), [["Client Un", 5], ["Société principale", null]]);
});

test("base injoignable au démarrage : le serveur répond « réessayez », sans déconnecter", async t => {
  const s = await demarrerServeur({ DATABASE_URL: "postgresql://personne@127.0.0.1:1/rien" });
  t.after(s.arreter);
  const r = await s.appel("/dce?origine=https://www.marches-publics.gouv.fr&id=1&org=a", { jeton: "x.y" });
  assert.equal(r.statut, 503);
  assert.equal(r.entetes.get("x-vigie-connexion"), null);
});
