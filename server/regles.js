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
const plat = t => t.replace(/[\u{10000}-\u{10FFFF}]/gu, "??").split("").map(c => (c.normalize("NFD")[0] || c).toLowerCase()).join("").replace(/[’‘ʼ]/g, "'");
const net = s => s.replace(/\s+/g, " ").replace(/^([\s\-–—•·*>)\]:.,;➢▪►✓]|o\s)+/, "").replace(/[\s:;,\-–]+$/, "").trim();
const coupe = (s, n) => s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") + "…" : s;
const uniques = (l, cle = x => plat(x).replace(/[^a-z0-9]/g, "")) => { const v = new Set(); return l.filter(x => { const k = cle(x); if (!k || v.has(k)) return false; v.add(k); return true; }); };
const MOIS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];

/* ---------- nettoyage du texte ----------
   Retire le sommaire (lignes à points de suite), les en-têtes et pieds de page répétés,
   les numéros de page, et recolle les mots coupés en fin de ligne. */
function nettoyer(brut) {
  let T = String(brut || "").replace(/\r/g, "").replace(/[   ]/g, " ").replace(/[​­\uE000-\uF8FF]/g, "").replace(/\t/g, " ").replace(/ {2,}/g, " ");
  T = T.replace(/(\p{L})- ?\n(\p{Ll})/gu, "$1$2");
  const lignes = T.split("\n").map(l => l.trim());
  const cle = l => plat(l).replace(/\d+/g, "#").replace(/\s+/g, " ");
  // en-têtes et pieds de page : lignes répétées, situées près d'un saut de page (ligne vide)
  const vides = lignes.map((l, i) => !l || i === 0 || i === lignes.length - 1);
  const pres = i => { for (let k = Math.max(0, i - 4); k <= Math.min(lignes.length - 1, i + 4); k++) if (vides[k]) return true; return false; };
  const compte = new Map();
  lignes.forEach((l, i) => { if (l.length > 3 && l.length < 160 && pres(i)) { const k = cle(l); compte.set(k, (compte.get(k) || 0) + 1); } });
  const garde = lignes.filter((l, i) => {
    if (/\.{4,}|…{2,}|(\. ){4,}|_{6,}/.test(l)) return false; // sommaire, lignes de signature
    if (/^(page\s*)?\d{1,3}\s*(\/|sur)\s*\d{1,3}$/i.test(l) || /^-?\s*\d{1,3}\s*-?$/.test(l)) return false; // numéros de page
    if (l.length > 3 && l.length < 160 && pres(i) && compte.get(cle(l)) >= 3 && !/%|points?\b/i.test(l) && !/^lot\b/i.test(l)) return false; // en-têtes, pieds de page
    return true;
  });
  return garde.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* ---------- titres et sections ---------- */
// « ARTICLE 4 - DURÉE », « 3.2 Critères… », « 2-6 VARIANTES », « CHAPITRE II »
function niveauTitre(l) {
  if (l.length < 3 || l.length > 130) return 0;
  if (/^(article|chapitre|titre|partie)\s*(\d+|premier|1er|[ivx]+)\b/i.test(l)) return /^article/i.test(l) ? 1 : 0.5;
  let m = l.match(/^(\d{1,2}(?:[.\-]\d{1,2}){0,4})[.)]?\s*[-–—:.)]?\s*(\S.*)$/);
  if (m && /^[A-ZÀ-ÖØ-Ý«"“]/.test(m[2]) && !/^\d{4}$/.test(m[1]) && !/[;,]$/.test(l)) {
    const n = m[1].split(/[.\-]/).length;
    if (n === 1 && !(m[2] === m[2].toUpperCase() && /[A-Z]{3}/.test(m[2]))) return 0; // « 1 Une déclaration… » n'est pas un titre
    if (/\b(points?|%|€|euros?)\b/i.test(m[2]) && /\d/.test(m[2])) return 0;
    return 1 + (n - 1) * 0.5 + (n === 1 ? 0 : 0);
  }
  if (l === l.toUpperCase() && /[A-ZÀ-Ý]{4}/.test(l) && !/[.;,]$/.test(l) && l.split(/\s+/).length >= 2 && l.length < 90 && !/\d{2}[ .]?\d{2}[ .]?\d{2}/.test(l)) return 2.5;
  return 0;
}
function decouper(T) {
  const titres = [];
  let pos = 0;
  for (const l of T.split("\n")) {
    const n = niveauTitre(l);
    if (n) titres.push({ debut: pos, finTitre: pos + l.length, niveau: n, titre: l, p: plat(l) });
    pos += l.length + 1;
  }
  for (let i = 0; i < titres.length; i++) {
    let j = i + 1;
    while (j < titres.length && titres[j].niveau > titres[i].niveau) j++;
    titres[i].fin = j < titres.length ? titres[j].debut : T.length;
    titres[i].finCourte = i + 1 < titres.length ? titres[i + 1].debut : T.length;
  }
  return titres;
}
// texte de la première section dont le titre correspond (sous-sections comprises)
function section(ctx, re, { max = 6000, exclure } = {}) {
  for (const t of ctx.titres) {
    if (!re.test(t.p) || (exclure && exclure.test(t.p))) continue;
    const corps = ctx.T.slice(t.finTitre, Math.min(t.fin, t.finTitre + max)).trim();
    if (corps.length > 3) return { texte: corps, debut: t.finTitre, titre: t.titre };
  }
  return null;
}
// découpe en phrases (fin de phrase ou fin de paragraphe)
function phrases(texte) {
  return texte.replace(/\n(?=[•▪➢►\-–]\s|\d+[.)]\s|[a-z]\)\s)/g, "\n\n").split(/(?<=[.;!?])\s+(?=[A-ZÀ-Ý«•▪➢\-–\d])|\n\s*\n/).map(s => s.replace(/\s+/g, " ").trim()).filter(s => s.length > 2);
}
const sansTitres = texte => texte.split("\n").map(l => niveauTitre(l.trim()) ? "" : l).join("\n");
function phraseAvec(texte, re, filtre) {
  for (const s of phrases(sansTitres(texte))) { const p = plat(s); if (re.test(p) && (!filtre || filtre(p))) return net(s); }
  return "";
}
// phrase autour d'une position du texte (sans couper un mot)
function phrase(T, i, avant = 220, apres = 280) {
  let d = i, f = i;
  const minD = Math.max(0, i - avant), maxF = Math.min(T.length, i + apres);
  while (d > minD && !/[.;!?]\s|\n\n/.test(T.slice(d - 2, d))) d--;
  if (d === minD && d > 0) { const e = T.indexOf(" ", d); d = e > 0 && e < i ? e + 1 : d; }
  while (f < maxF && !/^([.;!?](\s|$)|\n\n)/.test(T.slice(f, f + 2))) f++;
  return net(T.slice(d, f + 1));
}

/* ---------- dates ---------- */
const RE_DATE_NUM = /\b(\d{1,2})\s?[\/.\-]\s?(\d{1,2})\s?[\/.\-]\s?(\d{4}|\d{2})\b/;
const RE_DATE_LET = new RegExp("\\b(\\d{1,2})(?:er)?\\s+(" + MOIS.join("|") + ")(?:\\s+(\\d{4}))?");
const RE_HEURE = /(?:a|avant|,)?\s*(\d{1,2})\s*(?:h|heures?|:)\s*(\d{2})?\b/;
// première date d'un texte « plat » : { date: "JJ/MM/AAAA", heure: "12h00", index }
function lireDate(p) {
  const a = p.match(RE_DATE_NUM), b = p.match(RE_DATE_LET);
  let r = null;
  if (a && (!b || a.index <= b.index) && +a[1] <= 31 && +a[2] <= 12) r = { date: a[1].padStart(2, "0") + "/" + a[2].padStart(2, "0") + "/" + (a[3].length === 2 ? "20" + a[3] : a[3]), index: a.index, fin: a.index + a[0].length };
  else if (b) r = { date: b[1].padStart(2, "0") + "/" + String(MOIS.indexOf(b[2]) + 1).padStart(2, "0") + (b[3] ? "/" + b[3] : ""), index: b.index, fin: b.index + b[0].length };
  if (!r) return null;
  const h = p.slice(r.fin, r.fin + 22).match(RE_HEURE);
  if (h && +h[1] < 24) r.heure = h[1].padStart(2, "0") + "h" + (h[2] || "00");
  return r;
}
const dateDans = p => { const d = lireDate(p); return d ? d.date : ""; };
const anneeOk = d => { const a = (d.match(/\/(\d{4})$/) || [])[1]; return !a || +a >= new Date().getFullYear() - 1; };
const avecHeure = d => d.date + (d.heure ? " à " + d.heure : "");

