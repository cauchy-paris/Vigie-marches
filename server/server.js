// Vigie Marchés : petit serveur qui récupère le DCE des plateformes Atexo
// (PLACE, Maximilien, plateformes régionales) en suivant le parcours
// « téléchargement anonyme », puis renvoie le fichier au navigateur.
"use strict";
const http = require("http");
const { extraire, extraireTous, analyser } = require("./analyse");
const { textePdf, analyserTexte } = require("./regles");
const onedrive = require("./onedrive");
const { extraireFiche } = require("./fiche");
const { lireAlertes } = require("./mail");
const { routeCompte, compteDe, dechiffrer } = require("./comptes");
const dns = require("dns").promises;
const net = require("net");

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

/* ---------- CAPTCHA ----------
   Certaines plateformes demandent de recopier un code (CAPTCHA image) avant le retrait du DCE.
   Le serveur récupère l'image avec la même session (cookies), la renvoie à Vigie qui l'affiche,
   l'utilisateur tape le code, et le serveur reprend le parcours là où il s'était arrêté.
   Les CAPTCHA « Je ne suis pas un robot » (reCAPTCHA, hCaptcha, Turnstile) ne peuvent pas être relayés :
   on renvoie alors le lien de la page de retrait pour que l'utilisateur le fasse sur la plateforme. */
