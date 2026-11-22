// Vigie Marchés : recherche directe sur les plateformes PLACE et Maximilien (logiciel Atexo, un seul
// connecteur) et AWS-Achat (marches-publics.info), pour voir aussi les consultations absentes du BOAMP
// (petits MAPA notamment). Le serveur interroge les plateformes (le navigateur ne le peut pas : CORS),
// garde les réponses 30 minutes en cache et espace ses requêtes pour ne pas se faire bloquer.
// Une plateforme en panne n'empêche pas les autres de répondre : chacune renvoie son propre état.
"use strict";
const { lireDate } = require("./fiche");

const SOURCES = {
  place: { nom: "PLACE", type: "atexo", origine: "https://www.marches-publics.gouv.fr" },
  maximilien: { nom: "Maximilien", type: "atexo", origine: "https://marches.maximilien.fr" },
  aws: { nom: "AWS-Achat", type: "aws", origine: "https://www.marches-publics.info" },
};
const DUREE_CACHE = 30 * 60000;
const PAUSE = 300;              // ms entre deux requêtes vers la même plateforme
const PAGES_ATEXO = 5;          // pages de 20 résultats par mot-clé
const PAGES_ATEXO_RECENTS = 10; // sans mot-clé : les 200 consultations les plus récentes
const MOTS_MAX = 4;             // mots-clés interrogés séparément sur Atexo
const PAGES_AWS = 10;           // pages de 10 résultats par recherche AWS
const REQUETES_AWS_MAX = 40;

