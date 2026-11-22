// Retrait du DCE sur une plateforme Atexo (PLACE, Maximilien…) quand l'identifiant de l'avis BOAMP
// mène à « Aucune consultation trouvée » : le serveur retrouve la consultation par sa référence et retente.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { demarrerServeur } = require("./aide");

// Fausse plateforme Atexo : la consultation 111 n'existe plus, la 222 (référence REF-42) est en ligne.
function plateforme() {
  const vus = [];
  const srv = http.createServer((q, r) => {
    let corps = "";
    q.on("data", c => { corps += c; });
    q.on("end", () => {
      const u = new URL(q.url, "http://x");
      vus.push(q.method + " " + u.search);
      const page = h => { r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end("<html><body>" + h + "</body></html>"); };
      const prado = '<input type="hidden" name="PRADO_PAGESTATE" value="etat">';
      if (u.searchParams.get("page") === "Entreprise.EntrepriseAdvancedSearch") {
        if (/REF-42/.test(u.searchParams.get("keyWord") || "")) return page('<div>REF-42 | Dispositifs médicaux consommables <a href="/entreprise/consultation/222?orgAcronyme=abc">Accéder à la consultation</a></div>');
        return page("Aucun résultat");
      }
      if (u.searchParams.get("page") === "Entreprise.EntrepriseDemandeTelechargementDce") {
        const id = u.searchParams.get("id");
        if (q.method === "GET" && id !== "222") return page(prado + "<p>Aucune consultation trouvée</p>");
        if (q.method === "GET") return page(prado + '<input type="radio" id="ctl0_CONTENU_PAGE_EntrepriseFormulaireDemande_choixAnonyme" name="ctl0$CONTENU_PAGE$EntrepriseFormulaireDemande$RadioGroup" value="ctl0$CONTENU_PAGE$EntrepriseFormulaireDemande$choixAnonyme"><input type="checkbox" id="ctl0_CONTENU_PAGE_EntrepriseFormulaireDemande_accepterConditions" name="ctl0$CONTENU_PAGE$EntrepriseFormulaireDemande$accepterConditions"><input type="submit" id="ctl0_CONTENU_PAGE_validateButton" name="ctl0$CONTENU_PAGE$validateButton" value="Valider">');
        if (/completeDownload/.test(corps)) { r.writeHead(200, { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="DCE_222.zip"' }); return r.end("PK-DCE-222"); }
        return page(prado + '<input type="submit" id="ctl0_CONTENU_PAGE_EntrepriseDownloadDce_completeDownload" name="ctl0$CONTENU_PAGE$EntrepriseDownloadDce$completeDownload" value="Télécharger">');
      }
      r.writeHead(404); r.end();
    });
  });
  return new Promise(ok => srv.listen(0, "127.0.0.1", () => ok({ origine: "http://127.0.0.1:" + srv.address().port, vus, fermer: () => new Promise(f => srv.close(f)) })));
}

test("DCE Atexo : repli par la référence quand l'identifiant ne donne rien", async t => {
  const pf = await plateforme();
  const s = await demarrerServeur({ HOTE_TEST: "127.0.0.1" });
  t.after(async () => { await s.arreter(); await pf.fermer(); });
  const inst = await s.appel("/compte/installation", { corps: { code: "code-test", nom: "Chef", email: "chef@exemple.fr", motdepasse: "motdepasse-solide" } });
  assert.equal(inst.statut, 200, inst.texte);
  const jeton = inst.json.jeton;
  const o = encodeURIComponent(pf.origine);

  await t.test("identifiant valable : DCE téléchargé directement", async () => {
    const r = await s.appel("/dce?origine=" + o + "&id=222&org=abc", { jeton });
    assert.equal(r.statut, 200, r.texte.slice(0, 300));
    assert.equal(r.texte, "PK-DCE-222");
  });

  await t.test("« Aucune consultation trouvée » : la consultation est retrouvée par sa référence", async () => {
    const r = await s.appel("/dce?origine=" + o + "&id=111&org=abc&reference=REF-42&objet=" + encodeURIComponent("Dispositifs médicaux consommables") + "&limite=2027-01-08", { jeton });
    assert.equal(r.statut, 200, r.texte.slice(0, 300));
    assert.equal(r.texte, "PK-DCE-222");
    assert.ok(pf.vus.some(v => /keyWord=REF-42/.test(v)), "recherche par référence faite");
  });

  await t.test("sans référence ni intitulé : message clair, pas « réservé aux comptes »", async () => {
    const r = await s.appel("/dce?origine=" + o + "&id=111&org=abc", { jeton });
    assert.equal(r.statut, 502);
    assert.match(r.json.message, /Aucune consultation trouvée/);
    assert.doesNotMatch(r.json.message, /réservé aux comptes/);
  });
});