const RE_ROBOT = /g-recaptcha|recaptcha\/api|grecaptcha|h-captcha|hcaptcha\.com|cf-turnstile|challenges\.cloudflare\.com|frc-captcha|friendlycaptcha/i;
function captchaImage(html, base) {
  const cs = champs(html);
  const champ = cs.find(c => c.tag === "input" && c.name && /^(text|tel|number)$/.test(c.type) && /captcha|securimage|code_?secu|codesecurite|code_?verif|codeverification|antispam/i.test(c.name + " " + (c.id || "")));
  if (!champ) return null;
  let src = null;
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const s = attr(m[0], "src") || "";
    if (/captcha|securimage|codesecurite|antispam/i.test(s + " " + (attr(m[0], "id") || "") + " " + (attr(m[0], "class") || "") + " " + (attr(m[0], "alt") || ""))) { src = s; break; }
  }
  if (!src) return null;
  return { champ: champ.name, src: /^data:/i.test(src) ? src : new URL(src, base).toString() };
}
const captchas = new Map(); // jeton -> { etat, base, id, org, expire }
function nettoyerCaptchas() { const t = Date.now(); for (const [k, v] of captchas) if (v.expire < t) captchas.delete(k); }
async function erreurCaptcha(etat, cap, base, id, org, incorrect) {
  let image = cap.src;
  if (!/^data:/i.test(image)) {
    const { rep } = await requete(cap.src, etat.jar, { headers: { Referer: etat.url } });
    if (!rep.ok) throw new Error("Image du CAPTCHA indisponible (" + rep.status + ")");
    const type = (rep.headers.get("content-type") || "image/png").split(";")[0];
    image = "data:" + (/^image\//.test(type) ? type : "image/png") + ";base64," + Buffer.from(await rep.arrayBuffer()).toString("base64");
  }
  nettoyerCaptchas();
  if (captchas.size > 200) captchas.delete(captchas.keys().next().value);
  const jeton = require("crypto").randomBytes(18).toString("base64url");
  captchas.set(jeton, { etat: { ...etat, captcha: cap.champ }, base, id, org, expire: Date.now() + 10 * 60000 });
  const e = new Error(incorrect ? "Code CAPTCHA incorrect" : "La plateforme demande un code CAPTCHA");
  e.captcha = { jeton, image, incorrect: !!incorrect };
  return e;
}
function erreurRobot() {
  const e = new Error("La plateforme demande de cocher « Je ne suis pas un robot » : cette vérification se fait uniquement sur la plateforme");
  e.robot = true; return e;
}


/* ---------- AWS-Achat, e-marchespublics : retrait anonyme avec code image ----------
   Ces plateformes donnent le DCE sans compte, mais demandent de recopier un code (image).
   Le serveur suit le parcours anonyme comme un navigateur, renvoie l'image à Vigie, puis reprend
   avec le code tapé par l'utilisateur jusqu'au fichier. Les pages après le code ne sont pas connues
   à l'avance : chaque étape est choisie d'après la page (lien « anonyme », formulaire à code,
   lien de téléchargement, formulaire de lots à valider). Trace détaillée via /diagnostic?url=… */
const HOTES_CODE = [/(^|\.)marches-publics\.info$/, /(^|\.)e-marchespublics\.com$/];
const hoteCode = h => HOTES_CODE.some(re => re.test(h)) || (process.env.HOTE_TEST && h === process.env.HOTE_TEST);
function formulaires(html, base) {
  const r = [];
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const ouv = "<form" + m[1] + ">";
    let action = attr(ouv, "action") || base;
    try { action = new URL(action, base).toString(); } catch (e) { continue; }
    r.push({ action, methode: (attr(ouv, "method") || "get").toLowerCase(), html: m[2] });
  }
  return r;
}
function liens(html, base) {
  const r = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr("<a" + m[1] + ">", "href");
    if (!href || /^(javascript:|mailto:|#)/i.test(href)) continue;
    let url; try { url = new URL(href, base).toString(); } catch (e) { continue; }
    r.push({ url, texte: decode(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() });
  }
  return r;
}
const RE_CONNEXION = /password|mot_?de_?passe|motdepasse|login|identifiant|pwd/i;
function donneesFormulaire(f, toutCocher) {
  const d = new URLSearchParams();
  for (const c of champs(f.html)) {
    if (!c.name || c.tag !== "input") continue;
    if (/^(submit|button|image|file|reset)$/.test(c.type)) continue;
    if (c.type === "checkbox") { if (c.checked || toutCocher) d.append(c.name, c.value || "on"); continue; }
    if (c.type === "radio") { if (c.checked && !d.has(c.name)) d.set(c.name, c.value || "on"); if (/complet|tous|tout|global|ensemble|integral/i.test((c.value || "") + " " + (c.id || ""))) d.set(c.name, c.value || "on"); continue; }
    d.append(c.name, c.value || "");
  }
  for (const m of f.html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const nom = attr("<select" + m[1] + ">", "name"); if (!nom) continue;
    const opts = [...m[2].matchAll(/<option\b([^>]*)>/gi)].map(o => ({ v: attr("<option" + o[1] + ">", "value") || "", sel: /\sselected\b/i.test(o[1]) }));
    const o = opts.find(x => x.sel) || opts[0]; if (o) d.set(nom, o.v);
  }
  // bouton de validation nommé (certains serveurs s'en servent pour savoir quelle action est demandée)
  const b = champs(f.html).find(c => c.name && /^(submit|image)$/.test(c.type) && /retrait|t[ée]l[ée]charg|valider|continuer|suivant|anonyme|ok/i.test((c.value || "") + c.name));
  if (b) d.set(b.name, b.value || "");
  return d;
}
const texteDe = h => decode(h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
// Note d'un lien ou d'un formulaire : plus elle est haute, plus il mène au DCE complet
function noteDce(url, texte) {
  const t = (texte || "").slice(0, 300), u = url || "";
  let n = 0;
  if (/retir\w*\s+(le\s+)?(dce|dossier)|t[ée]l[ée]charg\w*\s+(le\s+|du\s+)?(dce|dossier)|dossier (complet|de consultation)|dce complet|tout t[ée]l[ée]charger|l.ensemble des (pi[eè]ces|documents)|retrait (anonyme|du dce)|acc[ée]d\w*\s+(au\s+)?(dce|dossier)/i.test(t)) n += 6;
  if (/type=DCE|dematEnt\.login|fuseaction=dce\.|telechargerDCE|DemandeTelechargementDce|dossier_de_consultation/i.test(u)) n += 4;
  if (/\.(zip|rar|7z)(\?|$)/i.test(u)) n += 3;
  if (/\b(dce|zip)\b/i.test(t)) n += 1;
  if (/r[eè]glement|\brc\b|avis|cctp|ccap|bpu|dpgf|cahier|annexe/i.test(t) && !/dce|dossier complet|tout/i.test(t)) n -= 8;
  if (/\.(pdf|docx?|xlsx?|odt|ods)(\?|$)/i.test(u)) n -= 8;
  if (/demat\.termes|inscri|login\.cfm|connexion|motdepasse|password|reglement|DownloadReglement|cgu|mentions/i.test(u) && !/dematEnt\.login/i.test(u)) n -= 10;
  return n;
}
async function telechargerParCode(depart, reprise) {
  let jar, url, html, code = null, vus;
  if (reprise) {
    const r = captchas.get(String(reprise.jeton || ""));
    if (!r || r.expire < Date.now()) throw new Error("Le code a expiré, relancez le téléchargement");
    captchas.delete(String(reprise.jeton));
    ({ jar, url, html, vus } = r.etat); depart = r.base;
    code = String(reprise.code || "").trim().slice(0, 40);
  } else {
    jar = new Map(); vus = [];
    const aws = depart.match(/^https:\/\/www\.marches-publics\.info\/Annonces\/[A-Z]*_?(\d{5,9})\.htm/i);
    if (aws) depart = "https://www.marches-publics.info/mpiaws/index.cfm?fuseaction=dematEnt.login&type=DCE&IDM=" + aws[1];
    const r0 = await requete(depart, jar);
    if (!/text\/html/i.test(r0.rep.headers.get("content-type") || "")) { r0.rep.consultation = { base: depart, id: "", org: "" }; return r0.rep; }
    url = r0.url; html = await r0.rep.text();
  }
  let codeEnvoye = false;
  for (let etape = 0; etape < 10; etape++) {
    vus.push(url);
    if (TRACE) TRACE.push({ etape: "code-" + etape, url, titre: (html.match(/<title>([^<]*)/i) || [])[1], formulaires: formulaires(html, url).map(f => [f.methode, f.action.slice(0, 120), champs(f.html).map(c => c.type + ":" + (c.name || c.id)).join(",").slice(0, 300)]), liens: liens(html, url).filter(l => /dce|anonym|t[ée]l[ée]charg|zip|retrait|dossier/i.test(l.url + " " + l.texte)).map(l => l.texte.slice(0, 40) + " | " + l.url.slice(0, 140)).slice(0, 15), extrait: html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 600) });
    if (RE_ROBOT.test(html) && !captchaImage(html, url)) throw erreurRobot();
    const fs = formulaires(html, url), ls = liens(html, url);
    let suivant = null; // { url, methode, corps }
    // 1. lien vers le retrait anonyme
    const anonyme = ls.find(l => !vus.includes(l.url) && (/anonym/i.test(l.url) || /mode anonyme|de mani[eè]re anonyme|retrait anonyme/i.test(l.texte)) && !/inscri|connexion|login/i.test(l.url));
    // 2. formulaire avec code image (hors formulaire de connexion)
    const fCode = fs.find(f => captchaImage(f.html, url) && !champs(f.html).some(c => c.type === "password"));
    if (anonyme && !(fCode && /anonym/i.test(fCode.action + " " + champs(fCode.html).map(c => c.value || "").join(" ")))) suivant = { url: anonyme.url };
    else if (fCode) {
      const cap = captchaImage(fCode.html, url) || captchaImage(html, url);
      if (code === null) throw await erreurCaptcha({ type: "code", jar, url, html, vus }, cap, depart, "", "", codeEnvoye);
      const d = donneesFormulaire(fCode, false); d.set(cap.champ, code);
      suivant = { url: fCode.action, methode: fCode.methode, corps: d };
      code = null; codeEnvoye = true;
    } else {
      // Toujours le DCE complet : le bouton / lien « Retirer le DCE », « Télécharger le dossier complet »…
      // jamais une pièce isolée (RC, avis, CCTP…).
      const fSuite = fs.filter(f => !champs(f.html).some(c => c.type === "password" || RE_CONNEXION.test(c.name || "")) && !/recherche|search|keyword/i.test(f.action + " " + champs(f.html).map(c => c.name).join(" ")) && champs(f.html).some(c => /^(submit|image)$/.test(c.type) || c.tag === "button"))
        .map(f => ({ f, note: noteDce(f.action, [...f.html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)].map(b => texteDe(b[1])).concat(champs(f.html).filter(c => /^(submit|image|button)$/.test(c.type)).map(c => c.value || "")).join(" ")) }))
        .filter(x => x.note > -5).sort((a, b) => b.note - a.note)[0];
      const lien = ls.filter(l => !vus.includes(l.url)).map(l => ({ l, note: noteDce(l.url, l.texte) })).filter(x => x.note > 0).sort((a, b) => b.note - a.note)[0];
      if (lien && (!fSuite || lien.note >= fSuite.note)) suivant = { url: lien.l.url };
      else if (fSuite) suivant = { url: fSuite.f.action, methode: fSuite.f.methode, corps: donneesFormulaire(fSuite.f, true) };
    }
    if (!suivant) throw new Error(codeEnvoye ? "Code accepté, mais lien de téléchargement du DCE non trouvé sur la page suivante" : "Page de retrait anonyme non reconnue");
    let r;
    if (suivant.methode === "post") r = await requete(suivant.url, jar, { method: "POST", body: suivant.corps, headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: url } });
    else { let cible = suivant.url; if (suivant.corps) { const x = new URL(cible); for (const [k, v] of suivant.corps) x.searchParams.append(k, v); cible = x.toString(); } r = await requete(cible, jar, { headers: { Referer: url } }); }
    const type = r.rep.headers.get("content-type") || "", cd = r.rep.headers.get("content-disposition") || "";
    if (!/text\/html/i.test(type) || /attachment/i.test(cd)) { r.rep.consultation = { base: depart, id: "", org: "" }; return r.rep; }
    url = r.url; html = await r.rep.text();
    // code refusé : la plateforme réaffiche un formulaire à code
    if (codeEnvoye && formulaires(html, url).some(f => captchaImage(f.html, url) && !champs(f.html).some(c => c.type === "password")) && /incorrect|invalide|erron|ne correspond|mauvais/i.test(html)) {
      const f = formulaires(html, url).find(x => captchaImage(x.html, url));
      throw await erreurCaptcha({ type: "code", jar, url, html, vus }, captchaImage(f.html, url), depart, "", "", true);
    }
  }
  throw new Error("Parcours de retrait trop long");
}

