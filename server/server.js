// Vigie Marchés : petit serveur qui récupère le DCE des plateformes Atexo
// (PLACE, Maximilien, plateformes régionales) en suivant le parcours
// « téléchargement anonyme », puis renvoie le fichier au navigateur.
"use strict";
const http = require("http");

const PORT = process.env.PORT || 10000;
const UA = "Mozilla/5.0 (compatible; VigieMarches/1.0; veille marches publics)";

// Seules ces plateformes sont autorisées (évite que le serveur serve de relais vers n'importe quel site).
const HOTES = [
  /(^|\.)marches-publics\.gouv\.fr$/,
  /(^|\.)maximilien\.fr$/,
  /(^|\.)e-megalisbretagne\.org$/,
  /(^|\.)alsacemarchespublics\.eu$/,
  /(^|\.)marchespublics\.grandest\.fr$/,
  /(^|\.)marchespublics\.auvergnerhonealpes\.eu$/,
  /(^|\.)marches-publics\.hautsdefrance\.fr$/,
  /(^|\.)marchespublics\.nouvelle-aquitaine\.fr$/,
  /(^|\.)marches\.ampmetropole\.fr$/,
  /(^|\.)ternum-bfc\.fr$/,
  /(^|\.)marches\.paysdelaloire\.fr$/,
  /(^|\.)atexo\.com$/,
  /(^|\.)local-trust\.com$/,
];
const hoteAutorise = h => HOTES.some(re => re.test(h)) || (process.env.HOTE_TEST && h === process.env.HOTE_TEST);

/* ---------- petit pot à cookies ---------- */
function majCookies(jar, rep) {
  const liste = typeof rep.headers.getSetCookie === "function" ? rep.headers.getSetCookie() : [];
  for (const c of liste) {
    const [paire] = c.split(";");
    const i = paire.indexOf("=");
    if (i > 0) jar.set(paire.slice(0, i).trim(), paire.slice(i + 1).trim());
  }
}
const enTete = jar => [...jar].map(([k, v]) => k + "=" + v).join("; ");

let TRACE = null;
async function requete(url, jar, opts = {}) {
  let cible = url;
  for (let i = 0; i < 6; i++) {
    const rep = await fetch(cible, {
      ...opts,
      redirect: "manual",
      headers: { "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9", Cookie: enTete(jar), Referer: url, ...(opts.headers || {}) },
      signal: AbortSignal.timeout(120000),
    });
    majCookies(jar, rep);
    if (TRACE) TRACE.push({ methode: opts.method || "GET", url: cible, statut: rep.status, location: rep.headers.get("location"), type: rep.headers.get("content-type"), cookies: [...jar.keys()] });
    if (rep.status >= 300 && rep.status < 400 && rep.headers.get("location")) {
      cible = new URL(rep.headers.get("location"), cible).toString();
      opts = { method: "GET" };
      continue;
    }
    return { rep, url: cible };
  }
  throw new Error("Trop de redirections");
}

