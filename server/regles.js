// Vigie Marchés : analyse « mécanique » (gratuite, sans IA) du règlement de consultation.
// Lit le texte du RC et en extrait, par des règles, les informations clés.
"use strict";

/* ---------- texte d'un PDF (pdf.js) ---------- */
let pdfjs = null;
async function textePdf(buf) {
  if (!pdfjs) pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
  const pages = [];
  const n = Math.min(doc.numPages, 150);
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    // regroupe les morceaux par ligne (même ordonnée)
    const lignes = [];
    let cur = null;
    for (const it of tc.items) {
      if (!("str" in it)) continue;
      const y = Math.round(it.transform[5]);
      if (!cur || Math.abs(cur.y - y) > 3) { cur = { y, x: it.transform[4], t: "" }; lignes.push(cur); }
      cur.t += (cur.t && !/\s$/.test(cur.t) && !/^\s/.test(it.str) && it.transform[4] - cur.fin > 1.5 ? " " : "") + it.str;
      cur.fin = it.transform[4] + (it.width || 0);
      if (it.hasEOL) cur = null;
    }
    pages.push(lignes.map(l => l.t.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n"));
    page.cleanup();
  }
  await doc.destroy();
  return pages.join("\n\n");
}

/* ---------- outils ---------- */
// version minuscule sans accents, de même longueur que le texte d'origine
const plat = t => t.replace(/[\u{10000}-\u{10FFFF}]/gu, "?").split("").map(c => (c.normalize("NFD")[0] || c).toLowerCase()).join("").replace(/[’‘]/g, "'");
const net = s => s.replace(/\s+/g, " ").replace(/^[\s\-–•·*o>)\]:.,;]+/, "").replace(/[\s:;,\-–]+$/, "").trim();
// ligne de titre (« Article 4 - Durée », « 3.2 CRITÈRES… »)
const estTitre = l => { l = l.trim(); return l.length > 0 && l.length < 100 && !/[.;:,]$/.test(l) && (/^(article|chapitre|titre|partie|section)\b/i.test(l) || /^\d+(\.\d+)*\s*[-.)–]?\s+\S/.test(l) || (l === l.toUpperCase() && /[A-Z]{4}/.test(l))); };
const ligneAvant = (T, d) => T.slice(T.lastIndexOf("\n", d - 2) + 1, d - 1);
// phrase autour d'une position
function phrase(T, i, avant = 200, apres = 260) {
  let d = i, f = i;
  const minD = Math.max(0, i - avant), maxF = Math.min(T.length, i + apres);
  while (d > minD && !/[.;!?]\s|\n\n/.test(T.slice(d - 2, d)) && !(T[d - 1] === "\n" && estTitre(ligneAvant(T, d)))) d--;
  // si la position est dans une ligne de titre, on commence après le titre
  const finLigne = T.indexOf("\n", d);
  if (finLigne > 0 && finLigne < i + 80 && estTitre(T.slice(d, finLigne)) && finLigne < maxF - 20) d = finLigne + 1;
  while (f < maxF && !/^([.;!?](\s|$)|\n\n)/.test(T.slice(f, f + 2)) && !(T[f] === "\n" && estTitre(T.slice(f + 1, T.indexOf("\n", f + 1) >>> 0)))) f++;
  return net(T.slice(d, f + 1));
}
const uniques = (l, cle = x => plat(x).replace(/[^a-z0-9]/g, "")) => { const v = new Set(); return l.filter(x => { const k = cle(x); if (!k || v.has(k)) return false; v.add(k); return true; }); };