// Parcours de retrait du DCE. `reprise` = { jeton, code } quand l'utilisateur vient de taper le CAPTCHA.
async function telechargerDce(origine, id, org, reprise) {
  let etat, code = null;
  if (reprise) {
    const r = captchas.get(String(reprise.jeton || ""));
    if (r && r.etat && r.etat.type === "code") return telechargerParCode(null, reprise);
    if (!r || r.expire < Date.now()) throw new Error("Le code CAPTCHA a expiré, relancez le téléchargement");
    captchas.delete(String(reprise.jeton));
    ({ etat } = r); origine = r.base; id = r.id; org = r.org;
    code = String(reprise.code || "").trim().slice(0, 40);
  } else {
    const jar = new Map();
    const urlDemande = origine + "/index.php?page=Entreprise.EntrepriseDemandeTelechargementDce&id=" + encodeURIComponent(id) + "&orgAcronyme=" + encodeURIComponent(org);
    // 1. page de demande
    const { rep, url } = await requete(urlDemande, jar);
    const html = await rep.text();
    if (TRACE) TRACE.push({ etape: 1, titre: (html.match(/<title>([^<]*)/i) || [])[1], champs: champs(html).filter(c => c.type !== "hidden" || /PRADO/.test(c.name || "")).map(c => [c.type, c.name, c.id, (c.value || "").slice(0, 80)]).slice(0, 60) });
    if (!/PRADO_PAGESTATE/.test(html)) throw new Error("Page de retrait du DCE introuvable");
    etat = { jar, url, html, etape: 2 };
  }
  let { jar, url, html } = etat;
  let rep;

  if (etat.etape === 2) {
    // 2. choix « anonyme » + acceptation des conditions (+ CAPTCHA éventuel), puis validation
    const cap = captchaImage(html, url);
    if (cap && code === null) throw await erreurCaptcha(etat, cap, origine, id, org);
    if (!cap && RE_ROBOT.test(html)) throw erreurRobot();
    const cs = champs(html);
    const d = donneesDeBase(html);
    const radio = cs.find(c => c.type === "radio" && /choixAnonyme/i.test((c.value || "") + (c.id || "")));
    if (radio) d.set(radio.name, radio.value || versNom(radio.id));
    else d.set("ctl0$CONTENU_PAGE$EntrepriseFormulaireDemande$RadioGroup", "ctl0$CONTENU_PAGE$EntrepriseFormulaireDemande$choixAnonyme");
    for (const c of cs) if (c.type === "checkbox" && c.name && /accept|condition|cgu/i.test((c.name || "") + (c.id || ""))) d.set(c.name, c.value || "on");
    if (cap) d.set(cap.champ, code);
    const valider = trouve(cs, /validateButton/i);
    d.set("PRADO_POSTBACK_TARGET", valider ? (valider.name || versNom(valider.id)) : "ctl0$CONTENU_PAGE$validateButton");
    ({ rep, url } = await requete(url, jar, { method: "POST", body: d, headers: { "Content-Type": "application/x-www-form-urlencoded" } }));
    html = await rep.text();
    if (TRACE) TRACE.push({ etape: 2, envoye: [...d.keys()].filter(k => !/PAGESTATE/.test(k)).map(k => [k, d.get(k).slice(0, 80)]), titre: (html.match(/<title>([^<]*)/i) || [])[1], erreurs: (html.match(/class="[^"]*(erreur|error|alert)[^"]*"[^>]*>[\s\S]{0,300}/gi) || []).slice(0, 5).map(x => x.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 200)), liens: [...html.matchAll(/(?:id|href)="([^"]*(?:ownload|Dce|DCE)[^"]*)"/g)].map(m => m[1]).slice(0, 20) });
    if (!/PRADO_PAGESTATE/.test(html)) throw new Error("Étape « anonyme » refusée par la plateforme");
    // code refusé : la plateforme réaffiche le formulaire avec un nouveau CAPTCHA
    const cap2 = !/completeDownload/i.test(html) && captchaImage(html, url);
    if (cap2) throw await erreurCaptcha({ jar, url, html, etape: 2 }, cap2, origine, id, org, cap && true);
    etat = { jar, url, html, etape: 3 };
    code = cap ? null : code;
  }

  // 3. demande du DCE complet (certaines plateformes placent le CAPTCHA ici)
  const cap3 = captchaImage(html, url);
  if (cap3 && code === null) throw await erreurCaptcha(etat, cap3, origine, id, org);
  if (!cap3 && !/completeDownload/i.test(html) && RE_ROBOT.test(html)) throw erreurRobot();
  const cs = champs(html);
  const d = donneesDeBase(html);
  const complet = trouve(cs, /completeDownload/i);
  if (!complet && !/completeDownload/i.test(html)) throw new Error("Lien de téléchargement du DCE absent (le DCE est peut-être réservé aux comptes)");
  if (cap3) d.set(cap3.champ, code);
  d.set("PRADO_POSTBACK_TARGET", complet ? (complet.name || versNom(complet.id)) : "ctl0$CONTENU_PAGE$EntrepriseDownloadDce$completeDownload");
  ({ rep } = await requete(url, jar, { method: "POST", body: d, headers: { "Content-Type": "application/x-www-form-urlencoded" } }));
  const type = rep.headers.get("content-type") || "";
  if (/text\/html/i.test(type)) {
    const h = await rep.text();
    const cap4 = captchaImage(h, url);
    if (cap4) throw await erreurCaptcha({ jar, url, html: h, etape: 3 }, cap4, origine, id, org, !!cap3);
    throw new Error("La plateforme a renvoyé une page au lieu du fichier");
  }
  rep.consultation = { base: origine, id, org };
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
async function trouverConsultation(origine, ref, objet, limite, acheteur) {
  // mots distinctifs de l'acheteur (« Sénat », « Louvre »…) pour départager des consultations proches
  const motsAch = [...new Set(norm(acheteur || "").split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !/^(ville|commune|mairie|departement|region|conseil|direction|service|services|public|publique|etablissement|ministere|general|centre|national|nationale|france|paris|syndicat|office|agence)$/.test(w)))];
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
      const okAch = motsAch.length > 0 && motsAch.some(w => x.texte.includes(w));
      const score = ratio + (okDate ? 1 : 0) + (okAch ? 0.5 : 0);
      const prec = candidats.get(x.id);
      if (!prec || prec.score < score) candidats.set(x.id, { ...x, score, ratio, okDate, okAch });
    }
  }
  {
    const tri = [...candidats.values()].sort((a, b) => b.score - a.score);
    const meilleur = tri[0], second = tri[1];
    const net = !second || meilleur.score - second.score >= 0.25;
    if (meilleur && net && ((meilleur.okDate && meilleur.ratio >= 0.5) || (!date && meilleur.ratio >= 0.85))) return meilleur;
  }
  const tri = [...candidats.values()].sort((a, b) => b.score - a.score);
  if (TRACE) TRACE.push({ candidats: tri.slice(0, 5).map(x => x.id + " score=" + x.score.toFixed(2) + " date=" + x.okDate + " ach=" + x.okAch) }, { extrait: tri[0] ? tri[0].texte.slice(0, 600) : "" });
  if (tri[0] && tri[0].okDate && tri[0].ratio >= 0.5 && (!tri[1] || tri[1].score < tri[0].score)) return tri[0];
  // une seule consultation trouvée avec la même date limite que l'avis : c'est elle
  const memeDate = tri.filter(x => x.okDate);
  if (memeDate.length === 1) return memeDate[0];
  return null;
}

process.on("uncaughtException", e => console.log("Erreur non gérée", e && e.stack));
process.on("unhandledRejection", e => console.log("Promesse rejetée", e && e.stack));


