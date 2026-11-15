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
  const m = balise.match(new RegExp("\\s" + nom + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)')", "i"));
  return m ? (m[2] ?? m[3]).replace(/&amp;/g, "&").replace(/&quot;/g, '"') : null;
}
function champs(html) {
  const r = [];
  for (const m of html.matchAll(/<(input|button)\b[^>]*>/gi)) {
    const b = m[0];
    r.push({ tag: m[1].toLowerCase(), type: (attr(b, "type") || "text").toLowerCase(), name: attr(b, "name"), id: attr(b, "id"), value: attr(b, "value"), checked: /\schecked\b/i.test(b) });
  }
  return r;
}
function donneesDeBase(html) {
  const d = new URLSearchParams();
  for (const c of champs(html)) if (c.type === "hidden" && c.name) d.set(c.name, c.value || "");
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

/* ---------- serveur HTTP ---------- */
const derniers = new Map(); // limitation simple : 20 demandes / 10 min / adresse IP
function tropDeDemandes(ip) {
  const t = Date.now(), l = (derniers.get(ip) || []).filter(x => t - x < 600000);
  l.push(t); derniers.set(ip, l);
  return l.length > 20;
}
function pageErreur(res, code, message, retour) {
  res.writeHead(code, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset="utf-8"><title>DCE indisponible</title>
<body style="font:16px system-ui;max-width:640px;margin:40px auto;padding:0 16px;color:#14203d">
<h1 style="color:#16337a;font-size:22px">Le DCE n'a pas pu être téléchargé automatiquement</h1>
<p>${message.replace(/</g, "&lt;")}</p>
${retour ? `<p><a href="${retour.replace(/"/g, "&quot;")}" style="display:inline-block;background:#16337a;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Ouvrir la page de retrait sur la plateforme</a></p>` : ""}
</body>`);
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/" || u.pathname === "/sante") { res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Vigie Marchés : serveur DCE en service"); }
  if (u.pathname !== "/dce") { res.writeHead(404); return res.end("Introuvable"); }

  const origine = u.searchParams.get("origine") || "";
  const id = u.searchParams.get("id") || "";
  const org = u.searchParams.get("org") || "";
  let hote;
  try { const o = new URL(origine); if (o.protocol !== "https:" && !process.env.HOTE_TEST) throw 0; hote = o.hostname; } catch (e) { return pageErreur(res, 400, "Adresse de plateforme invalide."); }
  const retour = origine + "/index.php?page=Entreprise.EntrepriseDemandeTelechargementDce&id=" + encodeURIComponent(id) + "&orgAcronyme=" + encodeURIComponent(org);
  if (!hoteAutorise(hote)) return pageErreur(res, 400, "Cette plateforme n'est pas prise en charge pour le téléchargement automatique.", retour);
  if (!/^\d{1,10}$/.test(id) || !/^[a-z0-9]{1,12}$/i.test(org)) return pageErreur(res, 400, "Identifiant de consultation invalide.", retour);
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  if (tropDeDemandes(ip)) return pageErreur(res, 429, "Trop de téléchargements en peu de temps. Réessayez dans quelques minutes.", retour);

  try {
    const rep = await telechargerDce(new URL(origine).origin, id, org);
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
    if (!res.headersSent) pageErreur(res, 502, e.message + ". Vous pouvez le récupérer manuellement sur la plateforme (choisir « anonyme »).", retour);
    else res.end();
  }
}).listen(PORT, () => console.log("Serveur DCE sur le port " + PORT));
