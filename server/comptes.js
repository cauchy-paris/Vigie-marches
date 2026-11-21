// Vigie Marchés : comptes utilisateurs (connexion par adresse mail + mot de passe).
// - Les comptes sont gardés dans la variable d'environnement VIGIE_COMPTES du service Render
//   (mots de passe hachés avec scrypt, jamais en clair). Avec RENDER_API_KEY, chaque changement
//   y est réécrit automatiquement ; sinon l'administrateur reçoit le texte à coller dans Render.
// - Les sessions sont des jetons signés (HMAC, VIGIE_SECRET) : rien à stocker côté serveur.
"use strict";
const crypto = require("crypto");

const SECRET = process.env.VIGIE_SECRET || (console.log("ATTENTION : VIGIE_SECRET absent, les connexions seront perdues au redémarrage"), crypto.randomBytes(32).toString("hex"));
const DUREE_SESSION = 30 * 864e5; // 30 jours
const DUREE_LIEN = 7 * 864e5;     // liens ouverts dans un nouvel onglet (DCE, RC)
const MIN_MDP = 10;

/* ---------- comptes en mémoire ---------- */
// { e: mail, n: nom, r: "admin" | "utilisateur", h: "sel:hachage", v: version (change au changement de mot de passe), t: 1 si mot de passe provisoire, c: date de création }
const comptes = new Map();
try {
  for (const c of JSON.parse(process.env.VIGIE_COMPTES || "[]")) if (c && c.e && c.h) comptes.set(String(c.e).toLowerCase(), c);
} catch (e) { console.log("VIGIE_COMPTES illisible :", e.message); }
console.log(comptes.size + " compte(s) Vigie chargé(s)");