/* ---------- analyse du RC par l'IA ---------- */
const ORIGINES = new Set(["https://vigie-marches.onrender.com", ...(process.env.ORIGINES_TEST || "").split(",").filter(Boolean)]);
const analyses = new Map(); // cache : clé -> réponse
const compteAnalyses = new Map(); let jourAnalyses = "", totalJour = 0;
function quotaAnalyse(ip) {
  const j = new Date().toISOString().slice(0, 10);
  if (j !== jourAnalyses) { jourAnalyses = j; totalJour = 0; compteAnalyses.clear(); }
  const n = (compteAnalyses.get(ip) || 0) + 1;
  if (n > Number(process.env.ANALYSES_PAR_JOUR || 60) || totalJour >= Number(process.env.ANALYSES_MAX_JOUR || 300)) return false;
  compteAnalyses.set(ip, n); totalJour++;
  return true;
}
function json(res, code, obj, origine) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...(origine ? { "Access-Control-Allow-Origin": origine, Vary: "Origin" } : {}) });
  res.end(JSON.stringify(obj));
}
async function lireCorps(req, max) {
  const morceaux = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > max) throw new Error("trop gros"); morceaux.push(c); }
  return Buffer.concat(morceaux).toString("utf8");
}
async function telechargerRc(base, id, org) {
  const jar = new Map();
  const url = base + "/index.php?page=Entreprise.EntrepriseDownloadReglement&id=" + encodeURIComponent(Buffer.from(id).toString("base64")) + "&orgAcronyme=" + encodeURIComponent(org);
  const { rep } = await requete(url, jar);
  if (!rep.ok) throw new Error("RC indisponible (" + rep.status + ")");
  const taille = Number(rep.headers.get("content-length") || 0);
  if (taille > 40e6) throw new Error("RC trop volumineux");
  const buf = Buffer.from(await rep.arrayBuffer());
  const cd = rep.headers.get("content-disposition") || "";
  const nom = decodeURIComponent((cd.match(/filename\*=UTF-8''([^;]+)/i) || [])[1] || "") || (cd.match(/filename="?([^";]+)/i) || [])[1] || "RC";
  return { buf, nom, url };
}
async function routeAnalyse(req, res, u) {
  const o = req.headers.origin;
  const autorise = o && ORIGINES.has(o) ? o : null;
  if (req.method === "OPTIONS") {
    res.writeHead(204, autorise ? { "Access-Control-Allow-Origin": autorise, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" } : {});
    return res.end();
  }
  // GET : lecture mécanique seule (gratuite), pratique pour vérifier un RC depuis un navigateur
  const lectureSimple = req.method === "GET" && u.searchParams.get("mode") !== "ia";
  if (req.method !== "POST" && !lectureSimple) return json(res, 405, { erreur: "POST attendu" }, autorise);
  if (!autorise && !lectureSimple) return json(res, 403, { erreur: "Origine non autorisée" });
  let corps = {};
  if (!lectureSimple) try { corps = JSON.parse(await lireCorps(req, 400000)); } catch (e) { return json(res, 400, { erreur: "Demande illisible" }, autorise); }
  const modeIA = u.searchParams.get("mode") === "ia";
  const iaDispo = !!process.env.ANTHROPIC_API_KEY;
  const cle = corps.cle ? (modeIA ? "ia:" : "rg:") + String(corps.cle).slice(0, 40) : "";
  if (cle && analyses.has(cle)) return json(res, 200, { ...analyses.get(cle), ia: iaDispo }, autorise);
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  if (modeIA) {
    if (!iaDispo) return json(res, 503, { erreur: "cle", message: "L'analyse IA n'est pas activée : la clé ANTHROPIC_API_KEY n'est pas configurée sur le serveur." }, autorise);
    if (!quotaAnalyse(ip)) return json(res, 429, { erreur: "quota", message: "Nombre maximum d'analyses IA atteint pour aujourd'hui." }, autorise);
  } else if (tropDeDemandes(ip)) return json(res, 429, { erreur: "quota", message: "Trop d'analyses en peu de temps. Réessayez dans quelques minutes." }, autorise);

  // 1. récupérer le RC quand la consultation est sur une plateforme Atexo
  let rc = null, fichier = "", lienRc = "", raisonSansRc = "";
  const origine = u.searchParams.get("origine") || "";
  try {
    if (origine) {
      const base = new URL(origine);
      if (!hoteAutorise(base.hostname) || (base.protocol !== "https:" && !process.env.HOTE_TEST)) throw new Error("plateforme non prise en charge");
      let id = u.searchParams.get("id") || "", org = u.searchParams.get("org") || "";
      if (!id) {
        const t = await trouverConsultation(base.origin, (u.searchParams.get("reference") || "").slice(0, 80), (u.searchParams.get("objet") || "").slice(0, 300), (u.searchParams.get("limite") || "").slice(0, 25), (u.searchParams.get("acheteur") || "").slice(0, 120));
        if (t) { id = t.id; org = t.org; }
      }
      if (!/^\d{1,10}$/.test(id) || !/^[a-z0-9]{1,12}$/i.test(org)) throw new Error("consultation non retrouvée sur la plateforme");
      const r = await telechargerRc(base.origin, id, org);
      lienRc = r.url;
      if (modeIA) { rc = extraire(r.buf, r.nom); if (rc) fichier = rc.nom; }
      else { const tous = extraireTous(r.buf, r.nom); if (tous.length) { rc = tous; fichier = tous.map(x => x.nom).join(", "); } }
      if (!rc) throw new Error("RC non lisible (" + r.nom + ")");
    } else raisonSansRc = "pas de plateforme de téléchargement direct";
  } catch (e) { rc = null; raisonSansRc = e.message; }

  // 2. synthèse : mécanique (par défaut, gratuite) ou par l'IA
  try {
    let synthese, source = rc ? "rc" : "avis";
    if (modeIA) synthese = await analyser(rc, String(corps.avis || ""));
    else {
      let texte = "";
      if (rc) for (const x of rc) { try { texte += "\n\n" + (x.pdf ? await textePdf(x.pdf) : x.texte); } catch (e) { console.log("lecture", x.nom, e.message); } }
      if (rc && texte.replace(/\s/g, "").length < 400 && rc.some(x => x.pdf)) { raisonSansRc = "le RC « " + fichier + " » est une image scannée, son texte n'est pas lisible"; source = "avis"; texte = ""; }
      if (!texte) texte = String(corps.avis || "").replace(/^[^=\n]* = /gm, "");
      synthese = analyserTexte(texte);
    }
    const r = { ok: true, mode: modeIA ? "ia" : "regles", source, fichier, lienRc, raisonSansRc, synthese, date: new Date().toISOString(), ia: iaDispo };
    if (cle) { analyses.set(cle, r); if (analyses.size > 800) analyses.delete(analyses.keys().next().value); }
    console.log(new Date().toISOString(), "ANALYSE OK", cle, r.source, fichier);
    return json(res, 200, r, autorise);
  } catch (e) {
    console.log(new Date().toISOString(), "ANALYSE ECHEC", cle, e.status || "", e.message);
    const msg = e.status === 401 ? "La clé ANTHROPIC_API_KEY est refusée (invalide ou révoquée)."
      : e.status === 429 ? "L'API Anthropic est saturée ou le crédit est épuisé, réessayez plus tard."
      : e.status === 400 && /credit/i.test(e.message || "") ? "Crédit Anthropic insuffisant."
      : "L'analyse a échoué : " + (e.message || "erreur inconnue").slice(0, 200);
    return json(res, 502, { erreur: "analyse", message: msg }, autorise);
  }
}


/* ---------- dépôt dans OneDrive (connexion Microsoft de l'utilisateur) ---------- */
async function routeOneDrive(req, res, u) {
  const o = req.headers.origin;
  const autorise = o && ORIGINES.has(o) ? o : null;
  if (req.method === "OPTIONS") {
    res.writeHead(204, autorise ? { "Access-Control-Allow-Origin": autorise, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Max-Age": "86400", Vary: "Origin" } : {});
    return res.end();
  }
  if (req.method !== "POST") return json(res, 405, { erreur: "POST attendu" }, autorise);
  if (!autorise) return json(res, 403, { erreur: "Origine non autorisée" });
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token || token.length > 10000) return json(res, 401, { erreur: "connexion", message: "Connexion Microsoft manquante." }, autorise);
  let c;
  try { c = JSON.parse(await lireCorps(req, 20000)); } catch (e) { return json(res, 400, { erreur: "Demande illisible" }, autorise); }
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  if (tropDeDemandes(ip)) return json(res, 429, { erreur: "quota", message: "Trop de demandes en peu de temps, réessayez dans quelques minutes." }, autorise);
  const driveId = String(c.driveId || ""), parentId = String(c.parentId || ""), nom = String(c.dossier || "").slice(0, 150);
  if (!/^[\w!.-]{5,200}$/.test(driveId) || !/^[\w!.-]{5,200}$/.test(parentId) || !nom) return json(res, 400, { erreur: "parametres", message: "Dossier OneDrive non configuré." }, autorise);
  const r = { ok: true, dossier: nom, webUrl: "", fichiers: 0, total: 0, erreurs: [], dce: "" };
  try {
    const dossier = await onedrive.creerDossier(token, driveId, parentId, nom);
    r.webUrl = dossier.webUrl || "";
    r.id = dossier.id || "";
    await onedrive.creerSousDossiers(token, driveId, dossier.id);
    // le DCE, si la plateforme permet le retrait anonyme
    const origine = String(c.origine || "");
    const reprise = c.jeton ? { jeton: String(c.jeton), code: String(c.code || "") } : null;
    // AWS-Achat, e-marchespublics : retrait anonyme avec code image
    const enAttente = reprise && captchas.get(reprise.jeton);
    let pageCode = null;
    if (c.url && !reprise) { try { const x = new URL(String(c.url)); if (x.protocol === "https:" && hoteCode(x.hostname)) pageCode = x.toString(); } catch (e) {} }
    if (pageCode || (enAttente && enAttente.etat && enAttente.etat.type === "code")) {
      const lien = pageCode || enAttente.base;
      r.lienDce = lien;
      let rep;
      try { rep = await telechargerParCode(lien, reprise); } catch (e) { r.dce = e.captcha ? "captcha" : e.robot ? "robot" : "echec"; r.message = e.message; if (e.captcha) r.captcha = e.captcha; return json(res, 200, r, autorise); }
      const taille = Number(rep.headers.get("content-length") || 0);
      if (taille > 300e6) { try { await rep.body.cancel(); } catch (e) {} r.dce = "trop_gros"; return json(res, 200, r, autorise); }
      const buf = Buffer.from(await rep.arrayBuffer());
      const cd = rep.headers.get("content-disposition") || "";
      const nomArchive = (cd.match(/filename="?([^";]+)/i) || [])[1] || "DCE.zip";
      Object.assign(r, await onedrive.deposerDce(token, driveId, dossier.id, nomArchive, buf), { dce: "ok", taille: buf.length });
      console.log(new Date().toISOString(), "ONEDRIVE OK (code)", new URL(lien).hostname, r.fichiers + "/" + r.total);
      return json(res, 200, r, autorise);
    }
    if (!origine && !reprise) { r.dce = "absent"; return json(res, 200, r, autorise); }
    let base;
    if (reprise) { const p = captchas.get(reprise.jeton); base = p ? new URL(p.base) : null; c.id = p ? p.id : ""; c.org = p ? p.org : ""; if (!base) { r.dce = "echec"; r.message = "Le code CAPTCHA a expiré, relancez « Dossier de réponse »"; return json(res, 200, r, autorise); } }
    else try { base = new URL(origine); if (!hoteAutorise(base.hostname) || (base.protocol !== "https:" && !process.env.HOTE_TEST)) throw 0; } catch (e) { r.dce = "absent"; return json(res, 200, r, autorise); }
    let id = String(c.id || ""), org = String(c.org || "");
    if (!id) { const t = await trouverConsultation(base.origin, String(c.reference || "").slice(0, 80), String(c.objet || "").slice(0, 300), String(c.limite || "").slice(0, 25), String(c.acheteur || "").slice(0, 120)).catch(() => null); if (t) { id = t.id; org = t.org; } }
    if (!/^\d{1,10}$/.test(id) || !/^[a-z0-9]{1,12}$/i.test(org)) { r.dce = "introuvable"; r.lienDce = lienRecherche(base.origin, String(c.reference || "").slice(0, 80), String(c.objet || "").slice(0, 300)); return json(res, 200, r, autorise); }
    r.lienConsultation = base.origin + "/entreprise/consultation/" + id + "?orgAcronyme=" + org;
    let rep;
    try { rep = await telechargerDce(base.origin, id, org, reprise); } catch (e) { r.dce = e.captcha ? "captcha" : e.robot ? "robot" : "echec"; r.message = e.message; if (e.captcha) r.captcha = e.captcha; r.lienDce = base.origin + "/index.php?page=Entreprise.EntrepriseDemandeTelechargementDce&id=" + id + "&orgAcronyme=" + org; return json(res, 200, r, autorise); }
    const taille = Number(rep.headers.get("content-length") || 0);
    if (taille > 300e6) { try { await rep.body.cancel(); } catch (e) {} r.dce = "trop_gros"; r.lienDce = base.origin + "/index.php?page=Entreprise.EntrepriseDemandeTelechargementDce&id=" + id + "&orgAcronyme=" + org; return json(res, 200, r, autorise); }
    const buf = Buffer.from(await rep.arrayBuffer());
    const cd = rep.headers.get("content-disposition") || "";
    const nomArchive = (cd.match(/filename="?([^";]+)/i) || [])[1] || "DCE_" + id + ".zip";
    const d = await onedrive.deposerDce(token, driveId, dossier.id, nomArchive, buf);
    Object.assign(r, d, { dce: "ok", taille: buf.length });
    console.log(new Date().toISOString(), "ONEDRIVE OK", id, org, d.fichiers + "/" + d.total);
    return json(res, 200, r, autorise);
  } catch (e) {
    console.log(new Date().toISOString(), "ONEDRIVE ECHEC", e.status || "", e.message);
    return json(res, e.status === 401 ? 401 : 502, { erreur: e.status === 401 ? "connexion" : "onedrive", message: e.message, ...r, ok: false }, autorise);
  }
}

