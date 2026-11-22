// Serveur Vigie : origine autorisée et session obligatoire.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { demarrerServeur } = require("./aide");

test("sécurité du serveur", async t => {
  const s = await demarrerServeur();
  t.after(s.arreter);

  await t.test("le serveur répond à /sante", async () => {
    const r = await s.appel("/sante");
    assert.equal(r.statut, 200);
  });
  await t.test("une autre origine que le site Vigie est refusée", async () => {
    const r = await s.appel("/dce?origine=https://www.marches-publics.gouv.fr&id=1&org=a", { origine: "https://pirate.exemple" });
    assert.equal(r.statut, 403);
  });
  await t.test("sans session, les services du serveur sont refusés", async () => {
    for (const chemin of ["/dce?origine=https://www.marches-publics.gouv.fr&id=1&org=a", "/fiche?url=https://www.marches-publics.gouv.fr/x"]) {
      const r = await s.appel(chemin);
      assert.equal(r.statut, 401, chemin + " : " + r.texte.slice(0, 200));
    }
    const r = await s.appel("/mail/imap", { corps: { hote: "imap.gmail.com", utilisateur: "a@b.fr", motdepasse: "x" } });
    assert.equal(r.statut, 401);
  });
});
