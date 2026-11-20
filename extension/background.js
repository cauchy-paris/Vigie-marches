// Vigie Marchés : extension « sessions des plateformes ».
// - Télécharge le DCE en passant par les sessions déjà ouvertes dans ce navigateur
//   (cookies de PLACE, Maximilien, AWS-Achat…). Les identifiants ne sont jamais lus ni envoyés ailleurs.
// - Garde ces sessions actives (une visite discrète toutes les 10 minutes).
// - Relaie vers Vigie les CAPTCHA image : l'utilisateur tape le code dans Vigie.
"use strict";

const PLATEFORMES = [
  { cle: "place", nom: "PLACE", accueil: "https://www.marches-publics.gouv.fr/" },
  { cle: "maximilien", nom: "Maximilien", accueil: "https://marches.maximilien.fr/" },
  { cle: "aws", nom: "AWS-Achat", accueil: "https://www.marches-publics.info/" },
  { cle: "achatpublic", nom: "achatpublic", accueil: "https://www.achatpublic.com/" },
  { cle: "emp", nom: "e-marchespublics", accueil: "https://www.e-marchespublics.com/" },
];
// mêmes plateformes que le manifeste (le téléchargement automatique « Atexo » ne vise que celles-ci)
const HOTES = /(^|\.)(marches-publics\.gouv\.fr|maximilien\.fr|e-megalisbretagne\.org|alsacemarchespublics\.eu|grandest\.fr|auvergnerhonealpes\.eu|hautsdefrance\.fr|nouvelle-aquitaine\.fr|ampmetropole\.fr|ternum-bfc\.fr|paysdelaloire\.fr|atexo\.com|local-trust\.com|marches-publics\.info|achatpublic\.com|e-marchespublics\.com|marches-securises\.fr|klekoon\.com)$/i;
const RE_CONNECTE = /d[ée]connexion|se\s+d[ée]connecter|logout|deconnect/i;
const RE_ROBOT = /g-recaptcha|recaptcha\/api|grecaptcha|h-captcha|hcaptcha\.com|cf-turnstile|challenges\.cloudflare\.com|frc-captcha|friendlycaptcha/i;

/* ---------- lecture des formulaires PRADO (Atexo), comme sur le serveur Vigie ---------- */
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
function donneesDeBase(html) {
  const d = new URLSearchParams();
  for (const c of champs(html)) {
    if (!c.name || c.tag !== "input") continue;
    if (/^(submit|button|image|file|reset|password)$/.test(c.type)) continue;
    if (/^(radio|checkbox)$/.test(c.type)) { if (c.checked) d.set(c.name, c.value || "on"); continue; }
    if (/^form\[/.test(c.name) || c.name === "keyWord") continue;
    d.set(c.name, c.value || "");
  }
  if (!d.has("PRADO_POSTBACK_PARAMETER")) d.set("PRADO_POSTBACK_PARAMETER", "");
  return d;
}
const trouve = (cs, re) => cs.find(c => re.test(c.name || "") || re.test(c.id || ""));
const versNom = s => (s || "").replace(/_/g, "$");
function captchaImage(html, base) {
  const champ = champs(html).find(c => c.tag === "input" && c.name && /^(text|tel|number)$/.test(c.type) && /captcha|securimage|code_?secu|codesecurite|code_?verif|codeverification|antispam/i.test(c.name + " " + (c.id || "")));
  if (!champ) return null;
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const s = attr(m[0], "src") || "";
    if (/captcha|securimage|codesecurite|antispam/i.test(s + " " + (attr(m[0], "id") || "") + " " + (attr(m[0], "class") || "") + " " + (attr(m[0], "alt") || ""))) return { champ: champ.name, src: /^data:/i.test(s) ? s : new URL(s, base).toString() };
  }
  return null;
}