const b64 = b => Buffer.from(b).toString("base64url");
function hacher(mdp, sel = crypto.randomBytes(16).toString("hex")) {
  return sel + ":" + crypto.scryptSync(String(mdp), sel, 32).toString("hex");
}
function verifierMdp(mdp, h) {
  const [sel, attendu] = String(h || "").split(":");
  if (!sel || !attendu) { hacher(mdp, "x"); return false; } // même durée de calcul
  const calcule = crypto.scryptSync(String(mdp), sel, 32);
  const a = Buffer.from(attendu, "hex");
  return a.length === calcule.length && crypto.timingSafeEqual(a, calcule);
}
function egaux(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest(), y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
const mdpProvisoire = () => {
  const alpha = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = ""; for (const o of crypto.randomBytes(12)) s += alpha[o % alpha.length];
  return s.slice(0, 4) + "-" + s.slice(4, 8) + "-" + s.slice(8);
};
const mailValide = e => /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[a-z]{2,24}$/i.test(e);
const publicCompte = c => ({ email: c.e, nom: c.n, role: c.r, provisoire: !!c.t, cree: c.c });

/* ---------- jetons signés ---------- */
function signer(c, type) {
  const p = b64(JSON.stringify({ e: c.e, v: c.v, t: type, x: Date.now() + (type === "l" ? DUREE_LIEN : DUREE_SESSION) }));
  return p + "." + crypto.createHmac("sha256", SECRET).update(p).digest("base64url");
}
function lireJeton(j, type) {
  const [p, s] = String(j || "").split(".");
  if (!p || !s || j.length > 600) return null;
  const attendu = crypto.createHmac("sha256", SECRET).update(p).digest("base64url");
  if (!egaux(s, attendu)) return null;
  let d; try { d = JSON.parse(Buffer.from(p, "base64url").toString("utf8")); } catch (e) { return null; }
  if (d.t !== type || !(d.x > Date.now())) return null;
  const c = comptes.get(d.e);
  return c && c.v === d.v ? c : null;
}
// session dans l'en-tête X-Vigie ; jeton « lien » dans ?acces= (liens ouverts dans un nouvel onglet)
function compteDe(req, u) {
  const h = req.headers["x-vigie"];
  if (h) return lireJeton(h, "s");
  const a = u.searchParams.get("acces");
  return a ? lireJeton(a, "l") : null;
}
const sessionDe = c => ({ jeton: signer(c, "s"), lien: signer(c, "l"), compte: publicCompte(c) });

/* ---------- limite des essais de mot de passe ---------- */
const echecs = new Map(); // clé (ip ou mail) -> [dates]
function bloque(cle) { const t = Date.now(), l = (echecs.get(cle) || []).filter(x => t - x < 900000); echecs.set(cle, l); return l.length >= 8; }
function echec(cle) { const l = echecs.get(cle) || []; l.push(Date.now()); echecs.set(cle, l); }
setInterval(() => { const t = Date.now(); for (const [k, l] of echecs) if (!l.some(x => t - x < 900000)) echecs.delete(k); }, 600000).unref();

/* ---------- sauvegarde dans Render ---------- */
let minuterieDeploiement = null;
async function api(chemin, opts) {
  const r = await fetch("https://api.render.com/v1/services/" + encodeURIComponent(process.env.RENDER_SERVICE_ID) + chemin, {
    ...opts, headers: { Authorization: "Bearer " + process.env.RENDER_API_KEY, "Content-Type": "application/json", Accept: "application/json" }, signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error("Render a répondu " + r.status);
}
async function sauvegarder() {
  const valeur = JSON.stringify([...comptes.values()]);
  if (!process.env.RENDER_API_KEY || !process.env.RENDER_SERVICE_ID) return { auto: false, valeur };
  try {
    await api("/env-vars/VIGIE_COMPTES", { method: "PUT", body: JSON.stringify({ value: valeur }) });
    // la nouvelle valeur ne sert qu'au prochain démarrage : on redéploie (regroupé si plusieurs changements)
    clearTimeout(minuterieDeploiement);
    minuterieDeploiement = setTimeout(() => api("/deploys", { method: "POST", body: "{}" }).then(() => console.log("Comptes : redéploiement demandé")).catch(e => console.log("Comptes : redéploiement impossible", e.message)), 60000);
    return { auto: true };
  } catch (e) {
    console.log("Comptes : sauvegarde Render impossible", e.message);
    return { auto: false, valeur, erreur: e.message };
  }
}

/* ---------- routes /compte/... ---------- */
async function routeCompte(req, res, u, { json, lireCorps, ip }) {
  const chemin = u.pathname.slice("/compte/".length);
  if (chemin === "etat") return json(res, 200, { installe: comptes.size > 0, installable: !!process.env.VIGIE_CODE_INSTALLATION, sauvegardeAuto: !!(process.env.RENDER_API_KEY && process.env.RENDER_SERVICE_ID) });
  if (req.method !== "POST" && chemin !== "moi" && chemin !== "liste") return json(res, 405, { message: "POST attendu" });
  let c = {};
  if (req.method === "POST") { try { c = JSON.parse(await lireCorps(req, 4000) || "{}"); } catch (e) { return json(res, 400, { message: "Demande illisible." }); } }
  const email = String(c.email || "").trim().toLowerCase();

  if (chemin === "installation") {
    if (comptes.size) return json(res, 409, { message: "Vigie est déjà installé : connectez-vous." });
    if (!process.env.VIGIE_CODE_INSTALLATION) return json(res, 503, { message: "Code d'installation absent du serveur (variable VIGIE_CODE_INSTALLATION dans Render)." });
    if (bloque(ip)) return json(res, 429, { message: "Trop d'essais, réessayez dans 15 minutes." });
    if (!egaux(String(c.code || "").trim(), process.env.VIGIE_CODE_INSTALLATION)) { echec(ip); return json(res, 403, { message: "Code d'installation incorrect." }); }
    if (!mailValide(email)) return json(res, 400, { message: "Adresse mail invalide." });
    if (String(c.motdepasse || "").length < MIN_MDP) return json(res, 400, { message: "Le mot de passe doit faire au moins " + MIN_MDP + " caractères." });
    const compte = { e: email, n: String(c.nom || "").trim().slice(0, 80) || email, r: "admin", h: hacher(c.motdepasse), v: 1, c: new Date().toISOString().slice(0, 10) };
    comptes.set(email, compte);
    console.log(new Date().toISOString(), "Comptes : installation par", email);
    return json(res, 200, { ...sessionDe(compte), sauvegarde: await sauvegarder() });
  }

  if (chemin === "connexion") {
    if (bloque(ip) || bloque(email)) return json(res, 429, { message: "Trop d'essais, réessayez dans 15 minutes." });
    const compte = comptes.get(email);
    if (!verifierMdp(c.motdepasse || "", compte ? compte.h : "")) { echec(ip); echec(email); return json(res, 401, { message: "Adresse mail ou mot de passe incorrect." }); }
    console.log(new Date().toISOString(), "Comptes : connexion", email);
    return json(res, 200, sessionDe(compte));
  }

  // toutes les autres routes demandent d'être connecté
  const moi = lireJeton(req.headers["x-vigie"], "s");
  if (!moi) { res.setHeader("X-Vigie-Connexion", "1"); return json(res, 401, { erreur: "compte", message: "Session expirée : reconnectez-vous." }); }

  if (chemin === "moi") return json(res, 200, { lien: signer(moi, "l"), compte: publicCompte(moi) });

  if (chemin === "motdepasse") {
    if (bloque("mdp:" + moi.e)) return json(res, 429, { message: "Trop d'essais, réessayez dans 15 minutes." });
    if (!verifierMdp(c.ancien || "", moi.h)) { echec("mdp:" + moi.e); return json(res, 403, { message: "Mot de passe actuel incorrect." }); }
    const nouveau = String(c.nouveau || "");
    if (nouveau.length < MIN_MDP) return json(res, 400, { message: "Le mot de passe doit faire au moins " + MIN_MDP + " caractères." });
    if (nouveau === c.ancien) return json(res, 400, { message: "Choisissez un mot de passe différent de l'actuel." });
    moi.h = hacher(nouveau); moi.v++; delete moi.t;
    return json(res, 200, { ...sessionDe(moi), sauvegarde: await sauvegarder() });
  }

  // administration (rôle admin)
  if (moi.r !== "admin") return json(res, 403, { message: "Réservé à l'administrateur." });
  if (chemin === "liste") return json(res, 200, { comptes: [...comptes.values()].map(publicCompte), sauvegardeAuto: !!(process.env.RENDER_API_KEY && process.env.RENDER_SERVICE_ID) });
  if (chemin === "creer") {
    if (!mailValide(email)) return json(res, 400, { message: "Adresse mail invalide." });
    if (comptes.has(email)) return json(res, 409, { message: "Un compte existe déjà pour cette adresse." });
    if (comptes.size >= 200) return json(res, 400, { message: "Nombre maximal de comptes atteint." });
    const mdp = mdpProvisoire();
    comptes.set(email, { e: email, n: String(c.nom || "").trim().slice(0, 80) || email, r: c.role === "admin" ? "admin" : "utilisateur", h: hacher(mdp), v: 1, t: 1, c: new Date().toISOString().slice(0, 10) });
    console.log(new Date().toISOString(), "Comptes : création de", email, "par", moi.e);
    return json(res, 200, { motdepasse: mdp, sauvegarde: await sauvegarder() });
  }
  const cible = comptes.get(email);
  if (!cible) return json(res, 404, { message: "Compte introuvable." });
  if (chemin === "reinitialiser") {
    const mdp = mdpProvisoire();
    cible.h = hacher(mdp); cible.v++; cible.t = 1;
    console.log(new Date().toISOString(), "Comptes : nouveau mot de passe pour", email, "par", moi.e);
    return json(res, 200, { motdepasse: mdp, sauvegarde: await sauvegarder() });
  }
  if (chemin === "supprimer") {
    if (cible === moi) return json(res, 400, { message: "Vous ne pouvez pas supprimer votre propre compte." });
    comptes.delete(email);
    console.log(new Date().toISOString(), "Comptes : suppression de", email, "par", moi.e);
    return json(res, 200, { ok: true, sauvegarde: await sauvegarder() });
  }
  return json(res, 404, { message: "Introuvable" });
}

module.exports = { routeCompte, compteDe };