/* ---------- lecture du formulaire PRADO ---------- */
function attr(balise, nom) {
  const m = balise.match(new RegExp("\\s" + nom + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s>\"']+))", "i"));
  return m ? (m[2] ?? m[3] ?? m[4]).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'") : null;
}
function champs(html) {
  const r = [];
  for (const m of html.matchAll(/<(input|button)\b[^>]*>/gi)) {
    const b = m[0];
    r.push({ tag: m[1].toLowerCase(), type: (attr(b, "type") || "text").toLowerCase(), name: attr(b, "name"), id: attr(b, "id"), value: attr(b, "value"), checked: /\schecked\b/i.test(b) });
  }
  return r;
}
// Reproduit ce qu'envoie un navigateur : champs cachés et texte, cases cochées.
function donneesDeBase(html) {
  const d = new URLSearchParams();
  for (const c of champs(html)) {
    if (!c.name || c.tag !== "input") continue;
    if (/^(submit|button|image|file|reset)$/.test(c.type)) continue;
    if (/^(radio|checkbox)$/.test(c.type)) { if (c.checked) d.set(c.name, c.value || "on"); continue; }
    if (/^form\[/.test(c.name) || c.name === "keyWord") continue; // formulaires de connexion et de recherche du bandeau
    d.set(c.name, c.value || "");
  }
  if (!d.has("PRADO_POSTBACK_PARAMETER")) d.set("PRADO_POSTBACK_PARAMETER", "");
  return d;
}
const trouve = (cs, re) => cs.find(c => re.test(c.name || "") || re.test(c.id || ""));
const versNom = s => (s || "").replace(/_/g, "$");

async function telechargerDce(origine, id, org) {
  const jar = new Map();
  const urlDemande = origine + "/index.php?page=Entreprise.EntrepriseDemandeTelechargementDce&id=" + encodeURIComponent(id) + "&orgAcronyme=" + encodeURIComponent(org);

  // 1. page de demande
  let { rep, url } = await requete(urlDemande, jar);
  let html = await rep.text();
  if (TRACE) TRACE.push({ etape: 1, titre: (html.match(/<title>([^<]*)/i) || [])[1], champs: champs(html).filter(c => c.type !== "hidden" || /PRADO/.test(c.name || "")).map(c => [c.type, c.name, c.id, (c.value || "").slice(0, 80)]).slice(0, 60) });
  if (!/PRADO_PAGESTATE/.test(html)) throw new Error("Page de retrait du DCE introuvable");

  // 2. choix « anonyme » + acceptation des conditions, puis validation
  let cs = champs(html);
  let d = donneesDeBase(html);
  const radio = cs.find(c => c.type === "radio" && /choixAnonyme/i.test((c.value || "") + (c.id || "")));
  if (radio) d.set(radio.name, radio.value || versNom(radio.id));
  else d.set("ctl0$CONTENU_PAGE$EntrepriseFormulaireDemande$RadioGroup", "ctl0$CONTENU_PAGE$EntrepriseFormulaireDemande$choixAnonyme");
  for (const c of cs) if (c.type === "checkbox" && c.name && /accept|condition|cgu/i.test((c.name || "") + (c.id || ""))) d.set(c.name, c.value || "on");
  const valider = trouve(cs, /validateButton/i);
  d.set("PRADO_POSTBACK_TARGET", valider ? (valider.name || versNom(valider.id)) : "ctl0$CONTENU_PAGE$validateButton");
  ({ rep, url } = await requete(url, jar, { method: "POST", body: d, headers: { "Content-Type": "application/x-www-form-urlencoded" } }));
  html = await rep.text();
  if (TRACE) TRACE.push({ etape: 2, envoye: [...d.keys()].filter(k => !/PAGESTATE/.test(k)).map(k => [k, d.get(k).slice(0, 80)]), titre: (html.match(/<title>([^<]*)/i) || [])[1], erreurs: (html.match(/class="[^"]*(erreur|error|alert)[^"]*"[^>]*>[\s\S]{0,300}/gi) || []).slice(0, 5).map(x => x.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 200)), liens: [...html.matchAll(/(?:id|href)="([^"]*(?:ownload|Dce|DCE)[^"]*)"/g)].map(m => m[1]).slice(0, 20) });
  if (!/PRADO_PAGESTATE/.test(html)) throw new Error("Étape « anonyme » refusée par la plateforme");

  // 3. demande du DCE complet
  cs = champs(html);
  d = donneesDeBase(html);
  const complet = trouve(cs, /completeDownload/i);
  if (!complet && !/completeDownload/i.test(html)) throw new Error("Lien de téléchargement du DCE absent (le DCE est peut-être réservé aux comptes)");
  d.set("PRADO_POSTBACK_TARGET", complet ? (complet.name || versNom(complet.id)) : "ctl0$CONTENU_PAGE$EntrepriseDownloadDce$completeDownload");
  ({ rep } = await requete(url, jar, { method: "POST", body: d, headers: { "Content-Type": "application/x-www-form-urlencoded" } }));
  const type = rep.headers.get("content-type") || "";
  if (/text\/html/i.test(type)) throw new Error("La plateforme a renvoyé une page au lieu du fichier");
  return rep;
}

