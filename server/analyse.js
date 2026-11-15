// Vigie Marchés : lecture du règlement de consultation (RC) et synthèse par l'IA de Claude.
"use strict";
const zlib = require("zlib");

/* ---------- lecture des archives ZIP (DCE, .docx, .odt) sans dépendance ---------- */
function lireZip(buf) {
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  if (fin < 0) return [];
  const nb = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  const r = [];
  for (let k = 0; k < nb && p + 46 <= buf.length; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const methode = buf.readUInt16LE(p + 10), taille = buf.readUInt32LE(p + 20), tailleReelle = buf.readUInt32LE(p + 24);
    const ln = buf.readUInt16LE(p + 28), le = buf.readUInt16LE(p + 30), lc = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nomBrut = buf.subarray(p + 46, p + 46 + ln);
    const utf8 = buf.readUInt16LE(p + 8) & 0x800;
    const nom = utf8 ? nomBrut.toString("utf8") : nomBrut.toString("latin1");
    r.push({
      nom, taille: tailleReelle,
      lire: () => {
        const debut = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const data = buf.subarray(debut, debut + taille);
        if (methode === 0) return data;
        if (methode === 8) return zlib.inflateRawSync(data, { maxOutputLength: 60 * 1024 * 1024 });
        throw new Error("compression non gérée");
      },
    });
    p += 46 + ln + le + lc;
  }
  return r;
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const xmlTexte = x => x
  .replace(/<\/(w:p|text:p|text:h)>/g, "\n").replace(/<(w:tab|text:tab)\b[^>]*\/>/g, "\t").replace(/<w:br\b[^>]*\/>/g, "\n")
  .replace(/<[^>]+>/g, "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, n) => n[0] === "#" ? String.fromCodePoint(n[1] === "x" ? parseInt(n.slice(2), 16) : +n.slice(1)) : (ENT[n] ?? m))
  .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

// Ancien format Word (.doc) : on récupère les suites de caractères lisibles.
function texteDoc(buf) {
  const u16 = (buf.toString("utf16le").match(/[\p{L}\p{N}\p{P}\p{Zs}€°\n\r\t]{5,}/gu) || []).join("\n");
  const l1 = (buf.toString("latin1").match(/[A-Za-zÀ-ÿ0-9.,;:!?'"()%€°\/\- \n\r\t]{6,}/g) || []).join("\n");
  return (u16.length > l1.length ? u16 : l1).slice(0, 400000);
}

const estPdf = b => { const i = b.subarray(0, 1024).indexOf("%PDF"); return i >= 0 && i < 16; };
const estZip = b => b.length > 4 && b.readUInt32LE(0) === 0x04034b50;
const estOle = b => b.length > 8 && b.readUInt32BE(0) === 0xd0cf11e0;

/* Transforme le fichier reçu en contenu lisible par Claude :
   { pdf: Buffer } ou { texte: string }, avec le nom du fichier retenu. */
function extraire(buf, nom, profondeur = 0) {
  if (!estZip(buf) && estPdf(buf)) return { pdf: buf.subarray(buf.indexOf("%PDF")), nom };
  if (estOle(buf)) return { texte: texteDoc(buf), nom };
  if (!estZip(buf)) {
    const t = buf.toString("utf8");
    if (/^\s*</.test(t)) return null; // page HTML : pas de fichier
    return { texte: t.slice(0, 400000), nom };
  }
  const entrees = lireZip(buf);
  const doc = entrees.find(e => e.nom === "word/document.xml");
  if (doc) return { texte: xmlTexte(doc.lire().toString("utf8")), nom };
  const odt = entrees.find(e => e.nom === "content.xml");
  if (odt && entrees.some(e => e.nom === "mimetype")) return { texte: xmlTexte(odt.lire().toString("utf8")), nom };
  if (profondeur > 1) return null;
  // Archive contenant plusieurs pièces : on prend celle qui ressemble au RC.
  const fichiers = entrees.filter(e => !/\/$/.test(e.nom) && /\.(pdf|docx?|odt|zip)$/i.test(e.nom) && e.taille < 40e6);
  const score = e => {
    const n = e.nom.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    let s = 0;
    if (/reglement|\brc\b|[_\- .]rc[_\- .]|^rc|\/rc/.test(n)) s += 10;
    if (/consultation/.test(n)) s += 3;
    if (/ccap|cctp|ae\b|acte d.engagement|dpgf|bpu|dqe|plan/.test(n)) s -= 6;
    if (/annexe/.test(n)) s -= 4;
    if (/\.pdf$/.test(n)) s += 2;
    return s;
  };
  fichiers.sort((a, b) => score(b) - score(a));
  for (const f of fichiers.slice(0, 3)) {
    try { const r = extraire(f.lire(), f.nom.split("/").pop(), profondeur + 1); if (r) return r; } catch (e) {}
  }
  return null;
}

/* Toutes les pièces lisibles d'une archive RC (RC + annexes), la principale en premier. */
function extraireTous(buf, nom) {
  if (!estZip(buf) || lireZip(buf).some(e => e.nom === "word/document.xml" || e.nom === "content.xml")) { const r = extraire(buf, nom); return r ? [r] : []; }
  const premier = extraire(buf, nom);
  const r = premier ? [premier] : [];
  for (const e of lireZip(buf).filter(e => !/\/$/.test(e.nom) && /\.(pdf|docx?|odt)$/i.test(e.nom) && e.taille < 40e6 && !/ccap|cctp|dpgf|bpu|dqe|acte d.engagement|(^|[^a-z])ae([^a-z]|$)/i.test(e.nom.split("/").pop())).slice(0, 12)) {
    const n = e.nom.split("/").pop();
    if (premier && n === premier.nom) continue;
    try { const x = extraire(e.lire(), n, 2); if (x) r.push(x); } catch (err) {}
    if (r.length >= 8) break;
  }
  return r;
}

/* ---------- consigne et format de la synthèse ---------- */
const CONSIGNE = `Tu es un expert des marchés publics français qui aide une PME du bâtiment et des services à décider vite si elle répond à un appel d'offres.
On te donne le règlement de consultation (RC) d'une consultation, et/ou les données de l'avis publié au BOAMP.
Extrais les informations demandées, en français, de façon factuelle et concise. N'invente rien : si une information n'apparaît pas dans les documents, mets une chaîne vide ou une liste vide.
- type_marche : nature (travaux, services, fournitures) et forme (marché ordinaire, accord-cadre à bons de commande, mono ou multi-attributaire, marché à tranches…).
- montants : reprends exactement les montants minimum, maximum et estimés indiqués (HT ou TTC précisé), par lot si besoin, dans montant_min / montant_max / montant_estime.
- criteres : chaque critère de jugement des offres avec sa pondération (ex. « 60 % » ou « 40 points ») et ses sous-critères éventuels.
- qualifications : qualifications et certifications professionnelles demandées ou acceptées en équivalence (Qualibat avec le numéro et l'intitulé, Qualifelec, Qualipac, RGE, OPQIBI, ISO, MASE, habilitations électriques, amiante SS3/SS4, CACES…).
- capacites : autres conditions de participation (chiffre d'affaires minimum, références, effectifs, assurances…).
- points_attention : ce qui peut faire perdre l'offre ou changer la décision (visite obligatoire, échantillons, variantes, négociation, pénalités, délais serrés, clauses sociales ou environnementales, BIM, avance, retenue de garantie…).
- synthese : 3 à 5 phrases pour un chef d'entreprise pressé.`;

const S = { type: "string" };
const L = { type: "array", items: { type: "string" } };
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["synthese", "type_marche", "procedure", "attendus", "corps_etat", "lots", "criteres", "qualifications", "capacites", "montant_min", "montant_max", "montant_estime", "duree", "visite", "date_limite", "points_attention"],
  properties: {
    synthese: S, type_marche: S, procedure: S,
    attendus: L, corps_etat: L,
    lots: { type: "array", items: { type: "object", additionalProperties: false, required: ["numero", "intitule", "montant"], properties: { numero: S, intitule: S, montant: S } } },
    criteres: { type: "array", items: { type: "object", additionalProperties: false, required: ["critere", "ponderation", "sous_criteres"], properties: { critere: S, ponderation: S, sous_criteres: L } } },
    qualifications: L, capacites: L,
    montant_min: S, montant_max: S, montant_estime: S,
    duree: S, visite: S, date_limite: S,
    points_attention: L,
  },
};

let client = null;
function claude() {
  if (!client) { const Anthropic = require("@anthropic-ai/sdk"); client = new Anthropic(); }
  return client;
}
const MODELE = process.env.MODELE_ANALYSE || "claude-opus-5-5";

/* rc : { pdf } ou { texte } ou null ; avis : texte de l'avis BOAMP */
async function analyser(rc, avis) {
  const contenu = [];
  if (rc && rc.pdf) contenu.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: rc.pdf.toString("base64") }, title: rc.nom || "Règlement de consultation" });
  if (rc && rc.texte) contenu.push({ type: "text", text: "RÈGLEMENT DE CONSULTATION (" + (rc.nom || "texte") + ") :\n\n" + rc.texte.slice(0, 300000) });
  if (avis) contenu.push({ type: "text", text: "DONNÉES DE L'AVIS BOAMP :\n\n" + avis.slice(0, 80000) });
  contenu.push({ type: "text", text: rc ? "Fais la synthèse de cette consultation, en t'appuyant d'abord sur le règlement de consultation." : "Le règlement de consultation n'est pas disponible : fais la synthèse à partir de l'avis seul." });

  const flux = claude().beta.messages.stream({
    model: MODELE,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: CONSIGNE,
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: contenu }],
  });
  const rep = await flux.finalMessage();
  if (rep.stop_reason === "refusal") throw new Error("L'IA a refusé d'analyser ce document.");
  if (rep.stop_reason === "max_tokens") throw new Error("Synthèse trop longue, interrompue.");
  const bloc = rep.content.find(b => b.type === "text");
  if (!bloc) throw new Error("Réponse vide de l'IA.");
  const u = rep.usage || {};
  console.log(new Date().toISOString(), "ANALYSE", rep.model, "entree=" + u.input_tokens, "sortie=" + u.output_tokens);
  return JSON.parse(bloc.text);
}

module.exports = { extraire, extraireTous, analyser, lireZip };