/* ---------- serveur HTTP ---------- */
const derniers = new Map(); // limitation simple : 20 demandes / 10 min / adresse IP
function tropDeDemandes(ip) {
  const t = Date.now(), l = (derniers.get(ip) || []).filter(x => t - x < 600000);
  l.push(t); derniers.set(ip, l);
  return l.length > 20;
}
// recherche de la consultation sur la plateforme (référence, sinon trois mots de l'objet)
function lienRecherche(base, ref, objet) {
  return base + "/?page=Entreprise.EntrepriseAdvancedSearch&AllCons&keyWord=" + encodeURIComponent(ref && !REF_VIDE.test(norm(ref)) ? ref : norm(objet).split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !MOTS_VIDES.has(w)).slice(0, 3).join(" "));
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

async function envoyerFichier(res, rep, id) {
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
}
const echap = t => String(t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
// Vigie (appel fetch) reçoit du JSON ; un clic sur un lien reçoit une page
function echecDce(req, res, e, lienDce) {
  const o = req.headers.origin, appli = o && ORIGINES.has(o);
  if (e.captcha) {
    if (appli) return json(res, 409, { erreur: "captcha", captcha: e.captcha, lienDce, message: e.message }, o);
    return pageCaptcha(res, e.captcha, lienDce);
  }
  if (e.robot) {
    if (appli) return json(res, 409, { erreur: "robot", lienDce, message: e.message }, o);
    return pageErreur(res, 409, e.message + ". Ouvrez la page de retrait, cochez la case, puis téléchargez le DCE.", lienDce);
  }
  if (appli) return json(res, 502, { erreur: "echec", lienDce, message: e.message }, o);
  return pageErreur(res, 502, e.message + ". Vous pouvez le récupérer manuellement sur la plateforme (choisir « anonyme »).", lienDce);
}
// Fenêtre « Recopiez le code » quand le DCE est demandé par un simple lien
function pageCaptcha(res, cap, lienDce) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Code de vérification</title>
<body style="font:16px system-ui;max-width:520px;margin:40px auto;padding:0 16px;color:#14203d;background:#fff">
<div style="border:2px solid #16337a;border-top:6px solid #d22d39;border-radius:12px;padding:20px 22px">
<h1 style="color:#16337a;font-size:20px;margin:0 0 8px">Code de vérification demandé</h1>
<p style="margin:0 0 14px">La plateforme demande de recopier le code ci-dessous avant de donner le DCE.${cap.incorrect ? ` <strong style="color:#d22d39">Le code précédent était incorrect, voici un nouveau code.</strong>` : ""}</p>
<form method="post" action="/dce/captcha">
<input type="hidden" name="jeton" value="${echap(cap.jeton)}">
<img src="${echap(cap.image)}" alt="Code à recopier" style="display:block;min-height:50px;max-width:100%;border:1px solid #c9d3ea;border-radius:6px;margin-bottom:12px;image-rendering:auto">
<label for="code" style="font-weight:600;display:block;margin-bottom:4px">Code</label>
<input id="code" name="code" autocomplete="off" autocapitalize="off" spellcheck="false" autofocus required style="font:20px ui-monospace,monospace;letter-spacing:.15em;padding:8px 10px;border:1.5px solid #16337a;border-radius:8px;width:100%;box-sizing:border-box">
<button style="margin-top:14px;background:#16337a;color:#fff;border:0;padding:11px 18px;border-radius:8px;font-weight:600;font-size:15px;cursor:pointer">Valider et télécharger le DCE</button>
</form>
<p style="font-size:13px;color:#5b6684;margin:16px 0 0">Code illisible ? <a href="${echap(lienDce)}" style="color:#3a5fc4">Ouvrir la page de retrait sur la plateforme</a>.</p>
</div></body></html>`);
}
async function routeCaptcha(req, res) {
  const o = req.headers.origin, appli = o && ORIGINES.has(o);
  if (req.method === "OPTIONS") { res.writeHead(204, appli ? { "Access-Control-Allow-Origin": o, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" } : {}); return res.end(); }
  if (req.method !== "POST") return pageErreur(res, 405, "Lien expiré : relancez le téléchargement du DCE depuis Vigie.");
  const brut = await lireCorps(req, 4000);
  let p;
  try { p = /json/i.test(req.headers["content-type"] || "") ? JSON.parse(brut) : Object.fromEntries(new URLSearchParams(brut)); } catch (e) { p = {}; }
  const enAttente = captchas.get(String(p.jeton || ""));
  const lienDce = !enAttente ? "" : enAttente.etat && enAttente.etat.type === "code" ? enAttente.base : enAttente.base + "/index.php?page=Entreprise.EntrepriseDemandeTelechargementDce&id=" + enAttente.id + "&orgAcronyme=" + enAttente.org;
  try {
    const rep = await telechargerDce(null, null, null, { jeton: p.jeton, code: p.code });
    await envoyerFichier(res, rep, rep.consultation.id || "consultation");
    console.log(new Date().toISOString(), "DCE OK (captcha)", rep.consultation.base, rep.consultation.id);
  } catch (e) {
    console.log(new Date().toISOString(), "DCE ECHEC (captcha)", e.message);
    if (!res.headersSent) echecDce(req, res, e, lienDce); else res.end();
  }
}
// DCE déjà récupéré dans le navigateur (extension Vigie, session de l'utilisateur) : dépôt dézippé dans OneDrive
async function routeOneDriveFichier(req, res) {
  const o = req.headers.origin;
  const autorise = o && ORIGINES.has(o) ? o : null;
  if (req.method === "OPTIONS") {
    res.writeHead(204, autorise ? { "Access-Control-Allow-Origin": autorise, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Drive, X-Dossier, X-Nom", "Access-Control-Max-Age": "86400", Vary: "Origin" } : {});
    return res.end();
  }
  if (req.method !== "POST") return json(res, 405, { erreur: "POST attendu" }, autorise);
  if (!autorise) return json(res, 403, { erreur: "Origine non autorisée" });
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const driveId = String(req.headers["x-drive"] || ""), dossierId = String(req.headers["x-dossier"] || "");
  let nom = "DCE.zip"; try { nom = decodeURIComponent(String(req.headers["x-nom"] || "DCE.zip")).slice(0, 150) || "DCE.zip"; } catch (e) {}
  if (!token || token.length > 10000) return json(res, 401, { erreur: "connexion", message: "Connexion Microsoft manquante." }, autorise);
  if (!/^[\w!.-]{5,200}$/.test(driveId) || !/^[\w!.-]{5,200}$/.test(dossierId)) return json(res, 400, { erreur: "parametres", message: "Dossier OneDrive non configuré." }, autorise);
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  if (tropDeDemandes(ip)) return json(res, 429, { erreur: "quota", message: "Trop de demandes en peu de temps, réessayez dans quelques minutes." }, autorise);
  if (Number(req.headers["content-length"] || 0) > 200e6) return json(res, 413, { erreur: "trop_gros", message: "Le DCE dépasse 200 Mo, déposez-le à la main." }, autorise);
  const morceaux = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > 200e6) return json(res, 413, { erreur: "trop_gros", message: "Le DCE dépasse 200 Mo, déposez-le à la main." }, autorise); morceaux.push(c); }
  const buf = Buffer.concat(morceaux);
  try {
    const d = await onedrive.deposerDce(token, driveId, dossierId, nom, buf);
    console.log(new Date().toISOString(), "ONEDRIVE FICHIER OK", d.fichiers + "/" + d.total);
    return json(res, 200, { ok: true, dce: "ok", taille: buf.length, ...d }, autorise);
  } catch (e) {
    return json(res, e.status === 401 ? 401 : 502, { erreur: e.status === 401 ? "connexion" : "onedrive", message: e.message }, autorise);
  }
}

/* ---------- fiche d'une consultation (ajout manuel d'un marché dans Vigie) ----------
   Lit la page publique de la consultation et renvoie seulement les champs reconnus
   (intitulé, acheteur, date limite…), jamais la page elle-même. Adresses internes refusées. */
function ipPrivee(ip) {
  if (net.isIPv4(ip)) { const [a, b] = ip.split(".").map(Number); return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224; }
  const x = ip.toLowerCase(); return x === "::1" || x === "::" || /^(fc|fd|fe80)/.test(x) || /^::ffff:/.test(x) && ipPrivee(x.replace(/^::ffff:/, ""));
}
async function adressePublique(u) {
  if (process.env.HOTE_TEST && u.hostname === process.env.HOTE_TEST) return true;
  if (!/^https?:$/.test(u.protocol) || (u.port && !["80", "443"].includes(u.port)) || u.username || u.password) return false;
  if (net.isIP(u.hostname) || /^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) return false;
  try { const l = await dns.lookup(u.hostname, { all: true }); return l.length > 0 && !l.some(a => ipPrivee(a.address)); } catch (e) { return false; }
}
// « Règlement de consultation - 422,15 Ko », « Dossier de consultation - 13,55 Mo » (PLACE, Maximilien, Atexo…)
function piecesDeLaPage(html) {
  const r = new Set();
  const texte = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, "\n").replace(/&nbsp;|&#160;/g, " ");
  for (const l of texte.split("\n")) {
    const m = l.replace(/\s+/g, " ").trim().match(/^((?:r[èe]glement de (?:la )?consultation|dossier de consultation|dce|avis|pi[èe]ces?|annexes?|compl[ée]ment)[^:]{0,80}?)\s*[-–(]\s*([\d\s.,]+\s*(?:[KMG]i?o|octets|[KMG]B))\)?$/i);
    if (m) r.add(m[1].trim() + " - " + m[2].replace(/\s+/g, " ").trim());
    if (r.size >= 20) break;
  }
  return [...r];
}
async function routeFiche(req, res, u) {
  const o = req.headers.origin, autorise = o && ORIGINES.has(o) ? o : null;
  let cible;
  try { cible = new URL(String(u.searchParams.get("url") || "").slice(0, 2000)); } catch (e) { return json(res, 400, { ok: false, message: "Adresse invalide." }, autorise); }
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  if (tropDeDemandes(ip)) return json(res, 429, { ok: false, message: "Trop de demandes en peu de temps, réessayez dans quelques minutes." }, autorise);
  const jar = new Map();
  let rep, url = cible;
  for (let i = 0; i < 6; i++) {
    if (!(await adressePublique(url))) return json(res, 400, { ok: false, message: "Cette adresse ne peut pas être lue." }, autorise);
    rep = await fetch(url, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 VigieMarches", "Accept": "text/html,application/xhtml+xml", "Accept-Language": "fr-FR,fr;q=0.9", Cookie: enTete(jar) }, signal: AbortSignal.timeout(30000) });
    majCookies(jar, rep);
    const loc = rep.headers.get("location");
    if (rep.status >= 300 && rep.status < 400 && loc) { url = new URL(loc, url); continue; }
    break;
  }
  if (!rep.ok) return json(res, 200, { ok: false, message: "La plateforme a répondu « " + rep.status + " » : complétez les informations à la main." }, autorise);
  const type = rep.headers.get("content-type") || "";
  if (!/html|xml|text\/plain/i.test(type)) { try { await rep.body.cancel(); } catch (e) {} return json(res, 200, { ok: false, message: "Ce lien ne mène pas à une page de consultation (fichier " + type.split(";")[0] + ")." }, autorise); }
  const morceaux = []; let n = 0;
  for await (const c of rep.body) { n += c.length; morceaux.push(c); if (n > 4e6) break; }
  const buf = Buffer.concat(morceaux);
  let charset = (type.match(/charset=([\w-]+)/i) || [])[1] || (buf.subarray(0, 3000).toString("latin1").match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1] || "utf-8";
  let html; try { html = new TextDecoder(charset.toLowerCase()).decode(buf); } catch (e) { html = buf.toString("utf8"); }
  const fiche = extraireFiche(html, url.toString());
  fiche.docs = piecesDeLaPage(html); // tailles du RC et du DCE : un changement signale un DCE modifié
  console.log(new Date().toISOString(), "FICHE", url.hostname, fiche.trouves + "/5");
  return json(res, 200, { ok: true, url: url.toString(), fiche }, autorise);
}

/* ---------- /mail/imap : alertes des plateformes dans une boîte IMAP ----------
   Identifiants reçus à chaque demande, jamais écrits ni journalisés ; réservé à l'appli Vigie. */
const IMAP_PORTS = new Set([993]);
const derniersMail = new Map();
async function routeMailImap(req, res) {
  const o = req.headers.origin, autorise = o && ORIGINES.has(o) && o !== "null" ? o : null;
  if (req.method === "OPTIONS") { res.writeHead(204, autorise ? { "Access-Control-Allow-Origin": autorise, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" } : {}); return res.end(); }
  if (req.method !== "POST") return json(res, 405, { ok: false, message: "POST attendu" }, autorise);
  if (!autorise) return json(res, 403, { ok: false, message: "Origine non autorisée" });
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const t = Date.now(), l = (derniersMail.get(ip) || []).filter(x => t - x < 600000); l.push(t); derniersMail.set(ip, l);
  if (l.length > 10) return json(res, 429, { ok: false, message: "Trop de demandes en peu de temps, réessayez dans quelques minutes." }, autorise);
  let c; try { c = JSON.parse(await lireCorps(req, 10000)); } catch (e) { return json(res, 400, { ok: false, message: "Demande illisible" }, autorise); }
  const hote = String(c.hote || "").trim().toLowerCase(), port = Number(c.port || 993);
  const utilisateur = String(c.utilisateur || "").trim();
  // mot de passe saisi, sinon celui enregistré (chiffré) dans le compte Vigie de l'utilisateur
  const motdepasse = String(c.motdepasse || "") || (c.motdepasseChiffre && req.compte ? dechiffrer(c.motdepasseChiffre, req.compte.e) || "" : "");
  if (!c.motdepasse && c.motdepasseChiffre && !motdepasse) return json(res, 400, { ok: false, message: "Le mot de passe enregistré de la boîte mail n'est plus lisible : saisissez-le de nouveau dans « Importer les alertes mail »." }, autorise);
  const depuis = new Date(c.depuis || Date.now() - 14 * 864e5);
  if (!/^[a-z0-9.-]{3,120}$/.test(hote) || !IMAP_PORTS.has(port) || !utilisateur || !motdepasse || utilisateur.length > 200 || motdepasse.length > 200 || isNaN(depuis))
    return json(res, 400, { ok: false, message: "Paramètres de la boîte mail incomplets." }, autorise);
  if (!(await adressePublique(new URL("https://" + hote)))) return json(res, 400, { ok: false, message: "Serveur de messagerie inconnu." }, autorise);
  const debut = new Date(Math.max(depuis.getTime(), Date.now() - 120 * 864e5));
  try {
    const r = await lireAlertes({ hote, port, utilisateur, motdepasse, depuis: debut, messages: c.messages === true });
    console.log(new Date().toISOString(), "IMAP", hote, r.parcourus + " mails", r.mails.length + " alertes");
    return json(res, 200, { ok: true, ...r }, autorise);
  } catch (e) {
    const auth = e.authenticationFailed || /auth|login|credentials|invalid/i.test((e.responseText || "") + e.message);
    console.log(new Date().toISOString(), "IMAP ECHEC", hote, auth ? "identification" : e.code || "erreur");
    return json(res, 200, { ok: false, message: auth ? "Identifiant ou mot de passe refusé par la messagerie (pour Gmail, utilisez un mot de passe d'application)." : "Connexion à la messagerie impossible (" + (e.code || e.message || "erreur") + ")." }, autorise);
  }
}

// adresse du serveur lui-même (formulaire CAPTCHA de ses propres pages)
const SOI = (process.env.RENDER_EXTERNAL_URL || "https://vigie-marches-dce.onrender.com").replace(/\/$/, "");
const SITE = "https://vigie-marches.onrender.com";
function pageConnexion(res) {
  res.writeHead(401, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connexion requise</title>
<body style="font:16px system-ui;max-width:640px;margin:40px auto;padding:0 16px;color:#14203d">
<h1 style="color:#16337a;font-size:22px">Connexion à Vigie requise</h1>
<p>Ce lien ne fonctionne que pour un utilisateur connecté à Vigie Marchés. Ouvrez Vigie, connectez-vous, puis cliquez de nouveau sur le bouton.</p>
<p><a href="${SITE}" style="display:inline-block;background:#16337a;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Ouvrir Vigie Marchés</a></p></body>`);
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const o = req.headers.origin;
  if (u.pathname === "/" || u.pathname === "/sante") { res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", ...(o && ORIGINES.has(o) ? { "Access-Control-Allow-Origin": o } : {}) }); return res.end("Vigie Marchés : serveur DCE en service"); }
  // Seul le site Vigie (et les pages du serveur lui-même) peut appeler le serveur depuis un navigateur.
  if (o && !ORIGINES.has(o) && o !== SOI) { res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Origine non autorisée"); }
  if (o && ORIGINES.has(o)) {
    res.setHeader("Access-Control-Allow-Origin", o);
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition, Content-Length, X-Vigie-Connexion");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    if (o && ORIGINES.has(o)) res.writeHead(204, { "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Drive, X-Dossier, X-Nom, X-Vigie", "Access-Control-Max-Age": "86400" });
    else res.writeHead(204);
    return res.end();
  }
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  if (u.pathname.startsWith("/compte/")) return routeCompte(req, res, u, { json, lireCorps, ip }).catch(e => { console.log("compte", e.stack); if (!res.headersSent) json(res, 500, { message: "Erreur interne" }); });
  // Toutes les autres routes sont réservées aux utilisateurs connectés à Vigie.
  // /dce/captcha n'a pas besoin du jeton : le jeton du CAPTCHA (10 min) n'est remis qu'à un utilisateur connecté.
  if (u.pathname !== "/dce/captcha") {
    req.compte = compteDe(req, u);
    if (!req.compte) {
      if (!o) return pageConnexion(res); // lien ouvert dans un onglet
      res.setHeader("X-Vigie-Connexion", "1");
      return json(res, 401, { erreur: "compte", ok: false, message: "Session Vigie expirée : reconnectez-vous." });
    }
    if (u.pathname === "/diagnostic" && req.compte.r !== "admin") return json(res, 403, { message: "Réservé à l'administrateur." });
  }
  if (u.pathname === "/dce/captcha") return routeCaptcha(req, res).catch(e => { console.log("captcha", e.stack); if (!res.headersSent) pageErreur(res, 500, e.message); else res.end(); });
  if (u.pathname === "/onedrive/dce") return routeOneDriveFichier(req, res).catch(e => { console.log("onedrive/dce", e.stack); if (!res.headersSent) json(res, 500, { erreur: "interne", message: e.message }); });
  if (u.pathname === "/onedrive") return routeOneDrive(req, res, u).catch(e => { console.log("onedrive", e.stack); if (!res.headersSent) json(res, 500, { erreur: "interne", message: e.message }); });
  if (u.pathname === "/mail/imap") return routeMailImap(req, res).catch(e => { console.log("mail", e.code || "erreur"); if (!res.headersSent) json(res, 500, { ok: false, message: "Erreur interne" }); });
  if (u.pathname === "/fiche") return routeFiche(req, res, u).catch(e => { console.log("fiche", e.message); if (!res.headersSent) json(res, 200, { ok: false, message: "Page illisible ou plateforme injoignable (" + e.message + ") : complétez à la main." }, req.headers.origin && ORIGINES.has(req.headers.origin) ? req.headers.origin : null); });
  if (u.pathname === "/analyse") return routeAnalyse(req, res, u).catch(e => { console.log("analyse", e.stack); if (!res.headersSent) json(res, 500, { erreur: "interne", message: e.message }); });
  if (u.pathname === "/diagnostic" && u.searchParams.get("url")) {
    TRACE = [];
    let resultat;
    try {
      const x = new URL(u.searchParams.get("url"));
      if (x.protocol !== "https:" || !hoteCode(x.hostname)) throw new Error("plateforme refusée");
      const r = await telechargerParCode(x.toString());
      resultat = { ok: true, type: r.headers.get("content-type"), disposition: r.headers.get("content-disposition") };
      try { await r.body.cancel(); } catch (e) {}
    } catch (e) { resultat = { ok: false, erreur: e.message, captcha: e.captcha ? e.captcha.jeton : undefined }; }
    const t = TRACE; TRACE = null;
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end(JSON.stringify({ resultat, trace: t }, null, 1));
  }
  if (u.pathname === "/diagnostic") {
    TRACE = [];
    const o = u.searchParams.get("origine") || "";
    let id = u.searchParams.get("id") || "", org = u.searchParams.get("org") || "";
    let resultat;
    try {
      const h = new URL(o).hostname;
      if (!id && hoteAutorise(h)) { const t = await trouverConsultation(new URL(o).origin, (u.searchParams.get("reference") || "").slice(0, 80), (u.searchParams.get("objet") || "").slice(0, 300), (u.searchParams.get("limite") || "").slice(0, 25), (u.searchParams.get("acheteur") || "").slice(0, 120)); TRACE.push({ trouve: t && { id: t.id, org: t.org } }); if (t) { id = t.id; org = t.org; } }
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

  if (u.searchParams.get("url")) {
    let page;
    try { const x = new URL(u.searchParams.get("url")); if (x.protocol !== "https:" && !process.env.HOTE_TEST) throw 0; if (!hoteCode(x.hostname)) throw 0; page = x.toString(); } catch (e) { return pageErreur(res, 400, "Cette plateforme n'est pas prise en charge pour le téléchargement automatique."); }
    if (tropDeDemandes(ip)) return pageErreur(res, 429, "Trop de téléchargements en peu de temps. Réessayez dans quelques minutes.", page);
    try {
      const rep = await telechargerParCode(page);
      await envoyerFichier(res, rep, "consultation");
      console.log(new Date().toISOString(), "DCE OK (code)", new URL(page).hostname);
    } catch (e) {
      console.log(new Date().toISOString(), "DCE ECHEC (code)", new URL(page).hostname, e.message);
      if (!res.headersSent) echecDce(req, res, e, page); else res.end();
    }
    return;
  }

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
  if (tropDeDemandes(ip)) return pageErreur(res, 429, "Trop de téléchargements en peu de temps. Réessayez dans quelques minutes.", retour);
  const base = new URL(origine).origin;
  if (!id && (ref || objet)) {
    try {
      const t = await trouverConsultation(base, ref, objet, limite, (u.searchParams.get("acheteur") || "").slice(0, 120));
      if (t) { id = t.id; org = t.org; console.log(new Date().toISOString(), "TROUVE", hote, ref, "->", id, org); }
    } catch (e) { console.log("recherche", e.message); }
    if (!id) {
      const rech = lienRecherche(base, ref, objet);
      if (quoi === "lien") return json(res, 200, { trouve: false, lien: rech }, req.headers.origin && ORIGINES.has(req.headers.origin) ? req.headers.origin : null);
      return pageErreur(res, 404, "La consultation n'a pas été retrouvée de façon certaine sur la plateforme. La recherche ci-dessous la contient sans doute : repérez-la par sa date limite, puis utilisez le bouton de retrait du DCE.", rech, "Voir la recherche sur la plateforme");
    }
  }
  if (!/^\d{1,10}$/.test(id) || !/^[a-z0-9]{1,12}$/i.test(org)) return pageErreur(res, 400, "Identifiant de consultation invalide.", retour);
  const page = base + "/index.php?page=Entreprise.";
  if (quoi === "rc") { res.writeHead(302, { Location: page + "EntrepriseDownloadReglement&id=" + encodeURIComponent(Buffer.from(id).toString("base64")) + "&orgAcronyme=" + org }); return res.end(); }
  // liens directs vers la consultation (pour le raccourci du dossier de réponse quand le DCE n'a pas pu être retiré)
  if (quoi === "lien") return json(res, 200, { trouve: true, lien: page + "EntrepriseDemandeTelechargementDce&id=" + id + "&orgAcronyme=" + org, consultation: base + "/entreprise/consultation/" + id + "?orgAcronyme=" + org }, req.headers.origin && ORIGINES.has(req.headers.origin) ? req.headers.origin : null);
  if (quoi === "consultation") { res.writeHead(302, { Location: base + "/entreprise/consultation/" + id + "?orgAcronyme=" + org }); return res.end(); }

  try {
    const rep = await telechargerDce(base, id, org);
    await envoyerFichier(res, rep, id);
    console.log(new Date().toISOString(), "DCE OK", hote, id, org);
  } catch (e) {
    console.log(new Date().toISOString(), "DCE ECHEC", hote, id, org, e.message);
    if (!res.headersSent) echecDce(req, res, e, page + "EntrepriseDemandeTelechargementDce&id=" + id + "&orgAcronyme=" + org);
    else res.end();
  }
}).listen(PORT, () => console.log("Serveur DCE sur le port " + PORT));
