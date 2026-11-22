// Vigie Marchés : comptes utilisateurs (connexion par adresse mail + mot de passe).
// - Les comptes sont gardés dans la variable d'environnement VIGIE_COMPTES du service Render
//   (mots de passe hachés avec scrypt, jamais en clair). Avec RENDER_API_KEY, chaque changement
//   y est réécrit automatiquement ; sinon l'administrateur reçoit le texte à coller dans Render.
// - Les sessions sont des jetons signés (HMAC, VIGIE_SECRET) : rien à stocker côté serveur.
"use strict";
const crypto = require("crypto");
const { envoyerMail, mailConfigure } = require("./envoi");
const SITE = "https://vigie-marches.onrender.com";
const DUREE_REINIT = 3600e3; // lien « mot de passe oublié » : 1 heure, une seule utilisation

const SECRET = process.env.VIGIE_SECRET || (console.log("ATTENTION : VIGIE_SECRET absent, les connexions seront perdues au redémarrage"), crypto.randomBytes(32).toString("hex"));
const DUREE_SESSION = 30 * 864e5; // 30 jours
const DUREE_LIEN = 7 * 864e5;     // liens ouverts dans un nouvel onglet (DCE, RC)
const MIN_MDP = 10;

/* ---------- comptes et sociétés en mémoire (copie de la base, relue au démarrage) ---------- */
// compte : { e: mail, n: nom, r: "admin" (administrateur Vigie) | "gerant" (administrateur de sa société) | "utilisateur",
//            s: id de la société, h: "sel:hachage", v: version (change au changement de mot de passe), t: 1 si mot de passe provisoire, c: date de création }
// société : { id, nom, places: nombre maximal de comptes (null = sans limite), actif: false = accès suspendu, c: date de création }
const comptes = new Map();
const societes = new Map();
const ROLES = new Set(["admin", "gerant", "utilisateur"]);
let stock = null;
const nouvelId = () => "soc_" + crypto.randomBytes(6).toString("hex");
const aujourdhui = () => new Date().toISOString().slice(0, 10);
// remet en ordre ce qui est lu : rôles connus, chaque compte rattaché à une société existante
// (les comptes d'avant les sociétés vont tous dans une « Société principale » à renommer)
function preparer({ societes: ls, comptes: lc }) {
  const socs = ls.map(x => ({ id: String(x.id), nom: String(x.nom), places: x.places == null ? null : Number(x.places), actif: x.actif !== false, c: x.c || aujourdhui() }));
  const ids = new Set(socs.map(x => x.id));
  let principale = null;
  const cpts = lc.map(c0 => {
    const c = { ...c0, e: String(c0.e).toLowerCase(), n: String(c0.n || c0.e), r: ROLES.has(c0.r) ? c0.r : "utilisateur", v: Number(c0.v) || 1 };
    if (!c.s || !ids.has(c.s)) {
      if (!principale) { principale = { id: nouvelId(), nom: "Société principale", places: null, actif: true, c: aujourdhui() }; socs.push(principale); ids.add(principale.id); }
      c.s = principale.id;
    }
    return c;
  });
  return { societes: socs, comptes: cpts };
}
const pret = (async () => {
  for (let essai = 1; ; essai++) {
    try {
      stock = await require("./stockage").ouvrir(preparer);
      for (const x of stock.societes) societes.set(x.id, x);
      for (const c of stock.comptes) comptes.set(c.e, c);
      console.log("Comptes (" + (stock.mode === "base" ? "base Postgres" : "variable VIGIE_COMPTES") + ") : " + comptes.size + " compte(s), " + societes.size + " société(s)");
      return;
    } catch (e) {
      console.log("Base de comptes injoignable (essai " + essai + ") :", e.message);
      await new Promise(r => setTimeout(r, Math.min(30000, 2000 * essai)));
    }
  }
})();
let charge = false; pret.then(() => { charge = true; });
const comptesPrets = () => charge;

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
const publicSociete = x => x && ({ id: x.id, nom: x.nom, places: x.places, actif: x.actif, cree: x.c });
const publicCompte = c => { const x = societes.get(c.s); return { email: c.e, nom: c.n, role: c.r, provisoire: !!c.t, cree: c.c, societe: x ? { id: x.id, nom: x.nom } : null }; };
// accès suspendu quand la société est désactivée (abonnement arrêté) ; jamais pour un administrateur Vigie
const accesOuvert = c => c.r === "admin" || !!(societes.get(c.s) || {}).actif;

