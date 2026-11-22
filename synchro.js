/* Vigie Marchés : mêmes réglages et mêmes marchés suivis sur tous les appareils d'un utilisateur.
   Les données de Vigie (marchés suivis, statuts, filtres, dossier OneDrive, réglages des alertes mail…)
   sont copiées dans un fichier du OneDrive de l'utilisateur, dans le dossier d'applications
   « Applications/Vigie Marchés » (/me/drive/special/approot), un fichier par compte Vigie.
   Il suffit de se connecter à Vigie, puis une fois à Microsoft sur chaque appareil.
   Le mot de passe de messagerie n'y est jamais en clair : il est chiffré par le serveur Vigie
   avec une clé propre au compte, et seul ce serveur sait le relire.
   Fusion clé par clé : la modification la plus récente gagne. */
(function () {
  "use strict";
  const CLES = ["vigie.statuts.v1", "vigie.manuels.v1", "vigie.filtres.v1", "vigie.onedrive.v1", "vigie.imap.v1", "vigie.mail.v1",
    "vigie.rappels.v1", "vigie.rectif.v1", "vigie.profil.v1", "vigie.resultats.v1", "vigie.tableau.v1", "vigie.visite.v1"];
  // listes à fusionner élément par élément lors de la toute première synchronisation d'un appareil
  const LISTES = new Set(["vigie.statuts.v1", "vigie.manuels.v1", "vigie.resultats.v1"]);
  const META = "vigie.synchro.v1";
  const GRAPH = "https://graph.microsoft.com/v1.0/me/drive/special/approot:/";
  const ls = window.localStorage;
  const setOrig = Storage.prototype.setItem, removeOrig = Storage.prototype.removeItem;
  let compte = null, meta = null, minuterie = null, enCours = null, derniere = 0, etatTexte = "";

  const lireMeta = () => { try { return JSON.parse(ls.getItem(META) || "null"); } catch (e) { return null; } };
  const sauverMeta = () => { try { setOrig.call(ls, META, JSON.stringify(meta)); } catch (e) {} };
  const fichier = () => "vigie-" + compte.replace(/[^a-z0-9]+/gi, "_") + ".json";

  // chaque modification locale d'une clé suivie est datée, puis envoyée quelques secondes plus tard
  function marquer(cle) {
    if (!meta || !CLES.includes(cle)) return;
    meta.t[cle] = Date.now(); sauverMeta();
    clearTimeout(minuterie); minuterie = setTimeout(() => synchroniser(false), 4000);
  }
  Storage.prototype.setItem = function (k, v) { setOrig.call(this, k, v); if (this === ls) marquer(k); };
  Storage.prototype.removeItem = function (k) { removeOrig.call(this, k); if (this === ls) marquer(k); };

  async function jeton() {
    if (typeof msJeton !== "function" || typeof msConfigure !== "function" || !msConfigure()) return null;
    try { await msInit(); return await msJeton(false); } catch (e) { return null; }
  }
  // mot de passe de la messagerie : jamais envoyé en clair dans le fichier
  async function versDistant(cle, brut) {
    if (cle !== "vigie.imap.v1" || brut == null) return brut;
    let c; try { c = JSON.parse(brut); } catch (e) { return brut; }
    if (c.motdepasse && c.souvenir && !c.motdepasseChiffre) {
      try { c.motdepasseChiffre = await Comptes.chiffrer(c.motdepasse); setOrig.call(ls, cle, JSON.stringify(c)); } catch (e) { return null; } // réessayé à la prochaine synchro
    }
    if (!c.souvenir) delete c.motdepasseChiffre;
    return JSON.stringify({ ...c, motdepasse: "" });
  }
  function versLocal(cle, brut) {
    if (cle !== "vigie.imap.v1" || brut == null) return brut;
    try {
      const d = JSON.parse(brut), l = JSON.parse(ls.getItem(cle) || "null");
      // on garde le mot de passe en clair de cet appareil s'il s'agit de la même boîte et du même mot de passe
      if (l && l.motdepasse && l.utilisateur === d.utilisateur && l.motdepasseChiffre === d.motdepasseChiffre) d.motdepasse = l.motdepasse;
      return JSON.stringify(d);
    } catch (e) { return brut; }
  }
  const fusionListes = (a, b) => { try { return JSON.stringify({ ...JSON.parse(a || "{}"), ...JSON.parse(b || "{}") }); } catch (e) { return b; } };

  async function synchroniser(auDemarrage) {
    if (!compte) return;
    if (enCours) { await enCours.catch(() => {}); if (!auDemarrage) return; }
    enCours = (async () => {
      const j = await jeton();
      if (!j) { etatTexte = "Synchronisation entre appareils : connectez-vous à Microsoft (Mon drive) pour retrouver vos marchés et réglages sur tous vos appareils."; return; }
      const url = GRAPH + encodeURIComponent(fichier()) + ":/content";
      let distant = { cles: {} };
      const r = await fetch(url, { headers: { Authorization: "Bearer " + j }, cache: "no-store" });
      if (r.ok) { try { distant = await r.json(); if (!distant.cles) distant = { cles: {} }; } catch (e) {} }
      else if (r.status !== 404) throw new Error("OneDrive " + r.status);
      const premiere = !meta.compte;
      let recu = 0, aEnvoyer = 0;
      for (const cle of CLES) {
        const d = distant.cles[cle], tl = meta.t[cle] || 0, brut = ls.getItem(cle);
        if (premiere && d && LISTES.has(cle) && brut != null) {
          // premier passage de cet appareil : on additionne les marchés des deux côtés
          const f = fusionListes(d.v, brut);
          if (f !== brut) { setOrig.call(ls, cle, f); recu++; }
          meta.t[cle] = Date.now(); aEnvoyer++;
        } else if (d && d.t > tl) {
          const v = versLocal(cle, d.v);
          if (v == null) removeOrig.call(ls, cle); else if (v !== brut) { setOrig.call(ls, cle, v); recu++; }
          meta.t[cle] = d.t;
        } else if (tl > (d ? d.t : 0) || (!d && brut != null)) {
          if (!meta.t[cle]) meta.t[cle] = 1;
          aEnvoyer++;
        }
      }
      meta.compte = compte; sauverMeta();
      if (aEnvoyer) {
        const cles = { ...distant.cles };
        for (const cle of CLES) {
          const tl = meta.t[cle] || 0;
          if (cles[cle] && cles[cle].t >= tl) continue;
          const v = await versDistant(cle, ls.getItem(cle));
          if (v === null && ls.getItem(cle) != null) continue;
          cles[cle] = { t: tl, v };
        }
        const corps = JSON.stringify({ version: 1, compte, maj: new Date().toISOString(), cles });
        const p = await fetch(url, { method: "PUT", headers: { Authorization: "Bearer " + j, "Content-Type": "application/json" }, body: corps });
        if (!p.ok) throw new Error("OneDrive " + p.status);
      }
      derniere = Date.now();
      etatTexte = "Marchés et réglages synchronisés avec votre OneDrive à " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) + ".";
      // l'appli lit ses données au chargement : on recharge une fois si un autre appareil a changé quelque chose
      if (recu) {
        let dernierRechargement = 0; try { dernierRechargement = +sessionStorage.getItem("vigie.synchro.recharge") || 0; } catch (e) {}
        if (Date.now() - dernierRechargement > 20000) {
          try { sessionStorage.setItem("vigie.synchro.recharge", String(Date.now())); } catch (e) {}
          if (typeof toast === "function") toast("Mise à jour avec vos autres appareils…");
          setTimeout(() => location.reload(), 600);
        }
      }
    })();
    try { await enCours; } catch (e) { console.log("Synchro", e.message); etatTexte = "Synchronisation entre appareils momentanément impossible (" + e.message + ")."; }
    finally { enCours = null; }
  }

  function demarrer(email) {
    compte = String(email || "").toLowerCase(); if (!compte) return;
    meta = lireMeta();
    // autre compte sur ce navigateur : on repart de zéro (le fichier OneDrive du compte fait foi)
    if (!meta || meta.compte !== compte) meta = { compte: null, t: {} };
    synchroniser(true);
    // retour sur l'onglet : on récupère ce qui a été fait sur un autre appareil
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Date.now() - derniere > 30000) synchroniser(false); });
    // connexion Microsoft faite après coup (bouton Mon drive)
    if (typeof majMs === "function") {
      const orig = majMs;
      window.majMs = majMs = function () { const r = orig.apply(this, arguments); if (!derniere && typeof msCompte === "function" && msCompte()) setTimeout(() => synchroniser(false), 500); return r; };
    }
  }
  window.Synchro = { demarrer, maintenant: () => synchroniser(false), etat: () => etatTexte };
})();