/* ---------- retrouver une consultation par sa référence ---------- */
const norm = t => (t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
async function chercher(origine, motCle) {
  const jar = new Map();
  const url = origine + "/?page=Entreprise.EntrepriseAdvancedSearch&AllCons&keyWord=" + encodeURIComponent(motCle);
  const { rep } = await requete(url, jar);
  const html = await rep.text();
  const liens = [];
  const re = /(?:app\.php\/)?entreprise\/consultation\/(\d+)\?orgAcronyme=([a-z0-9]+)/gi;
  let m;
  while ((m = re.exec(html))) liens.push({ id: m[1], org: m[2], pos: m.index });
  // texte autour de chaque lien, pour retrouver la référence et l'intitulé
  const r = liens.map((l, i) => {
    const debut = i > 0 ? liens[i - 1].pos : Math.max(0, l.pos - 6000);
    return { id: l.id, org: l.org, texte: norm(html.slice(debut, l.pos).replace(/<[^>]+>/g, " ")) };
  });
  if (TRACE) TRACE.push({ recherche: motCle, statut: rep.status, nb: (html.match(/Nombre de r[ée]sultats[^0-9]{0,40}(\d+)/i) || [])[1], liens: r.slice(0, 8).map(x => x.id + " | " + x.texte.slice(-160)) });
  return r;
}
async function trouverConsultation(origine, ref, objet) {
  const vus = new Map();
  if (ref) {
    const r = await chercher(origine, ref);
    const nref = norm(ref);
    const exacts = r.filter(x => new RegExp("(^|[^a-z0-9])" + nref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^a-z0-9]|$)").test(x.texte));
    const ids = [...new Set(exacts.map(x => x.id))];
    if (ids.length === 1) return exacts.find(x => x.id === ids[0]);
    r.forEach(x => vus.set(x.id, x));
    const tous = [...new Set(r.map(x => x.id))];
    if (!exacts.length && tous.length === 1) return r[0];
  }
  if (objet) {
    const mots = norm(objet).split(/[^a-z0-9]+/).filter(w => w.length > 3).slice(0, 8);
    if (mots.length >= 2) {
      const r = await chercher(origine, mots.join(" "));
      // garder les consultations dont l'intitulé contient presque tous les mots
      const bons = r.filter(x => mots.filter(w => x.texte.includes(w)).length >= Math.ceil(mots.length * 0.8));
      const ids = [...new Set(bons.map(x => x.id))];
      if (ids.length === 1) return bons.find(x => x.id === ids[0]);
    }
  }
  return null;
}

/* ---------- serveur HTTP ---------- */
const derniers = new Map(); // limitation simple : 20 demandes / 10 min / adresse IP
function tropDeDemandes(ip) {
  const t = Date.now(), l = (derniers.get(ip) || []).filter(x => t - x < 600000);
  l.push(t); derniers.set(ip, l);
  return l.length > 20;
}
function pageErreur(res, code, message, retour, libelle) {
  res.writeHead(code, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset="utf-8"><title>DCE indisponible</title>
<body style="font:16px system-ui;max-width:640px;margin:40px auto;padding:0 16px;color:#14203d">
<h1 style="color:#16337a;font-size:22px">Le DCE n'a pas pu être téléchargé automatiquement</h1>
<p>${message.replace(/</g, "&lt;")}</p>
${retour ? `<p><a href="${retour.replace(/"/g, "&quot;")}" style="display:inline-block;background:#16337a;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">${libelle || "Ouvrir la page de retrait sur la plateforme"}</a></p>` : ""}
</body>`);
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/" || u.pathname === "/sante") { res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Vigie Marchés : serveur DCE en service"); }
  if (u.pathname === "/diagnostic") {
    TRACE = [];
    const o = u.searchParams.get("origine") || "";
    let id = u.searchParams.get("id") || "", org = u.searchParams.get("org") || "";
    let resultat;
    try {
      const h = new URL(o).hostname;
      if (!id && hoteAutorise(h)) { const t = await trouverConsultation(new URL(o).origin, (u.searchParams.get("ref") || "").slice(0, 80), (u.searchParams.get("objet") || "").slice(0, 300)); TRACE.push({ trouve: t && { id: t.id, org: t.org } }); if (t) { id = t.id; org = t.org; } }
      if (!hoteAutorise(h) || !/^\d{1,10}$/.test(id) || !/^[a-z0-9]{1,12}$/i.test(org)) throw new Error("paramètres refusés");
      const r = await telechargerDce(new URL(o).origin, id, org);
      resultat = { ok: true, type: r.headers.get("content-type"), disposition: r.headers.get("content-disposition") };
      try { await r.body.cancel(); } catch (e) {}
    } catch (e) { resultat = { ok: false, erreur: e.message }; }
    const t = TRACE; TRACE = null;
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end(JSON.stringify({ resultat, trace: t }, null, 1));
  }
  if (u.pathname !== "/dce") { res.writeHead(404); return res.end("Introuvable"); }

  const origine = u.searchParams.get("origine") || "";
  let id = u.searchParams.get("id") || "";
  let org = u.searchParams.get("org") || "";
  const ref = (u.searchParams.get("ref") || "").slice(0, 80);
  const objet = (u.searchParams.get("objet") || "").slice(0, 300);
  const quoi = u.searchParams.get("quoi") || "dce"; // dce | rc | consultation
  let hote;
  try { const o = new URL(origine); if (o.protocol !== "https:" && !process.env.HOTE_TEST) throw 0; hote = o.hostname; } catch (e) { return pageErreur(res, 400, "Adresse de plateforme invalide."); }
  const retour = origine + "/index.php?page=Entreprise.EntrepriseDemandeTelechargementDce&id=" + encodeURIComponent(id) + "&orgAcronyme=" + encodeURIComponent(org);
  if (!hoteAutorise(hote)) return pageErreur(res, 400, "Cette plateforme n'est pas prise en charge pour le téléchargement automatique.", retour);
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  if (tropDeDemandes(ip)) return pageErreur(res, 429, "Trop de téléchargements en peu de temps. Réessayez dans quelques minutes.", retour);
  const base = new URL(origine).origin;
  if (!id && (ref || objet)) {
    try {
      const t = await trouverConsultation(base, ref, objet);
      if (t) { id = t.id; org = t.org; console.log(new Date().toISOString(), "TROUVE", hote, ref, "->", id, org); }
    } catch (e) { console.log("recherche", e.message); }
    if (!id) {
      const rech = base + "/?page=Entreprise.EntrepriseAdvancedSearch&AllCons&keyWord=" + encodeURIComponent(ref || objet);
      return pageErreur(res, 404, "La consultation n'a pas été retrouvée automatiquement sur la plateforme" + (ref ? " (référence " + ref + ")" : "") + ".", rech, "Voir la recherche sur la plateforme");
    }
  }
  if (!/^\d{1,10}$/.test(id) || !/^[a-z0-9]{1,12}$/i.test(org)) return pageErreur(res, 400, "Identifiant de consultation invalide.", retour);
  const page = base + "/index.php?page=Entreprise.";
  if (quoi === "rc") { res.writeHead(302, { Location: page + "EntrepriseDownloadReglement&id=" + encodeURIComponent(Buffer.from(id).toString("base64")) + "&orgAcronyme=" + org }); return res.end(); }
  if (quoi === "consultation") { res.writeHead(302, { Location: base + "/entreprise/consultation/" + id + "?orgAcronyme=" + org }); return res.end(); }

  try {
    const rep = await telechargerDce(base, id, org);
    const cd = rep.headers.get("content-disposition") || `attachment; filename="DCE_${id}.zip"`;
    res.writeHead(200, {
      "Content-Type": rep.headers.get("content-type") || "application/zip",
      "Content-Disposition": /attachment/i.test(cd) ? cd : `attachment; filename="DCE_${id}.zip"`,
      ...(rep.headers.get("content-length") ? { "Content-Length": rep.headers.get("content-length") } : {}),
      "Cache-Control": "no-store",
    });
    const lecteur = rep.body.getReader();
    for (;;) { const { done, value } = await lecteur.read(); if (done) break; if (!res.write(value)) await new Promise(r => res.once("drain", r)); }
    res.end();
    console.log(new Date().toISOString(), "DCE OK", hote, id, org);
  } catch (e) {
    console.log(new Date().toISOString(), "DCE ECHEC", hote, id, org, e.message);
    if (!res.headersSent) pageErreur(res, 502, e.message + ". Vous pouvez le récupérer manuellement sur la plateforme (choisir « anonyme »).", page + "EntrepriseDemandeTelechargementDce&id=" + id + "&orgAcronyme=" + org);
    else res.end();
  }
}).listen(PORT, () => console.log("Serveur DCE sur le port " + PORT));