async function page(url, opts = {}) {
  const rep = await fetch(url, { credentials: "include", redirect: "follow", ...opts, signal: AbortSignal.timeout(120000) });
  return rep;
}
async function poster(url, d) {
  return page(url, { method: "POST", body: d, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
}
function versBase64(octets) {
  let s = ""; const pas = 0x8000;
  for (let i = 0; i < octets.length; i += pas) s += String.fromCharCode.apply(null, octets.subarray(i, i + pas));
  return btoa(s);
}
async function imageCaptcha(cap) {
  if (/^data:/i.test(cap.src)) return cap.src;
  const rep = await page(cap.src);
  const type = (rep.headers.get("content-type") || "image/png").split(";")[0];
  return "data:" + (/^image\//.test(type) ? type : "image/png") + ";base64," + versBase64(new Uint8Array(await rep.arrayBuffer()));
}
function erreur(message, extra) { const e = new Error(message); Object.assign(e, extra || {}); return e; }

/* ---------- retrait du DCE sur une plateforme Atexo (PLACE, Maximilien, régionales) ---------- */
async function dceAtexo(base, id, org, ctx) {
  const lien = base + "/index.php?page=Entreprise.EntrepriseDemandeTelechargementDce&id=" + encodeURIComponent(id) + "&orgAcronyme=" + encodeURIComponent(org);
  ctx.etape("Ouverture de la page de retrait du DCE…");
  let rep = await page(lien), url = rep.url, html = await rep.text();
  if (!/PRADO_PAGESTATE/.test(html)) throw erreur("Page de retrait du DCE introuvable", { lien });
  const connecte = RE_CONNECTE.test(html);
  ctx.etape(connecte ? "Session ouverte sur la plateforme : retrait à votre nom" : "Pas de session ouverte : retrait anonyme");

  // 1. formulaire de demande (choix identifié / anonyme, conditions, CAPTCHA éventuel)
  let anonymeForce = false;
  for (let essai = 0; !/completeDownload/i.test(html) && essai < 5; essai++) {
    const cs = champs(html), d = donneesDeBase(html);
    const radios = cs.filter(c => c.type === "radio" && /RadioGroup|choix/i.test((c.name || "") + (c.id || "")));
    const anonyme = radios.find(c => /anonym/i.test((c.value || "") + (c.id || "")));
    const autre = radios.find(c => c !== anonyme);
    const choix = (!connecte || anonymeForce) ? (anonyme || null) : (autre || anonyme || null);
    if (choix) d.set(choix.name, choix.value || versNom(choix.id));
    else if (radios.length && !connecte) throw erreur("Cette consultation demande d'être connecté : connectez-vous à la plateforme puis relancez", { lien, connexion: true });
    for (const c of cs) if (c.type === "checkbox" && c.name && /accept|condition|cgu/i.test((c.name || "") + (c.id || ""))) d.set(c.name, c.value || "on");
    const cap = captchaImage(html, url);
    if (!cap && RE_ROBOT.test(html)) throw erreur("La plateforme demande de cocher « Je ne suis pas un robot » : faites-le sur la page de retrait", { lien, robot: true });
    if (cap) { const code = await ctx.captcha(await imageCaptcha(cap), essai > 0); if (code == null) throw erreur("Code de vérification non saisi", { lien }); d.set(cap.champ, code); }
    const valider = trouve(cs, /validateButton/i);
    d.set("PRADO_POSTBACK_TARGET", valider ? (valider.name || versNom(valider.id)) : "ctl0$CONTENU_PAGE$validateButton");
    ctx.etape("Validation de la demande…");
    rep = await poster(url, d); url = rep.url; html = await rep.text();
    if (!/PRADO_PAGESTATE/.test(html)) throw erreur("La plateforme a refusé la demande de DCE", { lien });
    if (/completeDownload/i.test(html)) break;
    if (captchaImage(html, url)) continue; // code refusé : nouvel essai
    if (connecte && !anonymeForce && anonyme) { anonymeForce = true; continue; } // formulaire identifié incomplet : on tente l'anonyme
    throw erreur("Lien de téléchargement du DCE absent (formulaire incomplet ou DCE réservé)", { lien });
  }

  // 2. téléchargement du DCE complet
  for (let essai = 0; essai < 4; essai++) {
    const cs = champs(html), d = donneesDeBase(html);
    const complet = trouve(cs, /completeDownload/i);
    const cap = captchaImage(html, url);
    if (cap) { const code = await ctx.captcha(await imageCaptcha(cap), essai > 0); if (code == null) throw erreur("Code de vérification non saisi", { lien }); d.set(cap.champ, code); }
    d.set("PRADO_POSTBACK_TARGET", complet ? (complet.name || versNom(complet.id)) : "ctl0$CONTENU_PAGE$EntrepriseDownloadDce$completeDownload");
    ctx.etape("Téléchargement du DCE…");
    rep = await poster(url, d);
    const type = rep.headers.get("content-type") || "";
    if (!/text\/html/i.test(type)) return { rep, lien };
    html = await rep.text(); url = rep.url;
    if (!captchaImage(html, url)) break;
  }
  throw erreur("La plateforme a renvoyé une page au lieu du fichier", { lien });
}

/* ---------- autres plateformes : mode assisté ----------
   L'extension ouvre la consultation dans un onglet (vous y êtes déjà connecté) ;
   dès que vous cliquez sur le téléchargement du DCE, elle en récupère une copie pour Vigie. */
async function dceAssiste(url, ctx) {
  const onglet = await chrome.tabs.create({ url, active: true });
  ctx.etape("La consultation est ouverte dans un nouvel onglet : cliquez sur « Télécharger le DCE » sur la plateforme. Vigie récupère le fichier automatiquement.");
  return new Promise((ok, ko) => {
    const fin = setTimeout(() => { nettoyer(); ko(erreur("Aucun téléchargement détecté dans les 15 minutes", { lien: url })); }, 15 * 60000);
    const surCreation = async item => {
      const src = item.finalUrl || item.url || "";
      if (!/^https:/i.test(src)) return;
      let h = ""; try { h = new URL(src).hostname; } catch (e) {}
      const depuisOnglet = item.referrer && (() => { try { return HOTES.test(new URL(item.referrer).hostname); } catch (e) { return false; } })();
      if (!HOTES.test(h) && !depuisOnglet) return;
      nettoyer();
      try {
        const rep = await page(src);
        if (!rep.ok || /text\/html/i.test(rep.headers.get("content-type") || "")) throw 0;
        ok({ rep, lien: url, nom: (item.filename || "").split(/[\\/]/).pop() });
      } catch (e) {
        ko(erreur("Le DCE est dans votre dossier Téléchargements, mais Vigie n'a pas pu en récupérer une copie : déposez-le à la main dans le dossier DCE", { lien: url, telecharge: true }));
      }
    };
    const surFermeture = tabId => { if (tabId === onglet.id) { /* l'utilisateur peut fermer l'onglet après avoir cliqué */ } };
    function nettoyer() { clearTimeout(fin); chrome.downloads.onCreated.removeListener(surCreation); chrome.tabs.onRemoved.removeListener(surFermeture); }
    chrome.downloads.onCreated.addListener(surCreation);
    chrome.tabs.onRemoved.addListener(surFermeture);
  });
}

/* ---------- dialogue avec Vigie (via content.js) ---------- */
const MORCEAU = 4 * 1024 * 1024;
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "vigie") return;
  let attenteCode = null, ferme = false;
  port.onDisconnect.addListener(() => { ferme = true; if (attenteCode) attenteCode(null); });
  const envoyer = m => { if (!ferme) port.postMessage(m); };
  const ctx = {
    etape: texte => envoyer({ type: "etape", texte }),
    captcha: (image, incorrect) => new Promise(ok => { attenteCode = c => { attenteCode = null; ok(c); }; envoyer({ type: "captcha", image, incorrect }); }),
  };
  port.onMessage.addListener(async m => {
    if (m.type === "code") { if (attenteCode) attenteCode(m.code == null ? null : String(m.code).slice(0, 40)); return; }
    if (m.type !== "dce") return;
    try {
      const q = m.demande || {};
      let r;
      if (q.origine && q.id && q.org) {
        const b = new URL(q.origine);
        if (b.protocol !== "https:" || !HOTES.test(b.hostname)) throw erreur("Plateforme non prise en charge par l'extension");
        if (!/^\d{1,10}$/.test(String(q.id)) || !/^[a-z0-9]{1,12}$/i.test(String(q.org))) throw erreur("Identifiant de consultation invalide");
        r = await dceAtexo(b.origin, String(q.id), String(q.org), ctx);
      } else if (q.url) {
        const u = new URL(q.url);
        if (u.protocol !== "https:" || !HOTES.test(u.hostname)) throw erreur("Plateforme non prise en charge par l'extension", { lien: q.url });
        r = await dceAssiste(u.toString(), ctx);
      } else throw erreur("Demande incomplète");
      const cd = r.rep.headers.get("content-disposition") || "";
      const nom = decodeURIComponent((cd.match(/filename\*=UTF-8''([^;]+)/i) || [])[1] || "") || (cd.match(/filename="?([^";]+)/i) || [])[1] || r.nom || "DCE.zip";
      const octets = new Uint8Array(await r.rep.arrayBuffer());
      envoyer({ type: "fichier", nom, mime: (r.rep.headers.get("content-type") || "application/octet-stream").split(";")[0], taille: octets.length });
      for (let i = 0; i < octets.length; i += MORCEAU) envoyer({ type: "morceau", b64: versBase64(octets.subarray(i, i + MORCEAU)) });
      envoyer({ type: "fin" });
    } catch (e) {
      envoyer({ type: "erreur", message: e.message || String(e), lien: e.lien || "", robot: !!e.robot, connexion: !!e.connexion, telecharge: !!e.telecharge });
    }
  });
});

/* ---------- sessions : état et maintien ---------- */
async function etatPlateformes() {
  const r = {};
  await Promise.all(PLATEFORMES.map(async p => {
    try {
      const rep = await page(p.accueil);
      const html = await rep.text();
      r[p.cle] = RE_CONNECTE.test(html) ? "connecte" : "deconnecte";
    } catch (e) { r[p.cle] = "injoignable"; }
  }));
  await chrome.storage.local.set({ etat: r, verifie: Date.now() });
  return r;
}
async function maintenir() {
  const { maintien = true } = await chrome.storage.local.get("maintien");
  if (maintien) await etatPlateformes();
}
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create("maintien", { periodInMinutes: 10 }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create("maintien", { periodInMinutes: 10 }));
chrome.alarms.onAlarm.addListener(a => { if (a.name === "maintien") maintenir(); });
chrome.runtime.onMessage.addListener((m, s, repondre) => {
  if (m && m.type === "etat") { etatPlateformes().then(etat => repondre({ etat, plateformes: PLATEFORMES })); return true; }
});
