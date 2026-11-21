// Vigie Marchés : lecture de la page d'une consultation (PLACE, Maximilien, achatpublic,
// e-marchespublics, AWS…) pour pré-remplir un marché ajouté à la main dans Vigie.
// Lecture par règles (libellés « Référence : », « Date limite de remise des plis : »…), sans IA.
"use strict";

const ENTITES = { nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", laquo: "«", raquo: "»", rsquo: "'", lsquo: "'", ldquo: "“", rdquo: "”", hellip: "…", ndash: "–", mdash: "—", euro: "€", deg: "°", oelig: "œ", OElig: "Œ", aelig: "æ", szlig: "ß", times: "×", middot: "·", bull: "•", shy: "", ordm: "º", sup2: "²" };
const ACCENTS = { acute: "́", grave: "̀", circ: "̂", uml: "̈", cedil: "̧", tilde: "̃", ring: "̊" };
function decoder(t) {
  return String(t || "")
    .replace(/&#x([0-9a-f]+);?/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, n) => {
      if (n in ENTITES) return ENTITES[n];
      const a = /^([a-z])(acute|grave|circ|uml|cedil|tilde|ring)$/i.exec(n);
      if (a) return (a[1] + ACCENTS[a[2].toLowerCase()]).normalize("NFC");
      return m;
    });
}
// même longueur que la ligne d'origine : minuscules sans accents, apostrophes unifiées
const plat = l => [...l].map(c => (c.normalize("NFD")[0] || c).toLowerCase()).join("").replace(/[’`´]/g, "'");

function lignesDe(html) {
  const corps = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|select|textarea|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/?(p|div|li|ul|ol|tr|td|th|table|tbody|thead|h[1-6]|dt|dd|dl|label|span|section|article|header|footer|strong|b|button|a|form|fieldset|legend|option)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decoder(corps).split("\n").map(l => l.replace(/[\s  ]+/g, " ").trim()).filter(l => l && l !== ":" && l !== "-");
}

const LIBRES = new Set();
const libre = re => LIBRES.has(re);
// Valeur après un libellé : sur la même ligne (« Libellé : valeur ») ou sur la (les) ligne(s) suivante(s)
function champ(lignes, plats, motifs, accepter) {
  for (const re of motifs) {
    for (let i = 0; i < lignes.length; i++) {
      const m = re.exec(plats[i]);
      if (!m || m.index !== 0) continue;
      const reste = lignes[i].slice(m[0].length);
      // « Organisme de droit public » n'est pas le libellé « Organisme » : après le libellé, il faut « : », « - » ou rien
      const apres = lignes[i].slice(m[0].replace(/\s+$/, "").length);
      if (!libre(re) && apres.trim() && !/^\s*[:：\-–]/.test(apres) && !/:\s*$/.test(m[0])) continue;
      let v = reste.replace(/^[\s:：\-–]+/, "").trim();
      let j = i;
      while (!v && j < i + 3 && j + 1 < lignes.length) { j++; v = lignes[j].replace(/^[\s:：]+/, "").trim(); }
      if (v && (!accepter || accepter(v))) return v;
    }
  }
  return "";
}

const MOIS = { jan: 1, fev: 2, feb: 2, mar: 3, avr: 4, apr: 4, mai: 5, may: 5, juin: 6, jun: 6, juil: 7, jul: 7, aou: 8, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
// Heure de Paris -> ISO UTC
function isoParis(y, mo, d, h, mi) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess)).map(x => [x.type, x.value]));
  const vu = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return new Date(guess - (vu - guess)).toISOString();
}
function lireDate(t) {
  const s = plat(t || "");
  let y, mo, d, h = 0, mi = 0, m;
  if ((m = /(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{1,2}):(\d{2}))?/.exec(s))) { y = +m[1]; mo = +m[2]; d = +m[3]; if (m[4]) { h = +m[4]; mi = +m[5]; } }
  else if ((m = /(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/.exec(s))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else if ((m = /(\d{1,2})[\/.](\d{1,2})[\/.](\d{2})(?!\d)/.exec(s))) { d = +m[1]; mo = +m[2]; y = 2000 + +m[3]; }
  else if ((m = /(\d{1,2})(?:er)?\s+(jan|fev|feb|mar|avr|apr|mai|may|juin|jun|juil|jul|aou|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})/.exec(s))) { d = +m[1]; mo = MOIS[m[2]]; y = +m[3]; }
  else return "";
  const reste = s.slice(m.index + m[0].length);
  const hm = !(m[4]) && /^\D{0,12}?(\d{1,2})\s*(?:h|:)\s*(\d{2})?/.exec(reste);
  if (hm) { h = +hm[1]; mi = +(hm[2] || 0); }
  if (!(y > 2000 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h < 24 && mi < 60)) return "";
  return isoParis(y, mo, d, h, mi);
}

const SUFFIXES_TITRE = /\s*[-|–]\s*(e-marchespublics|achatpublic\.com|la salle des march[ée]s|place|portail des march[ée]s publics|maximilien|aws|marches-publics\.info|d[ée]tail d'une consultation|fiche de la consultation)\b.*$/i;
const TITRES_VIDES = /^(d[ée]tails? (de l'avis|de la consultation|d'une consultation)|fiche de la consultation|accueil|connexion|recherche|consultation|avis)$|d[ée]tail d'une (annonce|consultation)|aw solutions/i;
const RE_REMISE = /^(remise|depot|reception) des (plis|offres)( au plus tard)?( avant le| le)?\s*:?\s*/;
LIBRES.add(RE_REMISE);

function extraireFiche(html, url) {
  const lignes = lignesDe(html);
  const plats = lignes.map(plat);
  const texte = lignes.join("\n");
  const r = {};
  const pasDate = v => !/^\d{1,2}[\/.]\d{1,2}[\/.]\d{4}/.test(v);

  r.objet = champ(lignes, plats, [/^intitule( de la consultation| du marche)?\s*:?/, /^titre\s*:/, /^objet (du marche|de la consultation)\s*:/, /^objet( du marche)?\s*:?/], v => v.length >= 6 && v.length < 400 && !/^(du|de la|:)\b/i.test(v));
  if (!r.objet) {
    for (const m of html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)) {
      const t = decoder(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
      if (t.length >= 10 && !TITRES_VIDES.test(t)) { r.objet = t; break; }
    }
  }
  if (!r.objet) {
    const t = decoder(((html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)/i) || [])[1]) || ((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]) || "").replace(/\s+/g, " ").trim().replace(SUFFIXES_TITRE, "");
    if (t.length >= 10 && !TITRES_VIDES.test(t)) r.objet = t;
  }
  r.acheteur = champ(lignes, plats, [/^organisme( acheteur)?\s*:?/, /^nom officiel\s*:?/, /^(nom de l'|l')?acheteur( public)?\s*:/, /^pouvoir adjudicateur\s*:/, /^entite (d'achat|publique)\s*:?/], v => v.length >= 3 && v.length < 250);
  r.limite = lireDate(champ(lignes, plats, [
    /^date (et heure )?limite (de |d')?(remise|depot|reception|reponse)( des| de)?( plis| offres| candidatures)?( et des offres)?(\s*\(heure de paris\))?\s*:?/,
    /^date (et heure )?limite(\s*\(heure de paris\))?\s*:?/,
    RE_REMISE,
    /^(offres|remise des offres|date de remise des offres)\s*:?/,
  ], v => !!lireDate(v)));
  r.reference = champ(lignes, plats, [/^reference( de la consultation| du marche| acheteur| de l'avis)?\s*:?/, /^n(°|o|um[ée]ro) de (la )?consultation\s*:?/], v => v.length <= 60 && !/^date/i.test(v) && pasDate(v));
  r.procedure = champ(lignes, plats, [/^(type de )?procedure( de passation)?\s*:/, /^mode( de passation)?\s*:?/], v => v.length < 120);
  const nature = plat(champ(lignes, plats, [/^categorie( principale)?\s*:?/, /^nature (principale )?(des prestations|du marche)\s*:?/, /^type de marche\s*:?/, /^nature\s*:/], v => /travaux|services?|fournitures?/i.test(v)));
  r.type = /travaux/.test(nature) ? "TRAVAUX" : /fourniture/.test(nature) ? "FOURNITURES" : /service/.test(nature) ? "SERVICES" : "";
  // bloc acheteur sans libellé (AWS) : nom, contact, adresse, « 75017 PARIS », Tél, SIRET
  let cpAch = "";
  for (let i = 0; i < lignes.length; i++) {
    const a = /^(?:.*\s)?(\d{5})\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ' \-]{1,40})$/.exec(lignes[i].replace(/^bp\s*\d+\s*-\s*/i, ""));
    if (!a || !lignes.slice(Math.max(0, i - 3), i + 4).some(l => /t[ée]l\b|siret|m[ée]l\b|courriel|fax/i.test(l))) continue;
    cpAch = a[1];
    if (!r.villeAcheteur) r.villeAcheteur = a[2].trim().toLowerCase().replace(/(^|[\s\-'])\p{L}/gu, x => x.toUpperCase());
    if (!r.acheteur) for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
      const l = lignes[j];
      if (/\d|^(m|mme|mr|monsieur|madame|m\.)\b|\b(rue|avenue|boulevard|place|bp|cs|cedex|t[ée]l|directeur|directrice)\b/i.test(l) || l.length < 2 || l.length > 120 || /:/.test(l)) continue;
      r.acheteur = l; break;
    }
    break;
  }
  r.lieu = champ(lignes, plats, [/^lieu (principal )?d'execution( et de livraison)?\s*:?/, /^lieu de livraison\s*:?/], v => v.length < 250);
  r.description = champ(lignes, plats, [/^objet\s*:/, /^description( succincte)?( du marche)?\s*:?/], v => v.length > 20).slice(0, 1500);
  r.villeAcheteur = champ(lignes, plats, [/^ville\s*:/, /^localite\s*:/], v => v.length < 60) || r.villeAcheteur || "";
  if (!r.villeAcheteur && r.lieu) { const v = /\b\d{5}\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ' \-]{1,40}?)(?=\s*[(,;–\-]|\s*$)/.exec(r.lieu); if (v) r.villeAcheteur = v[1].trim(); }
  const cp = champ(lignes, plats, [/^code postal\s*:/], v => /^\d{5}$/.test(v)) || cpAch || ((r.lieu || "").match(/\b(\d{5})\b/) || [])[1] || ((r.lieu || "").match(/\((\d{2,3}|2[ab])\)/i) || [])[1] || "";
  r.departement = cp ? (/^9[78]/.test(cp) ? cp.slice(0, 3) : /^20/.test(cp) && cp.length === 5 ? (+cp < 20200 ? "2A" : "2B") : cp.slice(0, 2).toUpperCase()) : "";
  r.cpv = [...new Set(lignes.flatMap((l, i) => /cpv/i.test(l) ? [l, lignes[i + 1] || ""] : []).join(" ").match(/\b\d{8}\b/g) || [])].slice(0, 12);
  r.accordCadre = /accord[- ]cadre/i.test(texte);
  for (const k of Object.keys(r)) if (r[k] === "" || (Array.isArray(r[k]) && !r[k].length)) delete r[k];
  r.trouves = ["objet", "acheteur", "limite", "reference", "lieu"].filter(k => r[k]).length;
  return r;
}

if (typeof module !== "undefined") module.exports = { extraireFiche, lireDate, lignesDe };