/* ---------- jetons signés ---------- */
function signer(c, type) {
  const p = b64(JSON.stringify({ e: c.e, v: c.v, t: type, x: Date.now() + (type === "l" ? DUREE_LIEN : type === "r" ? DUREE_REINIT : DUREE_SESSION) }));
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
  return c && c.v === d.v && accesOuvert(c) ? c : null;
}
// session dans l'en-tête X-Vigie ; jeton « lien » dans ?acces= (liens ouverts dans un nouvel onglet)
function compteDe(req, u) {
  const h = req.headers["x-vigie"];
  if (h) return lireJeton(h, "s");
  const a = u.searchParams.get("acces");
  return a ? lireJeton(a, "l") : null;
}
// chiffrement des secrets d'un utilisateur (mot de passe de messagerie) : AES-256-GCM, clé propre à chaque compte
const cleDe = email => crypto.createHmac("sha256", SECRET).update("secret-utilisateur:" + email).digest();
function chiffrer(texte, email) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", cleDe(email), iv);
  const ct = Buffer.concat([c.update(String(texte), "utf8"), c.final()]);
  return "v1." + b64(iv) + "." + b64(c.getAuthTag()) + "." + b64(ct);
}
function dechiffrer(chiffre, email) {
  const [v, iv, tag, ct] = String(chiffre || "").split(".");
  if (v !== "v1" || !iv || !tag || !ct) return null;
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", cleDe(email), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
  } catch (e) { return null; }
}
const sessionDe = c => ({ jeton: signer(c, "s"), lien: signer(c, "l"), compte: publicCompte(c) });

/* ---------- limite des essais de mot de passe ---------- */
const echecs = new Map(); // clé (ip ou mail) -> [dates]
function bloque(cle) { const t = Date.now(), l = (echecs.get(cle) || []).filter(x => t - x < 900000); echecs.set(cle, l); return l.length >= 8; }
function echec(cle) { const l = echecs.get(cle) || []; l.push(Date.now()); echecs.set(cle, l); }
setInterval(() => { const t = Date.now(); for (const [k, l] of echecs) if (!l.some(x => t - x < 900000)) echecs.delete(k); }, 600000).unref();


/* ---------- enregistrement ---------- */
// base Postgres : chaque changement y est écrit AVANT d'être pris en compte (rien n'est perdu au redémarrage)
// sans base : fonctionnement d'origine, l'ensemble est réécrit dans la variable VIGIE_COMPTES de Render
const enBase = () => stock && stock.mode === "base";
const toutLeContenu = () => ({ v: 2, exporte: new Date().toISOString(), societes: [...societes.values()], comptes: [...comptes.values()] });
async function base(f) {
  try { return await f(); } catch (e) { console.log("Base de comptes : écriture impossible", e.message); const x = new Error("La base des comptes ne répond pas : rien n'a été changé. Réessayez dans une minute."); x.code = "BASE"; throw x; }
}
function apresChangement() {
  if (enBase()) stock.copieDuJour(toutLeContenu()).catch(e => console.log("Base de comptes : copie du jour impossible", e.message));
}
async function enregistrerCompte(c) { await base(() => stock.ecrireCompte(c)); comptes.set(c.e, c); apresChangement(); }
async function retirerCompte(c) { await base(() => stock.supprimerCompte(c.e)); comptes.delete(c.e); apresChangement(); }
async function enregistrerSociete(x) { await base(() => stock.ecrireSociete(x)); societes.set(x.id, x); apresChangement(); }
async function retirerSociete(x) { await base(() => stock.supprimerSociete(x.id)); societes.delete(x.id); apresChangement(); }

