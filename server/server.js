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
const ENT = { eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", acirc: "â", ccedil: "ç", ocirc: "ô", ucirc: "û", icirc: "î", ugrave: "ù", nbsp: " ", amp: "&", quot: '"', laquo: "«", raquo: "»", rsquo: "'", apos: "'" };
const decode = t => t.replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? " ").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n));
const norm = t => decode(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
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
  // un bloc par consultation : de la dernière occurrence de la consultation précédente
  // jusqu'à la dernière occurrence de celle-ci (titre, référence et date limite s'y trouvent
  // quelle que soit la mise en page de la plateforme)
  const ordre = [], dernier = new Map();
  for (const l of liens) { if (!dernier.has(l.id)) ordre.push(l); dernier.set(l.id, l.pos); }
  const r = ordre.map((l, i) => {
    const debut = i > 0 ? dernier.get(ordre[i - 1].id) : Math.max(0, l.pos - 6000);
    let fin = dernier.get(l.id);
    if (fin === l.pos) fin = Math.min(html.length, l.pos + (i + 1 < ordre.length ? Math.min(3000, ordre[i + 1].pos - l.pos) : 3000));
    return { id: l.id, org: l.org, texte: norm(html.slice(debut, fin).replace(/<[^>]+>/g, " ")) };
  });
  if (TRACE) TRACE.push({ recherche: motCle, statut: rep.status, nb: (html.match(/Nombre de r[ée]sultats[^0-9]{0,40}(\d+)/i) || [])[1], liens: r.slice(0, 40).map(x => x.id + " | " + x.texte.slice(-160)) });
  return r;
}
const MOTS_VIDES = new Set("les des du de la le et pour sur dans avec aux une un en au par lot lots marche marches accord cadre prestations prestation relatif relative relatifs concernant objet".split(" "));
const REF_VIDE = /^(sans objet|neant|n\/?a|nc|non communique|aucune?|-+|\.|0+)$/i;
const MOIS = ["jan", "fe", "mar", "av", "mai", "juin", "juil", "ao", "sep", "oct", "nov", "dec"];
// "2027-01-15" -> motif "15 jan... 2027" tel qu'affiché dans les résultats de recherche
function motifDate(limite) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(limite || "");
  if (!m) return null;
  return new RegExp("(^|\\D)0?" + Number(m[3]) + "\\s*(" + MOIS[Number(m[2]) - 1] + "[a-z.]*|/" + m[2] + "/)\\s*" + m[1]);
}
async function trouverConsultation(origine, ref, objet, limite) {
  if (ref && !REF_VIDE.test(norm(ref))) {
    const r = await chercher(origine, ref);
    const nref = norm(ref);
    const exacts = r.filter(x => new RegExp("(^|[^a-z0-9])" + nref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^a-z0-9]|$)").test(x.texte));
    const ids = [...new Set(exacts.map(x => x.id))];
    if (ids.length === 1) return exacts.find(x => x.id === ids[0]);
    // la recherche par référence ne renvoie qu'une seule consultation : c'est elle
    const tous = [...new Set(r.map(x => x.id))];
    if (tous.length === 1) return r[0];
  }
  if (!objet) return null;
  const mots = [...new Set(norm(objet).split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !MOTS_VIDES.has(w)))].slice(0, 7);
  if (!mots.length) return null;
  const date = motifDate(limite);
  // recherches : tous les mots, puis en retirant un mot à la fois (l'intitulé BOAMP diffère souvent un peu)
  // La recherche PLACE marche mieux avec des mots isolés ou des paires : on en lance plusieurs en parallèle,
  // puis on départage avec la date limite et la proportion de mots de l'intitulé retrouvés.
  const essais = [];
  const ajoute = e => { const k = e.join(" "); if (!essais.some(x => x.join(" ") === k)) essais.push(e); };
  for (let i = 0; i + 1 < mots.length && essais.length < 3; i++) ajoute([mots[i], mots[i + 1]]);
  [...mots].sort((a, b) => b.length - a.length).forEach(w => { if (essais.length < 9) ajoute([w]); });
  ajoute(mots);
  const candidats = new Map();
  const resultats = await Promise.all(essais.map(e => chercher(origine, e.join(" ")).catch(() => [])));
  for (const r of resultats) {
    for (const x of r) {
      const ratio = mots.filter(w => x.texte.includes(w)).length / mots.length;
      const okDate = date ? date.test(x.texte) : false;
      const score = ratio + (okDate ? 1 : 0);
      const prec = candidats.get(x.id);
      if (!prec || prec.score < score) candidats.set(x.id, { ...x, score, ratio, okDate });
    }
  }
  {
    const tri = [...candidats.values()].sort((a, b) => b.score - a.score);
    const meilleur = tri[0], second = tri[1];
    const net = !second || meilleur.score - second.score >= 0.25;
    if (meilleur && net && ((meilleur.okDate && meilleur.ratio >= 0.5) || (!date && meilleur.ratio >= 0.85))) return meilleur;
  }
  const tri = [...candidats.values()].sort((a, b) => b.score - a.score);
  if (TRACE) TRACE.push({ candidats: tri.slice(0, 5).map(x => x.id + " score=" + x.score.toFixed(2) + " date=" + x.okDate) }, { extrait: tri[0] ? tri[0].texte.slice(0, 600) : "" });
  if (tri[0] && tri[0].okDate && tri[0].ratio >= 0.5 && (!tri[1] || tri[1].score < tri[0].score)) return tri[0];
  // une seule consultation trouvée avec la même date limite que l'avis : c'est elle
  const memeDate = tri.filter(x => x.okDate);
  if (memeDate.length === 1) return memeDate[0];
  return null;
}