/* ---------- outils texte ---------- */
const ENT = { eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", acirc: "â", ccedil: "ç", ocirc: "ô", ucirc: "û", icirc: "î", ugrave: "ù", iuml: "ï", euml: "ë", nbsp: " ", amp: "&", quot: '"', laquo: "«", raquo: "»", rsquo: "’", lsquo: "‘", apos: "'", lt: "<", gt: ">" };
const decoder = t => String(t || "").replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m).replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)));
const texte = h => decoder(String(h || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const attrVal = (bloc, nom) => { const m = bloc.match(new RegExp("\\s" + nom + "=\"([^\"]*)\"", "i")); return m ? decoder(m[1]).replace(/\s+/g, " ").trim() : ""; };
const CATEGORIES = { travaux: "TRAVAUX", services: "SERVICES", fournitures: "FOURNITURES" };
const plat = t => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// « (75) Paris, (77) Seine-et-Marne » -> ["75","77"]
function departements(t) {
  const r = [];
  for (const m of String(t || "").matchAll(/\((\d{2,3}|2A|2B)\)/gi)) { const d = m[1].toUpperCase(); if (!r.includes(d)) r.push(d); }
  return r;
}
// code postal -> département (Corse : 20xxx ne dit pas 2A ou 2B, on s'abstient)
function depDuCodePostal(cp) {
  if (!/^\d{5}$/.test(cp || "")) return "";
  if (/^97/.test(cp)) return cp.slice(0, 3);
  if (/^20/.test(cp)) return "";
  return cp.slice(0, 2);
}

/* ====================================================================
   Atexo (PLACE, Maximilien) : page « Recherche avancée »
   ==================================================================== */
function lireResultatsAtexo(html, origine) {
  const total = Number((String(html).match(/nombreElement"[^>]*>\s*(\d+)/) || String(html).match(/Nombre de r[ée]sultats[^0-9]{0,40}(\d+)/i) || [])[1] || 0);
  const blocs = String(html).split(/class="item_consultation\b/).slice(1);
  const items = [];
  for (const b of blocs) {
    const id = (b.match(/refCons"[^>]*value="(\d+)"/) || [])[1];
    const org = (b.match(/orgCons"[^>]*value="([a-z0-9]+)"/i) || [])[1];
    if (!id || !org) continue;
    const proc = b.match(/class="cons_procedure"[\s\S]*?<abbr\b([^>]*)>([\s\S]*?)<\/abbr>/);
    const categorie = texte((b.match(/class="cons_categorie"[^>]*>([\s\S]*?)<\/div>/) || [])[1]);
    const datePub = b.match(/class="date date-min[^"]*"[\s\S]*?<span>\s*(\d{1,2})\s*<\/span>[\s\S]*?<span>\s*([^<]+?)\s*<\/span>[\s\S]*?<span>\s*(\d{4})\s*<\/span>/);
    const refInt = b.match(/<div class="small pull-left">\s*([\s\S]*?)\s*<\/div>\s*<span[^>]*>\|<\/span>\s*<div class="small pull-left truncate">\s*<span\b([^>]*)>([\s\S]*?)<\/span>/);
    const objetBloc = (b.match(/panelBlocObjet"[\s\S]*?<strong>\s*Objet\s*:\s*<\/strong>[\s\S]*?<span class="small">([\s\S]*?)<\/div>/) || [])[1];
    const orgBloc = b.match(/panelBlocDenomination"[^>]*>\s*<div\b([^>]*)>([\s\S]*?)<\/div>/);
    const lots = Number((b.match(/(\d+)(?:&nbsp;|\s)+lots?\b/) || [])[1] || 0);
    const lieuxBloc = (b.match(/class="lieux-exe"[\s\S]*?<\/div>/) || [""])[0];
    const lieux = attrVal(lieuxBloc, "data-content") || texte(lieuxBloc).replace(/\s*\.\.\.\s*$/, "");
    const fin = b.match(/class="cloture-line"[\s\S]*?<span>\s*(\d{1,2})\s*<\/span>[\s\S]*?<span>\s*([^<]+?)\s*<\/span>[\s\S]*?<span>\s*(\d{4})\s*<\/span>/);
    const heure = (b.match(/class="cloture-line"[\s\S]*?<label[^>]*>\s*(\d{1,2}:\d{2})\s*<\/label>/) || [])[1];
    const intitule = refInt ? (attrVal(refInt[2], "data-original-title") || attrVal(refInt[2], "title") || texte(refInt[3])) : "";
    items.push({
      id, org,
      reference: refInt ? texte(refInt[1]) : "",
      intitule,
      objet: texte(objetBloc) || intitule,
      acheteur: orgBloc ? (attrVal(orgBloc[1], "data-original-title") || texte(orgBloc[2]).replace(/^Organisme\s*:\s*/i, "")) : "",
      procedure: proc ? (attrVal(proc[1], "data-original-title") || attrVal(proc[1], "title") || texte(proc[2])) : "",
      procedureCourte: proc ? texte(proc[2]) : "",
      types: CATEGORIES[plat(categorie)] ? [CATEGORIES[plat(categorie)]] : [],
      parution: datePub ? lireDate(datePub[1] + " " + datePub[2] + " " + datePub[3]) : "",
      limite: fin ? lireDate(fin[1] + " " + fin[2] + " " + fin[3] + (heure ? " " + heure : "")) : "",
      lieu: lieux,
      deps: departements(lieux),
      lots,
      url: origine + "/app.php/entreprise/consultation/" + id + "?orgAcronyme=" + org,
    });
  }
  return { total, items };
}

/* ---------- formulaire PRADO (postback : page suivante, tri, taille de page) ---------- */
function champsPrado(html) {
  const d = new URLSearchParams();
  for (const m of String(html).matchAll(/<input\b[^>]*>/gi)) {
    const b = m[0];
    const nom = (b.match(/\sname="([^"]*)"/i) || [])[1];
    if (!nom) continue;
    const type = ((b.match(/\stype="([^"]*)"/i) || [])[1] || "text").toLowerCase();
    if (/^(submit|button|image|file|reset)$/.test(type)) continue;
    if (/^(radio|checkbox)$/.test(type) && !/\schecked\b/i.test(b)) continue;
    if (/^form\[/.test(nom) || nom === "keyWord") continue; // formulaires de connexion et de recherche du bandeau
    d.set(decoder(nom), decoder((b.match(/\svalue="([^"]*)"/i) || [])[1] || (/^(radio|checkbox)$/.test(type) ? "on" : "")));
  }
  for (const m of String(html).matchAll(/<select\b[^>]*name="([^"]*resultSearch[^"]*)"[^>]*>([\s\S]*?)<\/select>/gi)) {
    const sel = m[2].match(/<option\b[^>]*selected[^>]*value="([^"]*)"|<option\b[^>]*value="([^"]*)"[^>]*selected/i);
    const prem = m[2].match(/<option\b[^>]*value="([^"]*)"/i);
    d.set(decoder(m[1]), sel ? (sel[1] ?? sel[2]) : prem ? prem[1] : "");
  }
  d.set("PRADO_POSTBACK_PARAMETER", "");
  return d;
}
const CIBLE_SUIVANTE = "ctl0$CONTENU_PAGE$resultSearch$PagerTop$ctl3";
const CIBLE_TRI_PUBLICATION = "ctl0$CONTENU_PAGE$resultSearch$tableauResultSearch$ctl0$ctl1";
const CIBLE_TAILLE = "ctl0$CONTENU_PAGE$resultSearch$listePageSizeTop";

async function postback(ctx, url, html, cible, change) {
  const d = champsPrado(html);
  if (!d.has("PRADO_PAGESTATE")) return null;
  if (change) for (const [k, v] of Object.entries(change)) d.set(k, v);
  d.set("PRADO_POSTBACK_TARGET", cible);
  return ctx.texte(url, { method: "POST", body: d, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
}

// Une recherche Atexo : première page puis pages suivantes (20 résultats par page)
async function parcourirAtexo(ctx, origine, motCle, pagesMax, recents) {
  const url = origine + "/?page=Entreprise.EntrepriseAdvancedSearch&AllCons" + (motCle ? "&keyWord=" + encodeURIComponent(motCle) : "");
  let html = await ctx.texte(url);
  if (!/item_consultation|Nombre de r[ée]sultats/i.test(html)) throw new Error("page de recherche illisible");
  // 20 résultats par page quand la plateforme en affiche 10 par défaut (Maximilien)
  if (/listePageSizeTop/.test(html) && /<option\b[^>]*value="20"/.test(html) && !/<option\b[^>]*selected[^>]*value="20"|<option\b[^>]*value="20"[^>]*selected/.test(html)) {
    html = (await postback(ctx, url, html, CIBLE_TAILLE, { [CIBLE_TAILLE]: "20" }).catch(() => null)) || html;
  }
  if (recents) {
    // tri par date de publication, la plus récente d'abord (le premier clic trie dans l'ordre croissant)
    for (let i = 0; i < 2; i++) {
      const h = await postback(ctx, url, html, CIBLE_TRI_PUBLICATION).catch(() => null);
      if (!h) break;
      html = h;
      const d = lireResultatsAtexo(html, origine).items.map(x => x.parution).filter(Boolean);
      if (d.length < 2 || d[0] >= d[d.length - 1]) break;
    }
  }
  let { total, items } = lireResultatsAtexo(html, origine);
  const vus = new Set(items.map(x => x.id));
  for (let p = 1; p < pagesMax && vus.size < total; p++) {
    const h = await postback(ctx, url, html, CIBLE_SUIVANTE).catch(() => null);
    if (!h) break;
    const r = lireResultatsAtexo(h, origine);
    const neufs = r.items.filter(x => !vus.has(x.id));
    if (!neufs.length) break;
    neufs.forEach(x => { vus.add(x.id); items.push(x); });
    html = h;
  }
  return { total, items };
}

async function rechercherAtexo(ctx, source, { mots, termes }) {
  const cles = mots ? [mots] : (termes || []).slice(0, MOTS_MAX);
  const vus = new Map();
  let partiel = false;
  if (!cles.length) {
    const r = await parcourirAtexo(ctx, source.origine, "", PAGES_ATEXO_RECENTS, true);
    r.items.forEach(x => vus.set(x.id, x));
    partiel = r.total > r.items.length;
  } else {
    for (const c of cles) {
      const r = await parcourirAtexo(ctx, source.origine, c, PAGES_ATEXO, false);
      r.items.forEach(x => { if (!vus.has(x.id)) vus.set(x.id, x); });
      if (r.total > r.items.length) partiel = true;
    }
    if ((termes || []).length > MOTS_MAX && !mots) partiel = true;
  }
  return { items: [...vus.values()], partiel };
}

/* ====================================================================
   AWS-Achat (marches-publics.info) : formulaire « Recherche avancée »
   ==================================================================== */
function lireResultatsAws(html, nature) {
  const h = String(html);
  const trop = h.match(/Votre recherche trouve\s+(\d+)\s+r[ée]sultats?\.\s*Veuillez pr[ée]ciser/i);
  if (trop) return { trop: Number(trop[1]), items: [], pages: 0 };
  const lettre = { TRAVAUX: "t", SERVICES: "s", FOURNITURES: "f" }[nature] || "t";
  const pages = Math.max(1, ...[...h.matchAll(new RegExp("pager_" + lettre + "=(\\d+)", "g"))].map(m => Number(m[1])));
  const items = [];
  for (const b of h.split(/id="entity"/).slice(1)) {
    const lien = (b.match(/href="(\/Annonces\/[^"]+\.htm)"/i) || [])[1];
    const idm = (b.match(/[?&;]IDM=(\d+)/) || [])[1] || (lien && (lien.match(/(\d{5,})\.htm$/) || [])[1]);
    if (!idm) continue;
    const ach = texte((b.match(/class="h2-avis"[^>]*>([\s\S]*?)<\/h2>/) || [])[1]);
    const cp = (ach.match(/\((\d{5})\)\s*$/) || [])[1] || "";
    const boite = (b.match(/id='titre_box'>([\s\S]*?)<\/div>\s*<\/div>/) || b.match(/id="titre_box">([\s\S]*?)<\/div>\s*<\/div>/) || [])[1] || "";
    const ref = texte((boite.match(/ref-acheteur">([\s\S]*?)<\/div>/) || [])[1]).replace(/^\[\s*r[ée]f\.?\s*/i, "").replace(/\]\s*$/, "").trim();
    const objet = texte(boite.replace(/<div class="col-12 col-md-12 ref-acheteur">[\s\S]*?<\/div>/, "").replace(/<p\b[\s\S]*?<\/p>/g, ""));
    const lots = Number((boite.match(/alloti\s*:\s*(\d+)\s*lots?/i) || [])[1] || 0);
    const pub = (b.match(/Publi[ée] le\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/) || [])[1];
    const lim = b.match(/Date limite\s*:\s*le\s*(\d{1,2}\/\d{1,2}\/\d{2,4})(?:\s*[àa]\s*(\d{1,2})h(\d{2}))?/);
    items.push({
      id: idm,
      reference: ref,
      objet: objet || "(sans objet)",
      acheteur: ach.replace(/\s*\(\d{5}\)\s*$/, ""),
      procedure: "",
      types: nature ? [nature] : [],
      parution: pub ? lireDate(pub) : "",
      limite: lim ? lireDate(lim[1] + (lim[2] ? " " + lim[2] + "h" + lim[3] : "")) : "",
      deps: depDuCodePostal(cp) ? [depDuCodePostal(cp)] : [],
      lieu: cp,
      lots,
      rectifie: /Avis rectifi/i.test(b),
      url: lien ? "https://www.marches-publics.info" + lien : "https://www.marches-publics.info/mpiaws/index.cfm?fuseaction=dce.dRC&IDM=" + idm,
      urlDce: "https://www.marches-publics.info/mpiaws/index.cfm?fuseaction=dematEnt.login&type=DCE&IDM=" + idm,
    });
  }
  return { trop: 0, items, pages };
}
const CODE_NATURE = { TRAVAUX: "T", SERVICES: "S", FOURNITURES: "F" };
const depAws = d => String(d).replace(/^0/, "").toLowerCase(); // « 01 » -> « 1 », « 2A » -> « 2a »

async function rechercherAws(ctx, source, { mots, type, deps }) {
  const natures = type && CODE_NATURE[type] ? [type] : ["TRAVAUX", "SERVICES", "FOURNITURES"];
  const base = source.origine + "/Annonces/lister";
  let requetes = 0, partiel = false;
  const vus = new Map();
  const formulaire = (nature, idr, parution) => new URLSearchParams({ IDE: "EC", IDN: CODE_NATURE[nature], listeCPV: "", IDP: "X", IDR: idr || "X", txtLibre: mots || "", txtLibreLieuExec: "", dateNotifDebut: "", dateNotifFin: "", txtAcheteurNom: "", txtAcheteurSiret: "", txtTitulaireNom: "", txtTitulaireSiret: "", txtLibreAcheteur: "", txtLibreVille: "", txtLibreRef: "", txtLibreObjet: "", dateParution: parution || "", dateExpiration: "", annee: "X", Rechercher: "Rechercher" });
  // une recherche + ses pages (le site garde la recherche en session : mêmes cookies, pages lues à la suite)
  const une = async (nature, idr, parution) => {
    if (requetes >= REQUETES_AWS_MAX) { partiel = true; return { trop: 0 }; }
    ctx.nouvelleSession();
    requetes++;
    const html = await ctx.texte(base, { method: "POST", body: formulaire(nature, idr, parution), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    const r = lireResultatsAws(html, nature);
    if (r.trop) return r;
    if (!r.items.length && !/h2-avis|Avis correspondent|aucun/i.test(html)) throw new Error("page de résultats illisible");
    r.items.forEach(x => { if (!vus.has(x.id)) vus.set(x.id, { ...x, depsFiltres: !!idr }); });
    const lettre = { TRAVAUX: "t", SERVICES: "s", FOURNITURES: "f" }[nature];
    for (let p = 2; p <= Math.min(r.pages, PAGES_AWS); p++) {
      if (requetes >= REQUETES_AWS_MAX) { partiel = true; break; }
      requetes++;
      const rp = lireResultatsAws(await ctx.texte(base + "?pager_" + lettre + "=" + p), nature);
      rp.items.forEach(x => { if (!vus.has(x.id)) vus.set(x.id, { ...x, depsFiltres: !!idr }); });
    }
    if (r.pages > PAGES_AWS) partiel = true;
    return r;
  };
  // trop de résultats : on découpe par département, puis on se limite aux avis récents
  const avecRepli = async (nature, liste) => {
    const idr = liste.map(depAws).join(",");
    let r = await une(nature, idr, liste.length ? "" : " < 8");
    if (!r.trop) return;
    if (liste.length > 1) { for (const d of liste) await avecRepli(nature, [d]); return; }
    for (const p of [" < 30", " < 8", " = 0"]) {
      r = await une(nature, idr, p);
      if (!r.trop) { partiel = true; return; }
    }
    partiel = true;
  };
  for (const n of natures) await avecRepli(n, (deps || []).slice(0, 30));
  return { items: [...vus.values()], partiel };
}

/* ====================================================================
   Accès réseau (cookies, pause entre requêtes), cache, état par plateforme
   ==================================================================== */
const files = new Map(); // origine -> dernière promesse (requêtes l'une après l'autre)
function contexte(origine, requete) {
  let jar = new Map();
  return {
    nouvelleSession() { jar = new Map(); },
    texte(url, opts) {
      const prec = files.get(origine) || Promise.resolve();
      const p = prec.catch(() => {}).then(async () => {
        const { rep } = await requete(url, jar, opts);
        if (!rep.ok) throw new Error("la plateforme répond " + rep.status);
        const t = await rep.text();
        await new Promise(r => setTimeout(r, PAUSE));
        return t;
      });
      files.set(origine, p.catch(() => {}));
      return p;
    },
  };
}

const cache = new Map(); // clé -> { t, promesse }
function enCache(cle, f) {
  const c = cache.get(cle);
  if (c && Date.now() - c.t < DUREE_CACHE) return c.promesse;
  const promesse = f();
  cache.set(cle, { t: Date.now(), promesse });
  promesse.catch(() => cache.delete(cle)); // une erreur n'est pas gardée : on réessaiera
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return promesse;
}
const normMots = t => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}' -]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80);

async function rechercherPlateformes(params, requete) {
  const srcs = (params.sources && params.sources.length ? params.sources : Object.keys(SOURCES)).filter(s => SOURCES[s]);
  const mots = normMots(params.mots);
  const termes = [...new Set((params.termes || []).map(normMots).filter(t => t.length >= 3))].slice(0, 8);
  const type = CODE_NATURE[params.type] ? params.type : "";
  const deps = [...new Set((params.deps || []).map(d => String(d).toUpperCase()).filter(d => /^(\d{2,3}|2A|2B)$/.test(d)))].sort();
  return Promise.all(srcs.map(async s => {
    const source = SOURCES[s];
    const debut = Date.now();
    try {
      // Atexo ne filtre ni le type ni le département dans l'adresse : le tri se fait dans Vigie, la clé du cache l'ignore
      const cle = source.type === "atexo" ? s + "|" + mots + "|" + (mots ? "" : termes.slice(0, MOTS_MAX).join(",")) : s + "|" + mots + "|" + type + "|" + deps.join(",");
      const r = await enCache(cle, () => withTimeout(
        source.type === "atexo" ? rechercherAtexo(contexte(source.origine, requete), source, { mots, termes }) : rechercherAws(contexte(source.origine, requete), source, { mots, type, deps }),
        params.delai || 90000));
      return { source: s, nom: source.nom, ok: true, nb: r.items.length, partiel: !!r.partiel, items: r.items, duree: Date.now() - debut };
    } catch (e) {
      console.log(new Date().toISOString(), "PLATEFORME", s, e.message);
      return { source: s, nom: source.nom, ok: false, nb: 0, items: [], message: source.nom + " n'a pas répondu (" + e.message + ")" };
    }
  }));
}
function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, ko) => setTimeout(() => ko(new Error("délai dépassé")), ms).unref())]);
}
function viderCache() { cache.clear(); }

module.exports = { rechercherPlateformes, lireResultatsAtexo, lireResultatsAws, champsPrado, departements, depDuCodePostal, depAws, viderCache, SOURCES };
