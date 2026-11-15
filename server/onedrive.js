// Vigie Marchés : dépôt du dossier de réponse et du DCE dézippé dans OneDrive (Microsoft Graph),
// avec le jeton de connexion de l'utilisateur. Le jeton n'est envoyé qu'à graph.microsoft.com et n'est jamais conservé.
"use strict";
const { lireZip } = require("./analyse");

const GRAPH = process.env.GRAPH_TEST || "https://graph.microsoft.com/v1.0";
const attendre = ms => new Promise(r => setTimeout(r, ms));

async function graph(token, chemin, opts = {}) {
  for (let essai = 0; ; essai++) {
    const rep = await fetch(GRAPH + chemin, {
      ...opts,
      headers: { Authorization: "Bearer " + token, ...(opts.json ? { "Content-Type": "application/json" } : {}), ...(opts.headers || {}) },
      body: opts.json ? JSON.stringify(opts.json) : opts.body,
      signal: AbortSignal.timeout(120000),
    });
    if ((rep.status === 429 || rep.status === 503 || rep.status === 504) && essai < 4) { await attendre(1000 * Math.min(30, Number(rep.headers.get("retry-after")) || 2 ** essai)); continue; }
    return rep;
  }
}
async function erreurGraph(rep, quoi) {
  let msg = ""; try { const j = await rep.json(); msg = (j.error && (j.error.message || j.error.code)) || ""; } catch (e) {}
  const e = new Error(quoi + " : " + (rep.status === 401 ? "connexion Microsoft expirée, reconnectez-vous" : rep.status === 403 ? "accès refusé à ce dossier OneDrive" : rep.status === 404 ? "dossier OneDrive introuvable" : msg || "erreur " + rep.status));
  e.status = rep.status; return e;
}

// Noms autorisés par OneDrive / SharePoint
const propre = t => (t || "").normalize("NFC").replace(/["*:<>?\/\\|\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().replace(/^[.~ ]+|[. ]+$/g, "").slice(0, 200) || "fichier";
const chemin = p => p.split("/").filter(Boolean).map(x => encodeURIComponent(propre(x))).join("/");

async function creerDossier(token, driveId, parentId, nom) {
  const base = "/drives/" + encodeURIComponent(driveId) + "/items/" + encodeURIComponent(parentId);
  let rep = await graph(token, base + "/children", { method: "POST", json: { name: propre(nom), folder: {}, "@microsoft.graph.conflictBehavior": "fail" } });
  if (rep.status === 409) rep = await graph(token, base + ":/" + chemin(nom));
  if (!rep.ok) throw await erreurGraph(rep, "Création du dossier");
  return rep.json();
}

const MORCEAU = 320 * 1024 * 20; // 6,25 Mio (multiple de 320 Kio exigé par OneDrive)
async function envoyer(token, driveId, dossierId, cheminFichier, donnees) {
  const base = "/drives/" + encodeURIComponent(driveId) + "/items/" + encodeURIComponent(dossierId) + ":/" + chemin(cheminFichier);
  if (donnees.length < 4 * 1024 * 1024) {
    const rep = await graph(token, base + ":/content?@microsoft.graph.conflictBehavior=replace", { method: "PUT", body: donnees, headers: { "Content-Type": "application/octet-stream" } });
    if (!rep.ok) throw await erreurGraph(rep, cheminFichier);
    return;
  }
  const rs = await graph(token, base + ":/createUploadSession", { method: "POST", json: { item: { "@microsoft.graph.conflictBehavior": "replace" } } });
  if (!rs.ok) throw await erreurGraph(rs, cheminFichier);
  const { uploadUrl } = await rs.json();
  for (let i = 0; i < donnees.length; i += MORCEAU) {
    const bout = donnees.subarray(i, Math.min(donnees.length, i + MORCEAU));
    for (let essai = 0; ; essai++) {
      // l'adresse de dépôt est pré-signée : pas de jeton à envoyer
      const rep = await fetch(uploadUrl, { method: "PUT", body: bout, headers: { "Content-Range": `bytes ${i}-${i + bout.length - 1}/${donnees.length}`, "Content-Length": String(bout.length) }, signal: AbortSignal.timeout(180000) }).catch(e => ({ ok: false, status: 0 }));
      if (rep.ok) break;
      if (essai >= 3) throw new Error(cheminFichier + " : envoi interrompu (" + rep.status + ")");
      await attendre(2000 * (essai + 1));
    }
  }
}

/* Dépose le DCE (archive) dézippé dans le dossier OneDrive. Renvoie le nombre de fichiers et les erreurs. */
async function deposerDce(token, driveId, dossierId, nomArchive, buf) {
  const fichiers = [];
  const parcourir = (b, prefixe, profondeur) => {
    let entrees = [];
    try { entrees = lireZip(b); } catch (e) { entrees = []; }
    if (!entrees.length) return false;
    for (const e of entrees) {
      if (/\/$/.test(e.nom)) continue;
      const nom = prefixe + e.nom.replace(/\\/g, "/");
      if (/\.zip$/i.test(e.nom) && profondeur < 2) {
        try { const c = e.lire(); if (parcourir(c, nom.replace(/\.zip$/i, "") + "/", profondeur + 1)) continue; fichiers.push({ nom, lire: () => c }); continue; } catch (err) {}
      }
      fichiers.push({ nom, lire: e.lire });
    }
    return true;
  };
  if (!parcourir(buf, "DCE/", 0)) fichiers.push({ nom: "DCE/" + nomArchive, lire: () => buf });
  const erreurs = [];
  let n = 0, i = 0;
  const travailleur = async () => {
    while (i < fichiers.length) {
      const f = fichiers[i++];
      try { await envoyer(token, driveId, dossierId, f.nom, f.lire()); n++; }
      catch (e) { if (e.status === 401) throw e; erreurs.push(e.message.slice(0, 200)); }
    }
  };
  await Promise.all([1, 2, 3, 4].map(travailleur));
  return { fichiers: n, total: fichiers.length, erreurs };
}

module.exports = { creerDossier, deposerDce, envoyer, propre };