process.on("uncaughtException", e => console.log("Erreur non gérée", e && e.stack));
process.on("unhandledRejection", e => console.log("Promesse rejetée", e && e.stack));

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
      if (!id && hoteAutorise(h)) { const t = await trouverConsultation(new URL(o).origin, (u.searchParams.get("reference") || "").slice(0, 80), (u.searchParams.get("objet") || "").slice(0, 300), (u.searchParams.get("limite") || "").slice(0, 25)); TRACE.push({ trouve: t && { id: t.id, org: t.org } }); if (t) { id = t.id; org = t.org; } }
      if (!hoteAutorise(h) || !/^\d{1,10}$/.test(id) || !/^[a-z0-9]{1,12}$/i.test(org)) throw new Error("paramètres refusés");
      if (u.searchParams.get("sansdce")) throw new Error("arrêt avant le DCE (sansdce)");
      const r = await telechargerDce(new URL(o).origin, id, org);
      resultat = { ok: true, type: r.headers.get("content-type"), disposition: r.headers.get("content-disposition") };
      try { await r.body.cancel(); } catch (e) {}
    } catch (e) { resultat = { ok: false, erreur: e.message }; }
    const t = TRACE; TRACE = null;
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    if (u.searchParams.get("court")) {
      const l = ["RESULTAT ok=" + resultat.ok + " erreur=" + (resultat.erreur || "-") + " type=" + (resultat.type || "-")];
      for (const x of t) {
        if (x.recherche !== undefined) l.push("RECHERCHE [" + x.recherche + "] statut=" + x.statut + " nb=" + x.nb + " ids=" + [...new Set(x.liens.map(y => y.split(" | ")[0]))].join(","));
        if (x.trouve !== undefined) l.push("TROUVE " + JSON.stringify(x.trouve));
        if (x.candidats) l.push("CANDIDATS " + x.candidats.join(" ; "));
        if (x.extrait) l.push("EXTRAIT " + x.extrait);
        if (x.statut !== undefined && x.methode) l.push(x.methode + " " + x.statut + " " + x.url.slice(0, 140));
      }
      return res.end(l.join("\n"));
    }
    return res.end(JSON.stringify({ resultat, trace: t }, null, 1));
  }
  if (u.pathname !== "/dce") { res.writeHead(404); return res.end("Introuvable"); }

  const origine = u.searchParams.get("origine") || "";
  let id = u.searchParams.get("id") || "";
  let org = u.searchParams.get("org") || "";
  const ref = (u.searchParams.get("reference") || "").slice(0, 80);
  const objet = (u.searchParams.get("objet") || "").slice(0, 300);
  const limite = (u.searchParams.get("limite") || "").slice(0, 25);
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
      const t = await trouverConsultation(base, ref, objet, limite);
      if (t) { id = t.id; org = t.org; console.log(new Date().toISOString(), "TROUVE", hote, ref, "->", id, org); }
    } catch (e) { console.log("recherche", e.message); }
    if (!id) {
      const rech = base + "/?page=Entreprise.EntrepriseAdvancedSearch&AllCons&keyWord=" + encodeURIComponent(ref && !REF_VIDE.test(norm(ref)) ? ref : norm(objet).split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !MOTS_VIDES.has(w)).slice(0, 3).join(" "));
      return pageErreur(res, 404, "La consultation n'a pas été retrouvée de façon certaine sur la plateforme. La recherche ci-dessous la contient sans doute : repérez-la par sa date limite, puis utilisez le bouton de retrait du DCE.", rech, "Voir la recherche sur la plateforme");
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