/* ---------- montants ---------- */
const RE_MONTANT = /(\d{1,3}(?:[  . ]\d{3})+|\d{4,})(?:,\d{1,2})?\s*(?:€|euros?|eur\b)\s*(?:\(?\s*(HT|H\.T\.?|TTC|T\.T\.C\.?|hors taxes?|toutes taxes comprises)\s*\)?)?/gi;
function montants(T, P) {
  const r = { min: [], max: [], est: [] };
  for (const m of T.matchAll(RE_MONTANT)) {
    const avant = P.slice(Math.max(0, m.index - 160), m.index);
    const val = m[0].replace(/\s+/g, " ").replace(/hors taxes?/i, "HT").replace(/toutes taxes comprises/i, "TTC").trim();
    const proche = avant.slice(-90);
    const dernier = (re) => { let k = -1; for (const x of proche.matchAll(re)) k = x.index; return k; };
    const kMin = dernier(/minimum|minimal|au moins/g), kMax = dernier(/maximum|maximal|plafond|ne (pourra|peut) (pas )?exceder|au plus/g), kEst = dernier(/estim|previsionnel|enveloppe|montant (global|total) (du|des) (marche|travaux)|budget/g);
    const best = Math.max(kMin, kMax, kEst);
    if (best < 0) continue;
    if (/chiffre d'affaires|capital|assurance|garantie|penalit|sous-traitance|avance/.test(proche.slice(Math.max(0, best - 40)))) continue;
    const ctx = avant.slice(Math.max(avant.lastIndexOf("\n"), avant.lastIndexOf(". ")) + 1);
    const lot = (ctx.match(/lot\s*(?:n[°o]\s*)?(\d{1,2})\b(?![\s\S]*lot\s*(?:n[°o]\s*)?\d)/) || [])[1];
    const v = (lot ? "Lot " + lot + " : " : "") + val;
    (best === kMin ? r.min : best === kMax ? r.max : r.est).push(v);
  }
  if (/sans (montant )?minimum/.test(P)) r.min.unshift("Sans minimum");
  if (/sans (montant )?maximum/.test(P)) r.max.unshift("Sans maximum");
  const f = l => uniques(l).slice(0, 5).join(" ; ");
  return { montant_min: f(r.min), montant_max: f(r.max), montant_estime: f(r.est) };
}

/* ---------- critères de notation ---------- */
const RE_POIDS = /(\d{1,3}(?:[.,]\d{1,2})?)\s*(%|pour ?cent|points?\b|pts\b|\/\s*(?:100|20|10)\b)/i;
function criteres(T, P) {
  const titres = /crit[e]res? (d'|de |d )?(attribution|jugement|selection des offres|choix|notation|evaluation)|jugement des offres|analyse des offres|attribution du marche|classement des offres|ponderation/g;
  let meilleur = null;
  for (const t of P.matchAll(titres)) {
    const debut = t.index, fen = T.slice(debut, debut + 3500);
    const lignes = fen.split("\n");
    const items = [];
    let prec = "";
    for (let li = 0; li < lignes.length; li++) {
      const l = lignes[li];
      const lp = plat(l);
      if (li > 0 && items.length && /^\s*(article|\d{1,2}\s*[-.]\s*[a-z]|chapitre)\b/i.test(lp) && !RE_POIDS.test(l) && items.length >= 2) break;
      const mm = l.match(RE_POIDS);
      if (!mm || /\b(tva|avance|retenue|penalit|rabais|remise)\b/i.test(lp)) { if (net(l)) prec = l; continue; }
      if (/^\s*\d{1,3}\s*(%|points?)\s*$/.test(l) === false && /\b(19|20)\d{2}\b/.test(l) && !/%/.test(l)) continue;
      let lib = net(l.slice(0, mm.index).replace(/^\s*\d{1,2}\s*[.)]\s+/, "").replace(/crit[eè]re\s*(n[°o]\s*)?\d*\s*[:\-–]?/i, "").replace(/\b(pond[ée]r[ée]e? (à|a)|pond[ée]ration( de)?|not[ée]e? sur|soit)\s*$/i, "").replace(/[(:]\s*$/, ""));
      if (lib.length < 3) lib = net(prec);
      if (lib.length < 3) continue;
      if (lib.length > 140) lib = lib.slice(0, 140) + "…";
      const sous = /^\s*([-–•·*o▪►]|\d+\.\d+|[a-z]\)|sous[- ]crit)/i.test(l) || /sous[- ]crit/i.test(lp);
      items.push({ lib, poids: mm[1].replace(".", ",") + (/%|cent/i.test(mm[2]) ? " %" : /\//.test(mm[2]) ? " " + mm[2].replace(/\s/g, "") : " points"), val: parseFloat(mm[1].replace(",", ".")), sous });
      prec = "";
    }
    if (items.length >= 2 && (!meilleur || items.length > meilleur.length)) { meilleur = items; if (items.filter(x => !x.sous).length >= 2) break; }
  }
  if (!meilleur) return [];
  // regroupe : critères principaux (somme 100) et sous-critères
  const res = [];
  let somme = 0;
  for (const it of meilleur) {
    const principal = res.length === 0 || (!it.sous && somme + it.val <= 100.01) || (somme >= 99.99 && !it.sous && false);
    if (principal && somme < 99.99) { res.push({ critere: it.lib, ponderation: it.poids, sous_criteres: [] }); somme += it.val; }
    else if (res.length) res[res.length - 1].sous_criteres.push(it.lib + " : " + it.poids);
  }
  return res.slice(0, 12);
}

/* ---------- qualifications ---------- */
const QUALIFS = [
  [/qualibat/g, "Qualibat"], [/qualifelec/g, "Qualifelec"], [/qualipac/g, "QualiPAC"], [/qualit'?enr/g, "Qualit'EnR"], [/qualipv/g, "QualiPV"], [/qualisol/g, "QualiSol"], [/qualibois/g, "QualiBois"], [/qualigaz/g, "Qualigaz"],
  [/\brge\b|reconnu garant/g, "RGE"], [/opqibi/g, "OPQIBI"], [/opqtecc/g, "OPQTECC"], [/opqcm/g, "OPQCM"], [/qualipaysage/g, "Qualipaysage"], [/qualiprop/g, "Qualipropre"], [/qualiopi/g, "Qualiopi"],
  [/\biso\s?(9001|14001|45001|50001|27001)/g, "ISO"], [/\bmase\b/g, "MASE"], [/certibat/g, "Certibat"], [/\bapsad\b/g, "APSAD"], [/\bcnaps\b/g, "CNAPS"], [/\bcaces\b/g, "CACES"],
  [/habilitations? electriques?/g, "Habilitation électrique"], [/sous[- ]section (3|4)|\bss ?(3|4)\b/g, "Amiante"], [/\bnf habitat\b/g, "NF Habitat"], [/certification (professionnelle|qualite)/g, "Certification"], [/attestation de capacite|fluides? frigorig/g, "Attestation de capacité (fluides frigorigènes)"],
];
function qualifications(T, P) {
  const r = [];
  for (const [re, nom] of QUALIFS) {
    for (const m of P.matchAll(re)) {
      // extrait jusqu'à la fin de la proposition
      let f = m.index; const fin = Math.min(T.length, m.index + 170);
      while (f < fin && !/^(;|\.\s|\n\n|\n\s*[-–•·*▪])/.test(T.slice(f, f + 3))) f++;
      let s = net(T.slice(m.index, f));
      if (nom === "Qualibat" || nom === "Qualifelec" || nom === "OPQIBI") { const codes = s.match(/\b\d{2,4}\b/g); if (!codes) s = s.slice(0, 80); }
      if (s.length > 160) s = s.slice(0, 160) + "…";
      if (s.length >= 3) r.push(s);
      if (r.filter(x => plat(x).startsWith(nom.toLowerCase().slice(0, 5))).length >= 4) break;
    }
  }
  const u = uniques(r);
  return u.filter(x => !u.some(y => y !== x && y.length > x.length && plat(y).includes(plat(x)))).slice(0, 14);
}

/* ---------- autres rubriques ---------- */
const PROCEDURES = [
  [/procedure adaptee|\bmapa\b/, "Procédure adaptée (MAPA)"], [/appel d'offres? ouvert/, "Appel d'offres ouvert"], [/appel d'offres? restreint/, "Appel d'offres restreint"],
  [/procedure avec negociation/, "Procédure avec négociation"], [/dialogue competitif/, "Dialogue compétitif"], [/sans publicite ni mise en concurrence/, "Marché sans publicité ni mise en concurrence"], [/concours/, "Concours"],
];
function typeMarche(P) {
  const l = [];
  if (/accord[- ]cadre/.test(P)) {
    let s = "Accord-cadre";
    if (/bons? de commande/.test(P)) s += " à bons de commande";
    if (/marches? subsequents?/.test(P)) s += (/bons? de commande/.test(P) ? " et" : "") + " à marchés subséquents";
    if (/multi[- ]?attributaire/.test(P)) s += ", multi-attributaire"; else if (/mono[- ]?attributaire/.test(P)) s += ", mono-attributaire";
    l.push(s);
  } else l.push("Marché ordinaire");
  if (/tranches? optionnelles?/.test(P)) l.push("avec tranche(s) optionnelle(s)");
  if (/prestations? supplementaires? eventuelles?|\bpse\b/.test(P)) l.push("PSE possibles");
  const n = { travaux: (P.match(/\btravaux\b/g) || []).length, services: (P.match(/\bservices?\b|prestations? de service/g) || []).length, fournitures: (P.match(/\bfournitures?\b/g) || []).length };
  const nature = Object.entries(n).sort((a, b) => b[1] - a[1])[0];
  return (nature[1] ? nature[0][0].toUpperCase() + nature[0].slice(1) + " · " : "") + l.join(", ");
}
function premierePhrase(T, P, re, filtre) {
  for (const m of P.matchAll(re)) { const s = phrase(T, m.index); if (!filtre || filtre(plat(s))) return s.length > 300 ? s.slice(0, 300) + "…" : s; }
  return "";
}
function lots(T) {
  const r = new Map();
  for (const m of T.matchAll(/(?:^|\n)\s*lot\s*(?:n\s*[°ºo]\.?\s*)?(\d{1,2})\s*[:\-–.)]\s*([^\n]{3,140})/gi)) {
    const t = net(m[2].replace(/\.{3,}.*$/, ""));
    if (!r.has(m[1]) && t.length >= 3 && !/^\d+$/.test(t)) r.set(m[1], t);
  }
  return [...r].slice(0, 40).map(([n, t]) => ({ numero: "Lot " + n, intitule: t, montant: "" }));
}
const METIERS = [["plomberie", "Plomberie"], ["chauffage", "Chauffage"], ["ventilation", "Ventilation"], ["climatisation", "Climatisation"], ["electricite", "Électricité"], ["courants faibles", "Courants faibles"], ["maconnerie", "Maçonnerie"], ["gros oeuvre", "Gros œuvre"], ["gros-oeuvre", "Gros œuvre"], ["charpente", "Charpente"], ["couverture", "Couverture"], ["etancheite", "Étanchéité"], ["menuiseries? exterieures?", "Menuiseries extérieures"], ["menuiseries? interieures?", "Menuiseries intérieures"], ["serrurerie", "Serrurerie"], ["metallerie", "Métallerie"], ["platrerie", "Plâtrerie"], ["cloisons", "Cloisons, doublages"], ["faux[- ]plafonds?", "Faux plafonds"], ["peinture", "Peinture"], ["revetements? de sols?", "Revêtements de sols"], ["carrelage", "Carrelage"], ["facades?|ravalement", "Façades, ravalement"], ["isolation", "Isolation"], ["vrd|voirie", "VRD, voirie"], ["espaces verts", "Espaces verts"], ["desamiantage|amiante", "Désamiantage"], ["demolition", "Démolition"], ["ascenseurs?", "Ascenseurs"], ["nettoyage", "Nettoyage"], ["terrassement", "Terrassement"], ["photovoltaique", "Photovoltaïque"], ["securite incendie|ssi\\b", "Sécurité incendie"], ["cvc\\b", "CVC"]];
function corpsEtat(texte) {
  const P = plat(texte);
  return uniques(METIERS.filter(([re]) => new RegExp("\\b(" + re + ")").test(P)).map(x => x[1])).slice(0, 15);
}
const ATTENTION = [
  [/visite (des lieux |du site |sur site )?(est )?obligatoire|visite obligatoire/, "Visite obligatoire"],
  [/variantes? (ne sont pas|n'est pas|sont interdites|non autorisees|ne sont pas autorisees)/, "Variantes interdites"],
  [/variantes? (sont|est) (autorisees?|admises?|acceptees?)/, "Variantes autorisées"],
  [/(se reserve|pourra|peut) (le droit )?(d'attribuer le marche sur la base des offres initiales sans negociation|negocier|engager des negociations)/, "Négociation possible"],
  [/echantillons?/, "Échantillons demandés"],
  [/clause (sociale|d'insertion)|insertion professionnelle|heures d'insertion/, "Clause sociale / insertion"],
  [/clause environnementale|developpement durable|bilan carbone/, "Clause environnementale"],
  [/\bbim\b|maquette numerique/, "BIM / maquette numérique"],
  [/memoire technique/, "Mémoire technique à fournir"],
  [/penalites? de retard/, "Pénalités de retard"],
  [/retenue de garantie/, "Retenue de garantie"],
  [/\bavance\b/, "Avance prévue"],
  [/signature electronique/, "Signature électronique"],
  [/groupement solidaire|groupement conjoint/, "Groupement : forme imposée"],
  [/periode de preparation/, "Période de préparation"],
  [/dume/, "DUME accepté"],
];
function pointsAttention(T, P) {
  const r = [];
  for (const [re, lib] of ATTENTION) {
    const m = re.exec(P);
    if (m) { let s = phrase(T, m.index, 120, 200); if (s.length > 220) s = s.slice(0, 220) + "…"; r.push(lib + " : " + s); }
  }
  return r.slice(0, 12);
}
function capacites(T, P) {
  const r = [];
  for (const re of [/chiffre d'affaires (global |annuel |minimum |minimal )*(minimum|minimal|d'au moins|superieur|egal|de)/g, /references? (similaires|de moins de|datant|d'operations|de travaux|de prestations) /g, /effectifs? (moyens? )?annuels?/g, /assurance (de )?(responsabilite civile|decennale|rc pro)/g]) {
    const m = re.exec(P);
    if (m) { let s = phrase(T, m.index, 80, 220); if (s.length > 240) s = s.slice(0, 240) + "…"; r.push(s); }
  }
  return uniques(r);
}
function attendus(T, P) {
  const r = [];
  for (const re of [/objet (de la consultation|du marche|de l'accord[- ]cadre|du contrat)/g, /(la presente consultation|le present marche|l'accord[- ]cadre) (a pour objet|porte sur|concerne)/g]) {
    for (const m of P.matchAll(re)) {
      let d = m.index;
      const fl = T.indexOf("\n", d);
      if (fl > 0 && estTitre(T.slice(T.lastIndexOf("\n", d) + 1, fl))) d = fl + 1;
      const lignes = [];
      for (const l of T.slice(d, d + 900).split("\n")) { if (lignes.length && (estTitre(l) || !l.trim())) break; lignes.push(l); }
      const s = net(lignes.join(" "));
      if (s.length > 60 && !/\.{4,}/.test(s)) { r.push(s.length > 500 ? s.slice(0, 500) + "…" : s); break; }
    }
    if (r.length) break;
  }
  return r;
}

/* ---------- analyse complète ---------- */
function analyserTexte(T) {
  T = T.replace(/\r/g, "").replace(/[  ]/g, " ").replace(/[ \t]+/g, " ");
  const P = plat(T);
  const mt = montants(T, P);
  const crit = criteres(T, P);
  const qual = qualifications(T, P);
  const proc = (PROCEDURES.find(([re]) => re.test(P)) || [])[1] || "";
  const type = typeMarche(P);
  const duree = premierePhrase(T, P, /dur[e]e (du marche|de l'accord|du contrat|initiale|globale|d'execution)|delai (global )?d'execution|reconductible/g, s => /\d|un an|deux ans|trois ans|quatre ans|mois|annee/.test(s));
  const visite = premierePhrase(T, P, /visite (des lieux|du site|sur site|obligatoire|facultative|preal)/g);
  const date = premierePhrase(T, P, /dates? (et heures? )?limites? (de |d')?(la )?(reception|remise|depot)/g, s => /\d{1,2}[\/ .]\d{1,2}[\/ .]\d{2,4}|\d{1,2} (janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)/.test(s));
  const lotsL = lots(T);
  const s = {
    type_marche: type, procedure: proc, attendus: attendus(T, P),
    corps_etat: corpsEtat(lotsL.map(l => l.intitule).join(" ") || T.slice(0, 20000)),
    lots: lotsL, criteres: crit, qualifications: qual, capacites: capacites(T, P),
    ...mt, duree, visite, date_limite: date, points_attention: pointsAttention(T, P),
  };
  const morceaux = [type + (proc ? ", " + proc.charAt(0).toLowerCase() + proc.slice(1) : "") + "."];
  if (lotsL.length) morceaux.push(lotsL.length + " lot" + (lotsL.length > 1 ? "s" : "") + ".");
  if (mt.montant_max || mt.montant_estime) morceaux.push((mt.montant_max ? "Maximum : " + mt.montant_max : "Estimation : " + mt.montant_estime) + ".");
  if (crit.length) morceaux.push("Critères : " + crit.map(c => c.critere.split(/[(:,]/)[0].trim() + " " + c.ponderation).join(", ") + ".");
  if (qual.length) morceaux.push("Qualifications citées : " + uniques(qual.map(q => q.split(/[\s,(]/)[0])).join(", ") + ".");
  if (/visite obligatoire|visite (des lieux |du site )?(est )?obligatoire/.test(P)) morceaux.push("Visite obligatoire.");
  s.synthese = morceaux.join(" ");
  return s;
}

module.exports = { textePdf, analyserTexte };