/* ---------- montants ---------- */
const RE_MONTANT = /(\d{1,3}(?:[  .]\d{3})+|\d{4,})(?:,\d{1,2})?\s*(?:€|euros?|eur\b)\s*(?:\(?\s*(HT|H\.T\.?|TTC|T\.T\.C\.?|hors taxes?|toutes taxes comprises)\s*\)?)?/gi;
function montants(T, P) {
  const r = { min: [], max: [], est: [] };
  for (const m of T.matchAll(RE_MONTANT)) {
    const avant = P.slice(Math.max(0, m.index - 160), m.index);
    const val = m[0].replace(/\s+/g, " ").replace(/(\d)\.(\d{3})/g, "$1 $2").replace(/hors taxes?/i, "HT").replace(/toutes taxes comprises/i, "TTC").replace(/(\d)€/, "$1 €").trim();
    const proche = avant.slice(-90);
    const dernier = (re) => { let k = -1; for (const x of proche.matchAll(re)) k = x.index; return k; };
    const kMin = dernier(/minimum|minimal|au moins/g), kMax = dernier(/maximum|maximal|plafond|ne (pourra|peut) (pas )?exceder|au plus/g), kEst = dernier(/estim|previsionnel|enveloppe|montant (global|total) (du|des) (marche|travaux)|budget/g);
    const best = Math.max(kMin, kMax, kEst);
    if (best < 0) continue;
    if (/chiffre d'affaires|capital|assurance|garantie|penalit|sous-traitance|avance|seuil|inferieur a|franchise/.test(proche.slice(Math.max(0, best - 40)))) continue;
    const ctx = avant.slice(Math.max(avant.lastIndexOf("\n"), avant.lastIndexOf(". ")) + 1);
    const lot = (ctx.match(/lot\s*(?:n[°o]\s*)?(\d{1,2})\b(?![\s\S]*lot\s*(?:n[°o]\s*)?\d)/) || [])[1];
    const v = (lot ? "Lot " + lot + " : " : "") + val;
    (best === kMin ? r.min : best === kMax ? r.max : r.est).push(v);
  }
  if (/sans (montant )?minimum/.test(P)) r.min.unshift("Sans minimum");
  if (/sans (montant )?maximum/.test(P)) r.max.unshift("Sans maximum");
  const f = l => uniques(l).slice(0, 6).join(" ; ");
  return { montant_min: f(r.min), montant_max: f(r.max), montant_estime: f(r.est) };
}

/* ---------- critères de notation ----------
   Chaque pondération (« 60 % », « 40 points ») devient un élément ; son libellé est cherché sur la même ligne,
   entre guillemets, après « critère n°X : », ou sur la ligne qui ouvre le paragraphe. Les sous-critères sont
   reconnus parce que leur somme égale le critère qui les précède ; les critères principaux font 100. */
const RE_POIDS = /(\d{1,3}(?:[.,]\d{1,2})?)\s*(%|pour ?cent|points?\b|pts\b)/gi;
const GENERIQUE = /^(le |la |ce |cet |les )?(present |dit )?(critere|sous-critere|ponderation|note|valeur|pour|soit|represente|compte|ponderee?|ponderes?|criteres?|nombre|libelle|points?)( (represente|compte|est|pour|de|a|sur|ponderee?|pondere))*\s*(a|de|pour)?$/;
function libelleCritere(T, debutMorceau, i) {
  let d0 = Math.max(debutMorceau, i - 700);
  if (d0 > debutMorceau) { const n = T.indexOf("\n", d0); if (n > 0 && n < i) d0 = n + 1; }
  const morceau = T.slice(d0, i);
  const lignes = morceau.split("\n");
  const memeLigne = lignes[lignes.length - 1];
  const nettoie = s => {
    s = s.replace(/^\s*(sous[- ]?crit[eè]res?|crit[eè]res?)\s*((n\s*[°º]\s*)?\d+([.,]\d+)*\s*[:\-–—.]?|[:\-–—])\s*/i, "").replace(/^\s*[-–•▪]?\s*(le|la) (sous-)?crit[eè]re\s+/i, "");
    s = net(s.replace(/^\s*\d{1,2}([.,]\d{1,2})*[.)]?\s+/, "").replace(/^\s*[a-z]\)\s*/i, "").replace(/\(\s*$/, "").replace(/\b(pond[ée]r[ée]e?s? (à|a|de)|pond[ée]ration( de)?|not[ée]e? sur|soit|repr[ée]sente|compte pour)\s*$/i, ""));
    let k = -1;
    for (const re of [/,/, / \(/, / :/, / –/, / - /, /\s(appr[ée]ci[ée]e?s?|[ée]valu[ée]e?s?|not[ée]e?s?|jug[ée]e?s?|analys[ée]e?s?)\b/i, /\s(est|sont) (d[ée]compos|d[ée]clin|appr|[ée]valu)/i, /\ssur la base\b/i, /\sau (regard|vu)\b/i, /\s(issu|issue)\b/i])
      { const x = s.search(re); if (x >= 4 && (k < 0 || x < k)) k = x; }
    if (k >= 4) s = s.slice(0, k);
    s = net(s);
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  };
  const ok = s => s && s.length >= 3 && /\p{L}{3}/u.test(s) && !GENERIQUE.test(plat(s)) && !/^(criteres?|ponderation|libelle|nombre)( d'attribution| de jugement| et sous-criteres| retenus)?$/.test(plat(s));
  // 1. « critère n°2 : Valeur technique » / « Sous-critère 1.1 – … » dans le morceau
  let m = null;
  for (const x of morceau.matchAll(/([Ss]ous[- ]?[Cc]rit[eè]re\s*(n\s*[°º]\s*)?\d+([.,]\d+)?|[Cc]rit[eè]re\s*(n\s*[°º]\s*)?\d+([.,]\d+)?|\bS?C[A-Z]?\s?\d{1,2}(\.\d{1,2})?)\s*[:\-–—.]\s*([^\n]*)(\n[^\n]*)?/g)) m = x;
  if (!m) for (const x of morceau.matchAll(/(sous[- ]?crit[eè]re|crit[eè]re)\s*(n\s*[°º]\s*)?\d+([.,]\d+)?\s*[:\-–—.]\s*([^\n]*)(\n[^\n]*)?/gi)) m = x;
  if (m && m.length > 6) m = [m[0], "", "", "", m[7], m[8]];
  if (m) { const s = nettoie(m[4] && m[4].length > 2 ? m[4] : (m[5] || "")); if (ok(s)) return s; }
  // 2. la même ligne quand elle ouvre l'élément
  if (lignes.length === 1 || /^\s*([•▪➢►*]|o\s|\d{1,2}([.,]\d{1,2})*[.)]?\s|[a-z]\)|(sous[- ]?)?crit)/i.test(memeLigne) || lignes.length <= 2 && !lignes[0].trim()) { const s = nettoie(memeLigne); if (ok(s)) return s; }
  // 2b. la même ligne, si elle commence par une majuscule (« Prix – 40 % »)
  if (/^\s*[A-ZÀ-Ý]/.test(memeLigne) && !niveauTitre(memeLigne.trim())) { const s = nettoie(memeLigne); if (ok(s) && s.length <= 90) return s; }
  // 3. un libellé entre guillemets
  const g = [...morceau.matchAll(/[«"“]\s*([^»"”\n]{3,90})\s*[»"”]/g)].pop();
  if (g && ok(net(g[1]))) return net(g[1]).charAt(0).toUpperCase() + net(g[1]).slice(1);
  // 4. une ligne-repère (« 2.1. », puce) puis la ligne de texte qui suit
  for (let k = lignes.length - 1; k >= 0; k--) {
    if (/^\s*([•▪➢►]|\d{1,2}([.,]\d{1,2})*[.)]?(\s|$)|[a-z]\)\s)/.test(lignes[k]) && !(niveauTitre(lignes[k].trim()) && /\p{L}{4}/u.test(lignes[k]))) {
      let s = nettoie(lignes[k]);
      if (!ok(s) && k + 1 < lignes.length) s = nettoie(lignes[k + 1]);
      if (ok(s)) return s;
    }
  }
  // 5. la même ligne, puis la première ligne non vide du paragraphe
  { const s = nettoie(memeLigne); if (ok(s) && s.length > 6) return s; }
  for (const l of lignes) { if (niveauTitre(l.trim())) continue; const s = nettoie(l); if (ok(s)) return s; }
  return "";
}
function itemsCriteres(T, debut, fin) {
  const items = [];
  let dernier = debut;
  RE_POIDS.lastIndex = 0;
  const zone = T.slice(debut, fin), Pz = plat(zone);
  for (const m of zone.matchAll(RE_POIDS)) {
    const i = debut + m.index;
    const avant = Pz.slice(Math.max(0, m.index - 40), m.index);
    if (/(\bsur|\/|note de|de 0 a|entre|ramenee?s?\s+a(\s+une)?(\s+ponderation\s+de)?|maximum de|total de|tva|avance|retenue|penalit|rabais|remise|taux|\ba|jusqu'a|au moins|plus de|moins de)\s*$/.test(avant)) { continue; }
    if (/^\s*(du|des|de la|de l'|de|sur)\b/.test(Pz.slice(m.index + m[0].length, m.index + m[0].length + 8)) && !/%/.test(m[2])) continue; // « 5 points de… », « 40 points sur 100 »
    const val = parseFloat(m[1].replace(",", "."));
    if (!(val > 0) || val > 100) { dernier = i + m[0].length; continue; }
    const lib = libelleCritere(T, dernier, i);
    const ligne = plat(T.slice(T.lastIndexOf("\n", i - 1) + 1, i));
    const lignesAv = T.slice(Math.max(dernier, i - 500), i).split("\n").reverse();
    const lm = lignesAv.find(l => /^\s*([•▪➢►\-–o*]\s|\d{1,2}([.,]\d{1,2})+|sous[- ]?crit|[a-z]\)\s)/i.test(l)) || "";
    const marque = (lm.match(/^\s*([•▪➢►\-–o*]|\d{1,2}([.,]\d{1,2})+|sous|[a-z]\))/i) || ["", ""])[1].replace(/\d+/g, "#").toLowerCase();
    items.push({ marque, lib, val, unite: /%|cent/i.test(m[2]) ? "%" : "points", sous: /sous[- ]?crit|^\s*\d+[.,]\d+/.test(ligne) || /^\s*sous[- ]?crit/.test(plat(T.slice(Math.max(dernier, i - 300), i)).split("\n").filter(Boolean).slice(-3).join(" ")) });
    dernier = i + m[0].length;
  }
  return items;
}
function regrouper(items) {
  const imbrique = regrouperImbrique(items);
  // sous-critères annoncés par une autre puce que leur critère (« - Valeur technique » puis « ▪ Méthodologie ») : lecture imbriquée
  if (Math.abs(imbrique.somme - 100) < 0.6 && imbrique.res.some(c => c._marques && c._marques.length > 1 && c._marques.every(m => m && m === c._marques[0] && m !== c._marque))) return imbrique;
  // 1. les premiers éléments font 100 à eux seuls : ce sont les critères, les suivants peuvent être leurs sous-critères
  let cumul = 0, k = 0;
  while (k < items.length && cumul < 99.5 && !(k > 0 && items[k].sous)) { cumul += items[k].val; k++; }
  if (k >= 2 && Math.abs(cumul - 100) < 0.6) {
    const res = items.slice(0, k).map(c => ({ critere: c.lib || "Critère", ponderation: String(c.val).replace(".", ",") + (c.unite === "%" ? " %" : " points"), sous_criteres: [] }));
    let j = k;
    for (let n = 0; n < res.length && j < items.length; n++) {
      const cible = items[n].val; let s = 0, e = j;
      while (e < items.length && s + items[e].val <= cible + 0.01) { s += items[e].val; e++; if (Math.abs(s - cible) < 0.01) break; }
      if (e > j + 1 && Math.abs(s - cible) < 0.01 && plat(items[j].lib).slice(0, 4) !== plat(items[n].lib).slice(0, 4)) { res[n].sous_criteres = items.slice(j, e).map(x => (x.lib || "Sous-critère") + " : " + String(x.val).replace(".", ",") + (x.unite === "%" ? " %" : " points")); j = e; }
    }
    return { res, somme: 100 };
  }
  return imbrique;
}
function regrouperImbrique(items) {
  const res = [];
  let i = 0, somme = 0;
  while (i < items.length && somme < 99.5) {
    const c = items[i];
    if (c.sous && res.length) { i++; continue; }
    const crit = { critere: c.lib || "Critère " + (res.length + 1), ponderation: String(c.val).replace(".", ",") + (c.unite === "%" ? " %" : " points"), sous_criteres: [] };
    // les éléments suivants sont des sous-critères si leur somme retombe exactement sur ce critère
    let s = 0, j = i + 1;
    while (j < items.length && s + items[j].val <= c.val + 0.01) { s += items[j].val; j++; if (Math.abs(s - c.val) < 0.01) break; }
    crit._marque = c.marque;
    if (j === i + 2 && Math.abs(s - c.val) < 0.01) { i = j; }
    else if (j > i + 1 && Math.abs(s - c.val) < 0.01) { crit._marques = items.slice(i + 1, j).map(x => x.marque); crit.sous_criteres = items.slice(i + 1, j).map(x => (x.lib || "Sous-critère") + " : " + String(x.val).replace(".", ",") + (x.unite === "%" ? " %" : " points")); i = j; }
    else i++;
    if (c.val + somme > 100.01) continue;
    res.push(crit); somme += c.val;
  }
  return { res, somme };
}
function criteres(ctx) {
  const { T, P } = ctx;
  const zones = [];
  for (const t of ctx.titres) if (/crit[e]res?|jugement des (candidatures et des )?offres|analyse des offres|ponderation|attribution du marche|classement des offres|notation/.test(t.p) && !/candidatures?$|selection des candidatures/.test(t.p)) zones.push([t.finTitre, Math.min(t.fin, t.finTitre + 9000)]);
  for (const m of P.matchAll(/crit[e]res? (d'|de |d )?(attribution|jugement|selection des offres|choix|notation|evaluation)|jugement des offres|ponderes? comme suit|ponderation suivante|criteres suivants|criteres enonces|avec leur ponderation|ponderations? (des criteres )?suivantes?/g)) zones.push([m.index, Math.min(T.length, m.index + 6000)]);
  let meilleur = null;
  for (const [d, f] of zones) {
    const items = itemsCriteres(T, d, f);
    if (items.length < 2) continue;
    const { res, somme } = regrouper(items);
    const note = (Math.abs(somme - 100) < 0.6 ? 100 : 0) + res.length + res.reduce((a, c) => a + c.sous_criteres.length, 0) * 0.5;
    if (res.length && (!meilleur || note > meilleur.note)) meilleur = { res, note, somme };
    if (meilleur && meilleur.note >= 100) break;
  }
  if (!meilleur) return { criteres: [], total: 0 };
  return { criteres: meilleur.res.slice(0, 12).map(c => ({ critere: c.critere, ponderation: c.ponderation, sous_criteres: c.sous_criteres })), total: meilleur.somme };
}

/* ---------- qualifications ---------- */
const QUALIFS = [
  [/qualibat/g, "Qualibat"], [/qualifelec/g, "Qualifelec"], [/qualipac/g, "QualiPAC"], [/qualit'?enr/g, "Qualit'EnR"], [/qualipv/g, "QualiPV"], [/qualisol/g, "QualiSol"], [/qualibois/g, "QualiBois"], [/qualigaz/g, "Qualigaz"],
  [/\brge\b|reconnu garant/g, "RGE"], [/opqibi/g, "OPQIBI"], [/opqtecc/g, "OPQTECC"], [/opqcm/g, "OPQCM"], [/qualipaysage/g, "Qualipaysage"], [/qualiprop/g, "Qualipropre"], [/qualiopi/g, "Qualiopi"],
  [/\biso\s?(9001|14001|45001|50001|27001)/g, "ISO"], [/\bmase\b/g, "MASE"], [/certibat/g, "Certibat"], [/\bapsad\b/g, "APSAD"], [/\bcnaps\b/g, "CNAPS"], [/\bcaces\b/g, "CACES"],
  [/habilitations? electriques?/g, "Habilitation électrique"], [/sous[- ]section (3|4)\b(?! ?:)|\bss ?(3|4)\b/g, "Amiante"], [/\bnf habitat\b/g, "NF Habitat"], [/attestation de capacite|fluides? frigorig/g, "Attestation de capacité (fluides frigorigènes)"],
];
function qualifications(T, P) {
  const r = [];
  // codes Qualibat / Qualifelec / OPQIBI : regroupés par famille
  for (const [re, nom] of [[/qualibat/g, "Qualibat"], [/qualifelec/g, "Qualifelec"], [/opqibi/g, "OPQIBI"]]) {
    const codes = new Map();
    for (const m of P.matchAll(re)) {
      const apres = T.slice(m.index + m[0].length, m.index + m[0].length + 140);
      const c = apres.match(/^\s*(?:n\s*[°º]\s*|code\s*|qualification\s*)?[:\-–]?\s*([A-Z]?\d{2,4}(?:[-.]\d)?)\b(\s*[-–:]?\s*[«"“]\s*([^»"”\n]{3,80})[»"”])?/);
      if (c && !/^(19|20)\d\d$/.test(c[1])) { if (!codes.has(c[1]) || c[3]) codes.set(c[1], c[3] ? net(c[3]) : codes.get(c[1]) || ""); }
    }
    if (codes.size) {
      const avecLib = [...codes].filter(([, l]) => l), sansLib = [...codes].filter(([, l]) => !l).map(([c]) => c);
      for (const [c, l] of avecLib.slice(0, 6)) r.push(nom + " " + c + " « " + l + " »");
      if (sansLib.length) r.push(nom + " " + sansLib.slice(0, 14).join(", ") + (sansLib.length > 14 ? "…" : ""));
    } else if (re.test(P)) {
      const m = P.match(re); r.push(coupe(net(T.slice(m.index, m.index + 120).split(/\n|\.\s/)[0]), 110));
    }
  }
  for (const [re, nom] of QUALIFS.slice(1)) {
    if (["Qualifelec", "OPQIBI"].includes(nom)) continue;
    let n = 0;
    for (const m of P.matchAll(re)) {
      let f = m.index; const fin = Math.min(T.length, m.index + 150);
      while (f < fin && !/^(;|\.\s|\n)/.test(T.slice(f, f + 2))) f++;
      const s = coupe(net(T.slice(m.index, f)), 130);
      if (s.length >= 3) { r.push(s); n++; }
      if (n >= 2) break;
    }
  }
  const u = uniques(r.map(x => x.replace(/(\s+X\b)+\s*$/, "").trim()));
  return u.filter(x => !u.some(y => y !== x && y.length > x.length && plat(y).includes(plat(x)))).slice(0, 12);
}

/* ---------- pièces à fournir ---------- */
const PIECES_CANDIDATURE = [
  [/\bdc ?1\b|lettre de candidature/, "Lettre de candidature (DC1)"], [/\bdc ?2\b|declaration du candidat/, "Déclaration du candidat (DC2)"], [/\bdume\b|document unique de marche europeen/, "DUME (accepté ou demandé)"],
  [/k ?bis|extrait k\b|inscription au registre du commerce|registre des metiers/, "Extrait Kbis (ou équivalent)"], [/attestation sur l'honneur|declaration sur l'honneur/, "Déclaration sur l'honneur (interdictions de soumissionner)"],
  [/pouvoir|habilitation (du|de la personne) signataire|delegation de signature/, "Pouvoir du signataire"], [/redressement judiciaire/, "Copie du jugement (si redressement judiciaire)"],
  [/chiffre d'affaires/, "Chiffre d'affaires des 3 derniers exercices"], [/assurance|responsabilite civile|decennale/, "Attestations d'assurance (RC pro / décennale)"],
  [/effectifs? moyens?|personnel d'encadrement/, "Effectifs moyens annuels et encadrement"], [/references?|liste des (principaux )?(travaux|services|prestations|fournitures)/, "Références de prestations similaires"],
  [/certificats? de capacite|attestations? de bonne execution/, "Certificats de capacité / bonne exécution"], [/outillage|materiel|equipement technique|moyens techniques/, "Moyens matériels et techniques"],
  [/certificats? de qualification|qualifications? professionnelles?|qualibat|qualifelec|opqibi/, "Certificats de qualification (Qualibat, etc.)"], [/\bdc ?4\b|declaration de sous-traitance/, "Déclaration de sous-traitance (DC4) si besoin"],
  [/engagement (ecrit )?(de chacun )?des? (autres )?operateurs|capacites d'autres operateurs/, "Engagement des opérateurs sur lesquels le candidat s'appuie"],
];
const PIECES_OFFRE = [
  [/acte d'engagement|\battri ?1\b|\bae\b/, "Acte d'engagement (AE / ATTRI1)"], [/\bdpgf\b|decomposition du prix global/, "DPGF"], [/\bbpu\b|bordereau (des |de )?prix/, "Bordereau des prix unitaires (BPU)"],
  [/\bdqe\b|detail quantitatif estimatif|\bdetail estimatif\b|\bdei\b/, "Détail quantitatif estimatif (DQE / DE)"], [/sous-details? de prix|sous-detail des prix|decomposition de prix/, "Sous-détails de prix"],
  [/memoire technique|memoire justificatif|cadre de (reponse|memoire)|\bcmt\b|note methodologique/, "Mémoire technique (ou cadre de réponse)"], [/planning|calendrier (previsionnel|d'execution|detaille)/, "Planning / calendrier d'exécution"],
  [/attestation de visite|certificat de visite/, "Attestation de visite"], [/\bsopaq\b|plan d'assurance qualite|\bpaq\b/, "SOPAQ / Plan d'assurance qualité"], [/\bsoged\b|\bsosed\b|gestion des dechets/, "SOGED (gestion des déchets)"],
  [/\bsopre\b|respect de l'environnement/, "SOPRE (respect de l'environnement)"], [/fiches? techniques?|documentation technique/, "Fiches techniques des produits"], [/echantillons?/, "Échantillons"],
  [/\bccap\b.{0,60}(sign|accept|paraph)|(sign|accept|paraph).{0,60}\bccap\b/, "CCAP signé / accepté"], [/\bcctp\b.{0,60}(sign|accept|paraph)|(sign|accept|paraph).{0,60}\bcctp\b/, "CCTP signé / accepté"],
  [/\brib\b|releve d'identite bancaire/, "RIB"], [/\battri ?2\b|\bdc ?4\b/, "Déclaration de sous-traitance (DC4 / ATTRI2) si besoin"], [/schema organisationnel/, "Schémas organisationnels"],
  [/questionnaire/, "Questionnaire à compléter"], [/annexe financiere|proposition financiere|offre financiere/, "Offre financière"],
];
function bloc(ctx, reTitres, reTexte, exclure, max = 7000) {
  for (const re of reTitres) {
    const l = [];
    for (const t of ctx.titres) {
      if (!re.test(t.p) || (exclure && exclure.test(t.p)) || l.some(x => t.debut < x.fin && t.debut >= x.debut)) continue;
      l.push({ debut: t.debut, fin: Math.min(t.fin, t.finTitre + max), texte: ctx.T.slice(t.finTitre, Math.min(t.fin, t.finTitre + max)) });
      if (l.length >= 3) break;
    }
    if (l.length) return l.map(x => x.texte).join("\n");
  }
  const m = ctx.P.match(reTexte);
  return m ? ctx.T.slice(m.index, m.index + Math.min(max, 4000)) : "";
}
function pieces(texte, dico) {
  const p = plat(texte), r = [];
  for (const [re, lib] of dico) { const m = p.match(re); if (m) r.push([m.index, lib]); }
  return r.sort((a, b) => a[0] - b[0]).map(x => x[1]);
}

/* ---------- autres rubriques ---------- */
const PROCEDURES = [
  [/appel d'offres? ouvert/, "Appel d'offres ouvert"], [/appel d'offres? restreint/, "Appel d'offres restreint"], [/procedure concurrentielle avec negociation/, "Procédure concurrentielle avec négociation"],
  [/procedure (negociee )?avec negociation/, "Procédure avec négociation"], [/dialogue competitif/, "Dialogue compétitif"], [/systeme d'acquisition dynamique/, "Système d'acquisition dynamique (SAD)"],
  [/procedure adaptee|\bmapa\b/, "Procédure adaptée (MAPA)"], [/sans publicite ni mise en concurrence/, "Marché sans publicité ni mise en concurrence"], [/\bconcours\b/, "Concours"],
];
function procedure(ctx) {
  const s = section(ctx, /procedure|passation|mode de consultation|type de marche|forme du marche|conditions de la consultation/, { max: 2500 });
  for (const zone of [s ? plat(s.texte) : "", ctx.P.slice(0, 12000), ctx.P]) {
    let best = null;
    for (const [re, lib] of PROCEDURES) { const m = zone.match(re); if (m && (!best || m.index < best[0])) best = [m.index, lib]; }
    if (best) return best[1];
  }
  return "";
}
function typeMarche(P) {
  const l = [];
  if (/accord[- ]cadre/.test(P)) {
    let s = "Accord-cadre";
    if (/bons? de commande/.test(P)) s += " à bons de commande";
    if (/marches? subsequents?/.test(P)) s += (/bons? de commande/.test(P) ? " et" : "") + " à marchés subséquents";
    if (/multi[- ]?attributaire/.test(P)) s += ", multi-attributaire"; else if (/mono[- ]?attributaire/.test(P)) s += ", mono-attributaire";
    l.push(s);
  } else l.push("Marché ordinaire");
  if (/tranches? optionnelles?/.test(P) && !/(pas|aucune|ne comporte pas) (de )?tranches?/.test(P)) l.push("avec tranche(s) optionnelle(s)");
  const exp = P.match(/marche (public )?(global )?de (travaux|services|fournitures)/);
  let nature = exp ? exp[3] : "";
  if (!nature) { const n = { travaux: (P.match(/\btravaux\b/g) || []).length, services: (P.match(/\bservices?\b|prestations? de service/g) || []).length, fournitures: (P.match(/\bfournitures?\b/g) || []).length }; const x = Object.entries(n).sort((a, b) => b[1] - a[1])[0]; if (x[1]) nature = x[0]; }
  return (nature ? nature[0].toUpperCase() + nature.slice(1) + " · " : "") + l.join(", ");
}
function formePrix(P) {
  const f = /prix global(?:\s+et)?\s+forfaitaire|prix forfaitaires?|forfait global/.test(P), u = /prix unitaires?|bordereau des prix|bons? de commande/.test(P);
  const l = [];
  if (f && u) l.push("prix forfaitaires et unitaires"); else if (f) l.push("prix global et forfaitaire"); else if (u) l.push("prix unitaires");
  const r = P.match(/prix (?:sont |seront |du marche sont )?(fermes(?: et actualisables)?|revisables|actualisables)/);
  if (r) l.push("prix " + r[1].replace("revisables", "révisables"));
  const s = l.join(", ");
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}
function objet(ctx) {
  let t = "";
  for (const ti of ctx.titres) {
    if (!/\bobjet\b|presentation de la consultation|designation/.test(ti.p) || /fait l'objet|objet du present reglement/.test(ti.p)) continue;
    const x = ctx.T.slice(ti.finTitre, Math.min(ti.fin, ti.finTitre + 1500)).split("\n").filter(l => !niveauTitre(l)).join("\n").trim();
    if (x.replace(/\s/g, "").length >= 40) { t = x; break; }
  }
  if (!t || t.length < 30) {
    const m = ctx.P.match(/objet (de la consultation|du marche|de l'accord[- ]cadre|du contrat)\s*:?\s*/);
    if (m) t = ctx.T.slice(m.index + m[0].length, m.index + m[0].length + 900);
  }
  if (!t) return "";
  const l = [];
  for (const x of t.split("\n")) { if (l.length && (!x.trim() || niveauTitre(x))) break; if (x.trim()) l.push(x); }
  let r = net(l.join(" "));
  if (r.length < 25) r = net(t.replace(/\n/g, " "));
  return coupe(r, 520);
}
function lots(T, P) {
  const r = new Map();
  for (const m of T.matchAll(/(?:^|\n)\s*lot\s*(?:n\s*[°ºo]\.?\s*)?0?(\d{1,2})\s*[:\-–—.)]\s*([^\n]{3,140})/gi)) {
    const t = net(m[2].replace(/\.{3,}.*$/, ""));
    if (!r.has(m[1]) && t.length >= 3 && /\p{L}{3}/u.test(t) && !/^\d+\s*(%|points)/.test(t) && !/^(le|la|les|un|une|du|des|pour|en|est|sera|seront)\b/i.test(t)) r.set(m[1], t);
  }
  const l = [...r].sort((a, b) => a[0] - b[0]).slice(0, 40).map(([n, t]) => ({ numero: "Lot " + n, intitule: coupe(t, 120), montant: "" }));
  let allot = "";
  if (l.length > 1) allot = l.length + " lots";
  else if (/(pas|n'est pas|aucun) (d')?allot|n'est pas alloti|lot unique|ne fait pas l'objet d'un allotissement|(pas|n'est pas) (decompose|divise) en lots|ne comporte pas de lots?|allotissement n'est pas envisage|un seul lot/.test(P)) allot = "Lot unique (pas d'allotissement)";
  return { lots: l.length > 1 ? l : l, allotissement: allot };
}
const METIERS = [["plomberie", "Plomberie"], ["chauffage", "Chauffage"], ["ventilation", "Ventilation"], ["climatisation", "Climatisation"], ["electricite|courants? forts?", "Électricité"], ["courants faibles", "Courants faibles"], ["maconnerie", "Maçonnerie"], ["gros oeuvre|gros-oeuvre", "Gros œuvre"], ["charpente", "Charpente"], ["couverture", "Couverture"], ["etancheite", "Étanchéité"], ["menuiseries? exterieures?", "Menuiseries extérieures"], ["menuiseries? interieures?", "Menuiseries intérieures"], ["serrurerie", "Serrurerie"], ["metallerie", "Métallerie"], ["platrerie", "Plâtrerie"], ["cloisons", "Cloisons, doublages"], ["faux[- ]plafonds?", "Faux plafonds"], ["peintures?", "Peinture"], ["revetements? de sols?|sols souples", "Revêtements de sols"], ["carrelage", "Carrelage"], ["facades?|ravalement", "Façades, ravalement"], ["isolation", "Isolation"], ["vrd|voirie|chaussees?|enrobes", "VRD, voirie"], ["espaces verts|paysag", "Espaces verts"], ["desamiantage", "Désamiantage"], ["demolition", "Démolition"], ["ascenseurs?", "Ascenseurs"], ["nettoyage", "Nettoyage"], ["terrassements?", "Terrassement"], ["photovoltaique", "Photovoltaïque"], ["securite incendie|ssi\\b|desenfumage", "Sécurité incendie"], ["cvc\\b|cvcd\\b|genie climatique", "CVC"], ["gestion technique (du|des) batiments?|\\bgtb\\b|\\bgtc\\b|regulation", "GTB, régulation"], ["telecommunications?|reseaux informatiques|cablage", "Réseaux, télécoms"], ["ouvrages? d'art", "Ouvrages d'art"], ["assainissement", "Assainissement"], ["signalisation", "Signalisation"], ["stores", "Stores, fermetures"], ["eclairage", "Éclairage"]];
function corpsEtat(texte) {
  const P = plat(texte);
  return uniques(METIERS.filter(([re]) => new RegExp("\\b(" + re + ")").test(P)).map(x => x[1])).slice(0, 15);
}
const RE_DUREE = /\b(\d{1,3}|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|douze|dix-huit|vingt-quatre|trente-six|quarante-huit)\s*(\(\s*\d{1,3}\s*\)\s*)?(mois|ans?|annees?|semaines?|jours?)( calendaires| ouvres| ouvrables)?\b/;
function duree(ctx) {
  const zones = [];
  const s = section(ctx, /duree|delais? (global |globaux )?d'execution|prise d'effet|periode d'execution|delai de realisation/, { max: 2500, exclure: /validite|paiement|garantie/ });
  if (s) zones.push(s.texte);
  zones.push(ctx.T);
  const bonne = p => (RE_DUREE.test(p) || /(prend effet|jusqu'au|a compter du) .{0,30}\d{4}|n'est pas reconductible/.test(p)) && /duree|delai|conclu|execution|reconduc|a compter|periode|annee|mois/.test(p) && !/validite|questions?|renseignements|paiement|garantie|recours|candidat(ure)?s? (devront|doivent)|offres? (sont|seront) valables|jours? avant la date|remise des offres|reception des offres/.test(p);
  const fort = /duree (du marche|de l'accord|initiale|globale|du contrat|d'execution|des travaux|totale)|delai (global |contractuel )?d'execution|reconduc|est conclue? pour|delai de realisation|a compter de (la )?(sa |la date de )?notification/;
  for (const [n, z] of zones.entries()) {
    const l = phrases(sansTitres(z)).filter(x => bonne(plat(x)) && (n === 0 || fort.test(plat(x))));
    if (!l.length) { if (n === 0 && s) { const p0 = phrases(sansTitres(z))[0]; if (p0 && /duree|delai|fix|bon de commande|acte d'engagement/.test(plat(p0))) return coupe(net(p0), 260); } continue; }
    const pr = l.find(x => /duree|conclu/.test(plat(x))) || l[0];
    const rec = l.find(x => x !== pr && /reconduc/.test(plat(x)));
    const ex = l.find(x => x !== pr && x !== rec && /delai.{0,30}execution|execution des (travaux|prestations)/.test(plat(x)));
    return [pr, rec, ex].filter(Boolean).map(x => coupe(net(x), 260)).join(" ");
  }
  return "";
}
function dateLimite(ctx) {
  const { P } = ctx;
  let r = null;
  for (const m of P.matchAll(/dates? (et heures? )?limites?( de| d'| des)?( la)?( (reception|remise|depot|presentation))?|heure limite|remise des (plis|offres|candidatures)|reception des (plis|offres)|depot des (plis|offres)|(offres|plis|candidatures|dossiers) (devront|doivent) (etre )?(remis|recus|deposes|transmis|parvenir)e?s?( (au plus tard|avant|jusqu'au))?/g)) {
    const avant = P.slice(Math.max(0, m.index - 80), m.index);
    const apres = P.slice(m.index, m.index + 200);
    if (/question|renseignement|visite|precision|demande/.test(avant.slice(avant.lastIndexOf("\n") + 1)) || /^[^.\n]{0,40}(question|renseignement|visite|demandes)/.test(apres.slice(m[0].length))) continue;
    const d = lireDate(apres.slice(m[0].length));
    if (!d || !anneeOk(d.date)) continue;
    if (!r || (d.date.length > r.date.length) || (!r.heure && d.heure && d.date === r.date)) r = d;
    if (r.date.length === 10 && r.heure) break;
  }
  return r ? avecHeure(r) : "";
}
function validite(P) {
  const m = P.match(/(delai|duree) de validite (des|de l'|de leurs?|de son|de votre) ?(offres?|propositions?|plis)|offres? (restent|resteront|sont|seront) valables?|validite des offres/);
  if (!m) return "";
  const z = P.slice(m.index, m.index + 260);
  const n = z.match(/(\d{1,3})\s*(?:\)\s*)?(jours|mois)|\((\d{1,3})\)\s*(jours|mois)/);
  return n ? (n[1] || n[3]) + " " + (n[2] || n[4]) : "";
}
function variantes(ctx) {
  const P = ctx.P, l = [];
  const s = section(ctx, /variante/, { max: 1800 });
  const z = s ? plat(s.texte) : "";
  const tout = z || (P.match(/[^.\n]{0,120}variante[^.\n]{0,160}/g) || []).join(" ");
  let statut = "";
  if (/variantes? (sont |est )?(imposees?|obligatoires?|exigees?)/.test(tout) && !/variantes? (imposees?|obligatoires?|exigees?)\s*:?\s*(non|sans objet|neant)/.test(tout)) statut = "Variantes imposées";
  if (/^\s*(sans objet|neant|non\b)/.test(z)) return { statut: "Variantes interdites", texte: "" };
  const autour = z || (P.match(/[^.\n]{0,120}variante[^.\n]{0,160}/g) || []).join(" ");
  if (/(ne sont pas|n'est pas|ne seront pas|non) (autorisees?|admises?|acceptees?)|variantes? (sont )?(interdites?|refusees?)|(pas|aucune) (de )?variantes?|variantes?\s*:?\s*(non|sans objet|neant)|ne peu(vent|t) pas presenter (de|des) variantes?|n'autorise pas (les )?variantes/.test(autour)) statut = statut || "Variantes interdites";
  const autorise = /variantes? (libres? )?(sont |est |seront )?(autorisees?|admises?|acceptees?|possibles?)|peu(vent|t) (presenter|proposer|remettre) (une |des |une ou des )?(offres? )?variantes?|offres? variantes? (de facon |a titre )?libres?|variantes? libres?|variantes?[^.]{0,60} (sont|seront|est) (autorisees?|admises?|acceptees?)/.test(tout);
  if (autorise && statut === "Variantes interdites") statut = /variantes? (libres?|a l'initiative)[^.]{0,40}(ne sont pas|non|interdites)/.test(tout) ? "Variantes interdites" : "Variantes autorisées (sous conditions, voir le RC)";
  else if (!statut && autorise) statut = "Variantes autorisées";
  if (!statut && /variante/.test(P)) statut = "Mentionnées (voir le RC)";
  const ph = s ? phraseAvec(s.texte, /variante/) : "";
  return { statut, texte: coupe(ph, 260) };
}
function pse(ctx) {
  const P = ctx.P;
  const s = section(ctx, /prestations? supplementaires?|\bpse\b|options?\b/, { max: 2000, exclure: /variante/ });
  const z = s ? s.texte : "";
  const pz = plat(z);
  const liste = [];
  for (const m of (z || ctx.T).matchAll(/\bPSE\s*(?:n\s*[°º]\s*)?(\d{1,2})\s*[:\-–—.)]\s*([^\n]{3,120})/g)) if (!liste.some(x => x.startsWith("PSE " + m[1] + " "))) liste.push("PSE " + m[1] + " : " + coupe(net(m[2]), 100));
  if (/^\s*(sans objet|neant|non\b|aucune?\b)/.test(pz) || /(pas|aucune|ne comporte pas|ne prevoit pas) (de )?(prestations? supplementaires?|pse)|prestations? supplementaires?( eventuelles?)?\s*:?\s*(non|sans objet|neant)|(pse|prestations? supplementaires? eventuelles?).{0,30}sans objet/.test(pz || "") || (!z && /(pas|aucune) (de )?(prestations? supplementaires?|pse)\b/.test(P))) return "Aucune";
  let t = liste.length ? liste.slice(0, 8).join(" ; ") : "";
  if (!t && z) t = coupe(phraseAvec(z, /prestations? supplementaires?|pse|option/, p => p.length > 30), 240);
  if (!t && /prestations? supplementaires? eventuelles?|\bpse ?\d/.test(P)) t = "Prévues (voir le RC)";
  if (t && /pse|prestation/.test(plat(t)) && /obligatoires?/.test(pz)) t += " (à chiffrer obligatoirement)";
  return t;
}
function tranches(T, P) {
  if (/(ne comporte pas|pas de|aucune|sans) tranches?|(ne fait pas l'objet d'un|pas de) (fractionnement|decoupage) en tranches|n'est pas (fractionne|decoupe) en tranches/.test(P)) return "Aucune";
  const l = [];
  for (const m of T.matchAll(/\btranche\s+(ferme|optionnelle|conditionnelle)\s*(n\s*[°º]\s*\d+|\d+)?\s*[:\-–—]\s*([^\n]{3,120})/gi)) l.push("Tranche " + m[1].toLowerCase() + (m[2] ? " " + m[2].replace(/\s/g, "") : "") + " : " + coupe(net(m[3]), 100));
  if (l.length) return uniques(l).slice(0, 6).join(" ; ");
  return /tranches? optionnelles?/.test(P) ? "Tranche(s) optionnelle(s) prévue(s)" : "";
}
function negociation(ctx) {
  const P = ctx.P;
  const s = section(ctx, /negociation/, { max: 2000 });
  const z = s ? plat(s.texte) : P;
  const possible = /(se reserve|pourra|peut|pourront|est susceptible de)[^.]{0,80}(negoci|engager (des|une) negociations?|recourir a la negociation)|negociation (sera|pourra etre) (engagee|menee|conduite)|une negociation sera|negociera/.test(z);
  const sansN = /(sans|pas de|aucune|ne (sera|pourra) pas (y )?avoir de|n'aura pas recours a la|exclut toute) negociation|ne (pas )?negocier|ne sera pas negocie/.test(z);
  const initiales = /(sur la base des offres initiales|offres initiales sans negociation)/.test(z);
  if (possible) return "Négociation possible" + (initiales ? " (attribution possible sur les offres initiales)" : "");
  if (sansN) return "Pas de négociation";
  return "";
}
function garanties(T, P) {
  const r = [];
  const pct = re => { const m = P.match(re); if (!m) return null; const z = P.slice(m.index, m.index + 200); const n = z.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%/); return n ? n[1] + " %" : "prévue"; };
  const rg = pct(/retenue de garantie/); if (rg && !/(pas|aucune|sans) (de )?retenue de garantie/.test(P)) r.push("Retenue de garantie : " + rg);
  const av = pct(/\bavance\b(?! sur)/); if (av && !/(pas|aucune|sans) (d')?avance/.test(P)) r.push("Avance : " + av);
  if (/garantie a premiere demande/.test(P)) r.push("Garantie à première demande possible");
  if (/caution (personnelle et )?solidaire/.test(P)) r.push("Caution solidaire");
  return r.join(" ; ");
}
function groupement(P) {
  if (/(forme du groupement|groupement)[^.]{0,60}(n'est pas imposee|pas de forme imposee|indifferent)/.test(P) || /la forme du groupement n'est pas imposee/.test(P)) {
    return /exigera[^.]{0,120}solidaire|devra (revetir|prendre) la forme[^.]{0,30}solidaire|mandataire[^.]{0,60}solidaire/.test(P) ? "Forme libre, mandataire solidaire exigé" : "Forme libre";
  }
  if (/groupement (conjoint|solidaire)[^.]{0,40}(impose|exige|obligatoire)|devra (revetir|prendre) la forme d'un groupement solidaire|(exige|impose)[^.]{0,40}groupement solidaire/.test(P)) return "Forme imposée (solidaire)";
  if (/mandataire[^.]{0,80}solidaire/.test(P)) return "Mandataire solidaire exigé";
  return "";
}
const ATTENTION = [
  [/echantillons?|maquettes? ou prototypes?/, "Échantillons", /(pas|aucun) (d')?echantillon|sans objet/],
  [/clause (sociale|d'insertion)|insertion professionnelle|heures d'insertion|action d'insertion/, "Clause sociale / insertion", null],
  [/clause environnementale|bilan carbone|empreinte carbone|decarbonation/, "Exigence environnementale", null],
  [/\bbim\b|maquette numerique/, "BIM / maquette numérique", null],
  [/penalites? (de|pour) retard/, "Pénalités de retard", null],
  [/signature electronique/, "Signature électronique", null],
  [/periode de preparation/, "Période de préparation", null],
  [/copie de sauvegarde/, "Copie de sauvegarde possible", null],
  [/sous-traitance (est )?(interdite|limitee)|ne peut sous-traiter|taches essentielles/, "Sous-traitance encadrée", null],
  [/site occupe|en site occupe|activite maintenue/, "Travaux en site occupé", null],
  [/confidentialite/, "Engagement de confidentialité", null],
];
function pointsAttention(T0) {
  const T = sansTitres(T0), P = plat(T);
  const r = [];
  for (const [re, lib, non] of ATTENTION) {
    const m = re.exec(P);
    if (!m) continue;
    let s = phrase(T, m.index, 160, 220);
    if (non && non.test(plat(s))) continue;
    s = coupe(s, 220);
    r.push(lib + (s.length > 20 ? " : " + s : ""));
  }
  return r.slice(0, 12);
}
function capacites(ctx) {
  const T = ctx.T, P = ctx.P, r = [];
  const ca = P.match(/chiffre d'affaires[^.]{0,80}(minimum|minimal|d'au moins|superieur|egal|au moins)[^.]{0,120}/);
  if (ca) r.push(coupe(phrase(T, ca.index, 60, 220), 240));
  for (const re of [/references? (similaires|de moins de|datant|d'operations|de travaux|de prestations|equivalentes)/, /effectifs? (moyens? )?annuels?/, /assurance (de )?(responsabilite civile|decennale|rc pro)/]) {
    const m = re.exec(P);
    if (m) r.push(coupe(phrase(T, m.index, 80, 220), 240));
  }
  return uniques(r.map(x => x.replace(/^(sans objet|neant)\s*[.:;-]?\s*/i, "")).filter(Boolean));
}
function questions(T0) {
  const T = sansTitres(T0), P = plat(T);
  const re = /(questions?|demandes? (de |d')?(renseignements?|precisions?|informations?|eclaircissements?)|renseignements? complementaires?)/g;
  let meilleur = null;
  for (const m of P.matchAll(re)) {
    const s = phrase(T, m.index, 200, 320), p = plat(s);
    if (!/au plus tard|avant|jusqu'au|date limite|delai|limite/.test(p)) continue;
    const d = lireDate(p.slice(Math.max(0, p.indexOf(plat(T.slice(m.index, m.index + m[0].length))))));
    const date = d && anneeOk(d.date) ? d.date : "";
    const j = p.match(/(\d{1,2}|deux|trois|quatre|cinq|six|sept|huit|dix|quinze|huitieme|dixieme|sixieme|cinquieme)( \(\d{1,2}\))? ?(jours?)?( calendaires| ouvres| francs| ouvrables)? (au moins |au plus tard |pleins )?(avant|precedant) (la |le )?(date|remise|limite|reception|depot|cloture)/);
    const nb = j ? ({ deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, dix: 10, quinze: 15, huitieme: 8, dixieme: 10, sixieme: 6, cinquieme: 5 }[j[1]] || Number(j[1])) : 0;
    if (date || nb) { meilleur = { texte: coupe(s, 300), date, jours: nb }; if (date) break; }
  }
  return meilleur || { texte: "", date: "", jours: 0 };
}
function visite(ctx) {
  const { T, P } = ctx;
  const s = section(ctx, /visite/, { max: 2500 });
  let texte = s ? phraseAvec(s.texte, /visite|rendez-vous|se rendre/) : "";
  if (!texte) { const m = P.match(/visite (des lieux|du site|sur site|obligatoire|facultative|preal|des locaux|des installations)/); if (m) texte = phrase(T, m.index); }
  const zone = plat((s ? s.texte : "") + " " + texte);
  let type = "";
  const nonP = /(pas|aucune) (de )?visite|n'est pas prevu de visite|sans visite|visite.{0,40}(sans objet|n'est pas (prevue|organisee))/;
  const oblig = /visite[^.;]{0,70}(est |sera |reste )?obligatoire|obligatoirement (effectuer|proceder a|visiter)|attestation de visite/;
  const pasOblig = /visite[^.;]{0,70}(n'est pas|non|pas) obligatoire|visite[^.;]{0,40}facultative/;
  if ((oblig.test(zone) && !pasOblig.test(zone)) || (!s && oblig.test(P) && !pasOblig.test(P))) type = "obligatoire";
  else if (nonP.test(zone) || (!s && nonP.test(P))) type = "non";
  else if (/facultative|n'est pas obligatoire|recommandee|conseillee|possible|pourront? visiter|peuvent visiter/.test(zone) || texte) type = "facultative";
  // date : dans la section visite ou juste après une mention de visite
  let date = "";
  for (const z of [s ? plat(s.texte) : "", ...[...P.matchAll(/visite/g)].slice(0, 15).map(m => P.slice(m.index, m.index + 350))]) {
    if (!z) continue;
    for (const x of z.matchAll(new RegExp(RE_DATE_NUM.source + "|" + RE_DATE_LET.source, "g"))) {
      const d = lireDate(z.slice(x.index)); if (!d || !anneeOk(d.date)) continue;
      if (/limite|remise des|reception des|jurisprudence|arret|decret|loi|code/.test(z.slice(Math.max(0, x.index - 60), x.index))) continue;
      date = d.date; break;
    }
    if (date) break;
  }
  return { visite: coupe(texte, 300), visite_type: type, visite_date: date };
}

/* ---------- analyse complète ---------- */
function analyserTexte(brut) {
  const T = nettoyer(brut);
  const P = plat(T);
  const ctx = { T, P, titres: decouper(T) };
  const mt = montants(T, P);
  const { criteres: crit, total } = criteres(ctx);
  const qual = qualifications(T, P);
  const proc = procedure(ctx);
  const type = typeMarche(P);
  const { lots: lotsL, allotissement } = lots(T, P);
  const ob = objet(ctx);
  const vis = visite(ctx);
  const q = questions(T);
  const date = dateLimite(ctx);
  const cand = bloc(ctx, [/(pieces?|contenu|composition|elements?|documents?|dossier|presentation|renseignements).{0,40}candidature|candidature.{0,20}(pieces?|contenu|documents?)|dossier administratif|situation juridique|capacites? (economiques?|techniques?|professionnelles?)|verification des capacites/, /candidature|documents? a produire|pieces? a (produire|fournir)|contenu (du|des) plis?|composition (du|des) (dossier|plis?)|presentation des (plis|dossiers)/], /pieces? (de la |relatives a la )?candidature|dossier de candidature|documents? de la candidature|au titre de la candidature/, /selection|examen|analyse|jugement|ouverture/);
  const off = bloc(ctx, [/(pieces?|contenu|composition|elements?|documents?|dossier|constitution).{0,40}offre|offre.{0,12}(technique|financiere)|projet de marche|sous[- ]dossier (technique|financier)|contenu de la proposition/, /offre|documents? a produire|pieces? a (produire|fournir)|composition (du|des) (dossier|plis?)/], /pieces? (de l'|relatives a l')offre|contenu de l'offre|dossier (de l')?offre|projet de marche comprenant|au titre de l'offre/, /jugement|criteres?|analyse|classement|validite|anormalement|irregul|remise des|modalites de (remise|depot)|negociation|variantes?|copie|depot|selection|ouverture/);
  const var_ = variantes(ctx);
  const s = {
    objet: ob, type_marche: type, procedure: proc, forme_prix: formePrix(P),
    attendus: ob ? [ob] : [],
    corps_etat: corpsEtat(lotsL.map(l => l.intitule).join(" ") + " " + ob + (lotsL.length ? "" : " " + T.slice(0, 15000))),
    lots: lotsL, allotissement, criteres: crit, criteres_total: total, qualifications: qual, capacites: capacites(ctx),
    candidature: pieces(cand, PIECES_CANDIDATURE), offre: pieces(off, PIECES_OFFRE),
    ...mt, duree: duree(ctx), date_limite: date, validite_offres: validite(P),
    ...vis, questions: q,
    variantes: var_.statut, variantes_texte: var_.texte, pse: pse(ctx), tranches: tranches(T, P), negociation: negociation(ctx),
    garanties: garanties(T, P), groupement: groupement(P),
    points_attention: pointsAttention(T),
  };
  const morceaux = [type + (proc ? ", " + proc.charAt(0).toLowerCase() + proc.slice(1) : "") + "."];
  if (lotsL.length > 1) morceaux.push(lotsL.length + " lots."); else if (allotissement) morceaux.push(allotissement + ".");
  if (date) morceaux.push("Remise des offres : " + date + ".");
  if (mt.montant_max || mt.montant_estime) morceaux.push((mt.montant_max ? "Maximum : " + mt.montant_max : "Estimation : " + mt.montant_estime) + ".");
  if (crit.length) morceaux.push("Critères : " + crit.map(c => c.critere + " " + c.ponderation).join(", ") + ".");
  if (vis.visite_type === "obligatoire") morceaux.push("Visite obligatoire" + (vis.visite_date ? " (" + vis.visite_date + ")" : "") + ".");
  if (s.variantes && !/^Mention/.test(s.variantes)) morceaux.push(s.variantes + ".");
  if (s.negociation) morceaux.push(s.negociation.replace(/ \(.*/, "") + ".");
  if (qual.length) morceaux.push("Qualifications citées : " + uniques(qual.map(x => x.split(/[\s,(]/)[0])).join(", ") + ".");
  s.synthese = morceaux.join(" ");
  return s;
}

module.exports = { textePdf, analyserTexte, nettoyer };