let minuterieDeploiement = null;
async function api(chemin, opts) {
  const r = await fetch("https://api.render.com/v1/services/" + encodeURIComponent(process.env.RENDER_SERVICE_ID) + chemin, {
    ...opts, headers: { Authorization: "Bearer " + process.env.RENDER_API_KEY, "Content-Type": "application/json", Accept: "application/json" }, signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error("Render a répondu " + r.status);
}
const sauvegardeAutomatique = () => enBase() || !!(process.env.RENDER_API_KEY && process.env.RENDER_SERVICE_ID);
async function sauvegarder() {
  if (enBase()) return { auto: true, base: true };
  const valeur = JSON.stringify({ v: 2, societes: [...societes.values()], comptes: [...comptes.values()] });
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

// le texte à coller dans Render (empreintes de tous les mots de passe) n'est montré qu'à un administrateur Vigie
const pourQui = (sv, c) => (sv.auto || c.r === "admin" ? sv : { auto: false, admin: true });

/* ---------- droits ---------- */
// administrateur Vigie : tout ; administrateur de société (gérant) : les comptes de sa société, sauf les administrateurs Vigie
const gere = (moi, cible) => moi.r === "admin" || (moi.r === "gerant" && cible.s === moi.s && cible.r !== "admin");
const rolesPermis = moi => (moi.r === "admin" ? ["admin", "gerant", "utilisateur"] : ["gerant", "utilisateur"]);
const membres = id => [...comptes.values()].filter(c => c.s === id);
const placesPrises = x => x.places != null && membres(x.id).length >= x.places;
const MAX_COMPTES = () => (enBase() ? 10000 : 200);
function lireSociete(c) {
  const nom = String(c.nom || "").trim().slice(0, 80);
  const places = c.places === "" || c.places == null ? null : Number(c.places);
  if (places !== null && !(Number.isInteger(places) && places >= 1 && places <= 1000)) return { erreur: "Nombre de comptes invalide (de 1 à 1000, ou vide pour sans limite)." };
  return { nom, places };
}
const nomPris = (nom, sauf) => [...societes.values()].some(x => x.id !== sauf && x.nom.toLowerCase() === nom.toLowerCase());

/* ---------- routes /compte/... ---------- */
async function routeCompte(req, res, u, outils) {
  const { json } = outils;
  if (!charge) {
    const attente = await Promise.race([pret.then(() => true), new Promise(r => setTimeout(() => r(false), 8000))]);
    if (!attente) return json(res, 503, { message: "Le serveur démarre ou la base des comptes ne répond pas : réessayez dans une minute." });
  }
  try { return await routes(req, res, u, outils); }
  catch (e) { if (e.code === "BASE") return json(res, 503, { message: e.message }); throw e; }
}

async function routes(req, res, u, { json, lireCorps, ip }) {
  const chemin = u.pathname.slice("/compte/".length);
  if (chemin === "etat") return json(res, 200, { installe: comptes.size > 0, installable: !!process.env.VIGIE_CODE_INSTALLATION, oubli: mailConfigure(), sauvegardeAuto: sauvegardeAutomatique(), base: enBase() });
  if (req.method !== "POST" && !["moi", "liste", "sauvegarde", "copies"].includes(chemin)) return json(res, 405, { message: "POST attendu" });
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
    const soc = { id: nouvelId(), nom: String(c.societe || "").trim().slice(0, 80) || "Ma société", places: null, actif: true, c: aujourdhui() };
    await enregistrerSociete(soc);
    const compte = { e: email, n: String(c.nom || "").trim().slice(0, 80) || email, r: "admin", s: soc.id, h: hacher(c.motdepasse), v: 1, c: aujourdhui() };
    await enregistrerCompte(compte);
    console.log(new Date().toISOString(), "Comptes : installation par", email);
    return json(res, 200, { ...sessionDe(compte), sauvegarde: await sauvegarder() });
  }

  if (chemin === "connexion") {
    if (bloque(ip) || bloque(email)) return json(res, 429, { message: "Trop d'essais, réessayez dans 15 minutes." });
    const compte = comptes.get(email);
    if (!verifierMdp(c.motdepasse || "", compte ? compte.h : "")) { echec(ip); echec(email); return json(res, 401, { message: "Adresse mail ou mot de passe incorrect." }); }
    if (!accesOuvert(compte)) return json(res, 403, { message: "L'accès de votre société à Vigie est suspendu. Contactez l'administrateur de Vigie." });
    console.log(new Date().toISOString(), "Comptes : connexion", email);
    return json(res, 200, sessionDe(compte));
  }

  // mot de passe oublié : lien envoyé par mail si l'adresse a un compte (même réponse dans tous les cas)
  if (chemin === "oubli") {
    if (!mailConfigure()) return json(res, 503, { message: "L'envoi de mail n'est pas encore configuré : demandez à l'administrateur de Vigie un nouveau mot de passe." });
    if (!mailValide(email)) return json(res, 400, { message: "Adresse mail invalide." });
    if (bloque("oubli:" + ip) || bloque("oubli:" + email)) return json(res, 429, { message: "Trop de demandes, réessayez dans 15 minutes." });
    echec("oubli:" + ip); echec("oubli:" + email);
    const compte = comptes.get(email);
    if (compte && accesOuvert(compte)) {
      const lien = SITE + "/#reinit=" + signer(compte, "r");
      const nom = compte.n && compte.n !== compte.e ? " " + compte.n : "";
      envoyerMail({
        a: compte.e, sujet: "Vigie Marchés : créer un nouveau mot de passe",
        texte: `Bonjour${nom},\n\nPour choisir un nouveau mot de passe Vigie Marchés, ouvrez ce lien (valable 1 heure, une seule fois) :\n${lien}\n\nSi vous n'avez rien demandé, ignorez ce mail : votre mot de passe actuel reste valable.`,
        html: `<div style="font:15px/1.5 Arial,sans-serif;color:#14203d;max-width:560px"><div style="background:#16337a;color:#fff;padding:14px 18px;border-bottom:4px solid #d22d39;font-weight:bold;font-size:18px">Vigie Marchés</div><div style="padding:18px"><p>Bonjour${nom.replace(/</g, "&lt;")},</p><p>Pour choisir un nouveau mot de passe, cliquez sur le bouton ci-dessous. Le lien est valable 1 heure et ne sert qu'une fois.</p><p><a href="${lien}" style="display:inline-block;background:#16337a;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Créer mon nouveau mot de passe</a></p><p style="color:#5b6785;font-size:13px">Si vous n'avez rien demandé, ignorez ce mail : votre mot de passe actuel reste valable.</p></div></div>`,
      }).then(() => console.log(new Date().toISOString(), "Comptes : lien de réinitialisation envoyé à", email))
        .catch(e => console.log("Comptes : envoi du lien impossible", email, e.message));
    } else console.log(new Date().toISOString(), "Comptes : mot de passe oublié pour une adresse inconnue ou suspendue");
    return json(res, 200, { message: "Si cette adresse a un compte Vigie, un mail vient de lui être envoyé avec un lien pour créer un nouveau mot de passe (pensez aux courriers indésirables)." });
  }
  if (chemin === "reinitialisation") {
    if (bloque(ip)) return json(res, 429, { message: "Trop d'essais, réessayez dans 15 minutes." });
    const compte = lireJeton(String(c.jeton || ""), "r");
    if (!compte) { echec(ip); return json(res, 400, { message: "Ce lien a expiré ou a déjà servi : redemandez-en un depuis « Mot de passe oublié »." }); }
    const nouveau = String(c.nouveau || "");
    if (nouveau.length < MIN_MDP) return json(res, 400, { message: "Le mot de passe doit faire au moins " + MIN_MDP + " caractères." });
    const n = { ...compte, h: hacher(nouveau), v: compte.v + 1 }; delete n.t; // v + 1 : le lien ne resservira pas
    await enregistrerCompte(n);
    console.log(new Date().toISOString(), "Comptes : mot de passe réinitialisé par lien", n.e);
    return json(res, 200, { ...sessionDe(n), sauvegarde: pourQui(await sauvegarder(), n) });
  }

  // toutes les autres routes demandent d'être connecté
  const moi = lireJeton(req.headers["x-vigie"], "s");
  if (!moi) { res.setHeader("X-Vigie-Connexion", "1"); return json(res, 401, { erreur: "compte", message: "Session expirée : reconnectez-vous." }); }

  if (chemin === "moi") return json(res, 200, { lien: signer(moi, "l"), compte: publicCompte(moi) });

  if (chemin === "chiffrer") {
    const texte = String(c.texte || "");
    if (!texte || texte.length > 300) return json(res, 400, { message: "Texte à chiffrer invalide." });
    return json(res, 200, { chiffre: chiffrer(texte, moi.e) });
  }

  if (chemin === "motdepasse") {
    if (bloque("mdp:" + moi.e)) return json(res, 429, { message: "Trop d'essais, réessayez dans 15 minutes." });
    if (!verifierMdp(c.ancien || "", moi.h)) { echec("mdp:" + moi.e); return json(res, 403, { message: "Mot de passe actuel incorrect." }); }
    const nouveau = String(c.nouveau || "");
    if (nouveau.length < MIN_MDP) return json(res, 400, { message: "Le mot de passe doit faire au moins " + MIN_MDP + " caractères." });
    if (nouveau === c.ancien) return json(res, 400, { message: "Choisissez un mot de passe différent de l'actuel." });
    const n = { ...moi, h: hacher(nouveau), v: moi.v + 1 }; delete n.t;
    await enregistrerCompte(n);
    return json(res, 200, { ...sessionDe(n), sauvegarde: pourQui(await sauvegarder(), n) });
  }

  // ----- administration : administrateur Vigie (toutes les sociétés) ou administrateur de sa société -----
  if (moi.r !== "admin" && moi.r !== "gerant") return json(res, 403, { message: "Réservé à l'administrateur." });
  const admin = moi.r === "admin";

  if (chemin === "liste") {
    const visibles = [...comptes.values()].filter(x => gere(moi, x) || x === moi).sort((a, b) => a.e.localeCompare(b.e));
    const socs = (admin ? [...societes.values()] : [societes.get(moi.s)]).filter(Boolean).sort((a, b) => a.nom.localeCompare(b.nom, "fr"))
      .map(x => ({ ...publicSociete(x), comptes: membres(x.id).length }));
    return json(res, 200, { comptes: visibles.map(publicCompte), societes: socs, moi: { role: moi.r, societe: moi.s }, roles: rolesPermis(moi), sauvegardeAuto: sauvegardeAutomatique(), base: enBase() });
  }

  if (chemin === "creer") {
    if (!mailValide(email)) return json(res, 400, { message: "Adresse mail invalide." });
    if (comptes.has(email)) return json(res, 409, { message: "Un compte existe déjà pour cette adresse." });
    if (comptes.size >= MAX_COMPTES()) return json(res, 400, { message: "Nombre maximal de comptes atteint." });
    const role = rolesPermis(moi).includes(c.role) ? c.role : "utilisateur";
    const soc = societes.get(admin ? String(c.societe || moi.s) : moi.s);
    if (!soc) return json(res, 400, { message: "Société introuvable." });
    if (placesPrises(soc)) return json(res, 409, { message: "Les " + soc.places + " comptes prévus pour « " + soc.nom + " » sont tous utilisés." + (admin ? " Augmentez le nombre de comptes de la société." : " Demandez-en davantage à l'administrateur de Vigie.") });
    const mdp = mdpProvisoire();
    await enregistrerCompte({ e: email, n: String(c.nom || "").trim().slice(0, 80) || email, r: role, s: soc.id, h: hacher(mdp), v: 1, t: 1, c: aujourdhui() });
    console.log(new Date().toISOString(), "Comptes : création de", email, "(" + role + ", " + soc.nom + ") par", moi.e);
    return json(res, 200, { motdepasse: mdp, sauvegarde: await sauvegarder() });
  }

  // ----- sociétés : administrateur Vigie seulement -----
  if (chemin.startsWith("societe/") || chemin === "sauvegarde" || chemin === "copies") {
    if (!admin) return json(res, 403, { message: "Réservé à l'administrateur de Vigie." });
    if (chemin === "sauvegarde") {
      const j = String(u.searchParams.get("jour") || "");
      const contenu = /^\d{4}-\d{2}-\d{2}$/.test(j) ? await base(() => stock.copie(j)) : toutLeContenu();
      if (!contenu) return json(res, 404, { message: "Pas de copie pour ce jour." });
      res.setHeader("Content-Disposition", 'attachment; filename="vigie-comptes-' + (j || aujourdhui()) + '.json"');
      console.log(new Date().toISOString(), "Comptes : sauvegarde téléchargée par", moi.e);
      return json(res, 200, contenu);
    }
    if (chemin === "copies") return json(res, 200, { copies: await base(() => stock.copies()) });
    if (chemin === "societe/creer") {
      const l = lireSociete(c);
      if (l.erreur) return json(res, 400, { message: l.erreur });
      if (!l.nom) return json(res, 400, { message: "Nom de la société manquant." });
      if (nomPris(l.nom)) return json(res, 409, { message: "Une société porte déjà ce nom." });
      const x = { id: nouvelId(), nom: l.nom, places: l.places, actif: true, c: aujourdhui() };
      await enregistrerSociete(x);
      console.log(new Date().toISOString(), "Comptes : société créée", x.nom, "par", moi.e);
      return json(res, 200, { societe: publicSociete(x), sauvegarde: await sauvegarder() });
    }
    const x = societes.get(String(c.id || ""));
    if (!x) return json(res, 404, { message: "Société introuvable." });
    if (chemin === "societe/modifier") {
      const n = { ...x };
      if ("nom" in c) { const nom = String(c.nom || "").trim().slice(0, 80); if (!nom) return json(res, 400, { message: "Nom de la société manquant." }); if (nomPris(nom, x.id)) return json(res, 409, { message: "Une société porte déjà ce nom." }); n.nom = nom; }
      if ("places" in c) { const l = lireSociete(c); if (l.erreur) return json(res, 400, { message: l.erreur }); n.places = l.places; }
      if ("actif" in c) {
        n.actif = !!c.actif;
        if (!n.actif && x.id === moi.s) return json(res, 400, { message: "Vous ne pouvez pas suspendre votre propre société." });
      }
      await enregistrerSociete(n);
      console.log(new Date().toISOString(), "Comptes : société modifiée", n.nom, n.actif ? "" : "(suspendue)", "par", moi.e);
      return json(res, 200, { societe: publicSociete(n), sauvegarde: await sauvegarder() });
    }
    if (chemin === "societe/supprimer") {
      if (membres(x.id).length) return json(res, 400, { message: "Supprimez ou déplacez d'abord les comptes de cette société." });
      await retirerSociete(x);
      console.log(new Date().toISOString(), "Comptes : société supprimée", x.nom, "par", moi.e);
      return json(res, 200, { ok: true, sauvegarde: await sauvegarder() });
    }
    return json(res, 404, { message: "Introuvable" });
  }

  const cible = comptes.get(email);
  if (!cible || !gere(moi, cible)) return json(res, 404, { message: "Compte introuvable." });
  if (chemin === "modifier") {
    const n = { ...cible };
    if ("nom" in c) n.n = String(c.nom || "").trim().slice(0, 80) || cible.e;
    if ("role" in c && c.role !== cible.r) {
      if (cible === moi) return json(res, 400, { message: "Vous ne pouvez pas changer votre propre rôle." });
      if (!rolesPermis(moi).includes(c.role)) return json(res, 403, { message: "Rôle non autorisé." });
      n.r = c.role;
    }
    if ("societe" in c && c.societe !== cible.s) {
      if (!admin) return json(res, 403, { message: "Seul l'administrateur de Vigie peut changer un compte de société." });
      const soc = societes.get(String(c.societe));
      if (!soc) return json(res, 400, { message: "Société introuvable." });
      if (placesPrises(soc)) return json(res, 409, { message: "Les " + soc.places + " comptes prévus pour « " + soc.nom + " » sont tous utilisés." });
      n.s = soc.id;
    }
    await enregistrerCompte(n);
    console.log(new Date().toISOString(), "Comptes : modification de", email, "par", moi.e);
    return json(res, 200, { compte: publicCompte(n), sauvegarde: await sauvegarder() });
  }
  if (chemin === "reinitialiser") {
    const mdp = mdpProvisoire();
    await enregistrerCompte({ ...cible, h: hacher(mdp), v: cible.v + 1, t: 1 });
    console.log(new Date().toISOString(), "Comptes : nouveau mot de passe pour", email, "par", moi.e);
    return json(res, 200, { motdepasse: mdp, sauvegarde: await sauvegarder() });
  }
  if (chemin === "supprimer") {
    if (cible === moi) return json(res, 400, { message: "Vous ne pouvez pas supprimer votre propre compte." });
    await retirerCompte(cible);
    console.log(new Date().toISOString(), "Comptes : suppression de", email, "par", moi.e);
    return json(res, 200, { ok: true, sauvegarde: await sauvegarder() });
  }
  return json(res, 404, { message: "Introuvable" });
}

// pour le travail d'équipe (server/equipe.js)
const membresSociete = id => membres(id).map(c => ({ email: c.e, nom: c.n, role: c.r }));
const baseDeDonnees = () => (enBase() ? stock.pool : null);
const nomDe = email => { const c = comptes.get(email); return c ? c.n : email; };

module.exports = { routeCompte, compteDe, dechiffrer, comptesPrets, pret, preparer, membresSociete, baseDeDonnees, nomDe };
