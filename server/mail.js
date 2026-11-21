// Vigie Marchés : lecture des alertes des plateformes dans une boîte mail IMAP
// (Gmail avec mot de passe d'application, OVH, Orange, Free, Yahoo, iCloud…).
// Le serveur ne garde rien : identifiants reçus à chaque demande, jamais écrits ni journalisés.
// Seuls les mails qui ressemblent à des alertes de marchés publics sont renvoyés.
"use strict";
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");

const EXPEDITEURS = /(^|[@.])(boamp\.fr|dila\.gouv\.fr|marches-publics\.gouv\.fr|maximilien\.fr|aws-france\.com|aws-achat\.com|marches-publics\.info|achatsolutions\.fr|achatpublic\.com|achatpublic\.info|e-marchespublics\.com|marchesonline\.com|francemarches\.com|klekoon\.com|marches-securises\.fr|megalis\.bretagne\.bzh|local-trust\.com|atexo\.com|ted\.europa\.eu)$/i;
const SUJET_ALERTE = /alerte|veille|nouvelle?s? (?:consultation|annonce|avis)|avis (?:de march[ée]|d.appel)|appels? d.offres/i;
const SUJET_ECHANGE = /non retenu|compl[ée]ment|notification|courrier aws|question|r[ée]ponse [àa]|rejet|attribution|n[ée]gociation|invitation|accus[ée] de r[ée]ception|d[ée]p[ôo]t|mot de passe|identifiant|compte|confirmation d.inscription/i;

// messages des plateformes sur une consultation suivie : questions-réponses, rectificatifs, report de date…
const SUJET_MODIF = /question|r[ée]ponse|rectifi|modifi|report|prolong|compl[ée]ment d.information|information compl|mise [àa] jour|nouvelle version|nouveau document|dce|avis d.annulation|annul|message|courrier|correspondance/i;
const SUJET_HORS_MODIF = /non retenu|rejet|attribution|notification du march|accus[ée] de r[ée]ception|d[ée]p[ôo]t (de|du|d.une)|mot de passe|identifiant|confirmation d.inscription|n[ée]gociation|invitation/i;
function estMessageSuivi(adresse, sujet) {
  const dom = String(adresse || "").toLowerCase().split("@")[1] || "";
  return EXPEDITEURS.test(dom) && SUJET_MODIF.test(sujet || "") && !SUJET_HORS_MODIF.test(sujet || "") && !SUJET_ALERTE.test(sujet || "");
}

function estAlerte(adresse, sujet) {
  const dom = String(adresse || "").toLowerCase().split("@")[1] || "";
  if (!EXPEDITEURS.test(dom) && !SUJET_ALERTE.test(sujet || "")) return false;
  if (SUJET_ECHANGE.test(sujet || "") && !/alerte|veille/i.test(sujet || "")) return false;
  return true;
}

// Gmail : « Tous les messages » contient aussi les alertes rangées par un filtre (libellés)
async function dossiers(client) {
  const liste = await client.list();
  const tous = liste.find(b => b.specialUse === "\\All");
  return tous ? [tous.path] : ["INBOX"];
}

async function lireAlertes({ hote, port, utilisateur, motdepasse, depuis, max = 150, messages: avecMessages = false }) {
  const client = new ImapFlow({
    host: hote, port, secure: true, auth: { user: utilisateur, pass: motdepasse },
    logger: false, socketTimeout: 60000, greetingTimeout: 15000, connectionTimeout: 15000,
    tls: { servername: hote, minVersion: "TLSv1.2" },
  });
  client.on("error", () => {});
  await client.connect();
  const mails = [], messages = []; let parcourus = 0, echanges = 0;
  try {
    for (const dossier of await dossiers(client)) {
      const verrou = await client.getMailboxLock(dossier, { readOnly: true });
      try {
        const uids = (await client.search({ since: depuis }, { uid: true })) || [];
        const recents = uids.slice(-2000);
        const retenus = [], suivis = [];
        for await (const m of client.fetch(recents, { uid: true, envelope: true, size: true }, { uid: true })) {
          parcourus++;
          const de = (m.envelope.from && m.envelope.from[0]) || {};
          if (avecMessages && estMessageSuivi(de.address, m.envelope.subject)) { if (m.size < 3e6) suivis.push(m.uid); }
          else if (estAlerte(de.address, m.envelope.subject)) { if (m.size < 3e6) retenus.push(m.uid); }
          else if (EXPEDITEURS.test((String(de.address || "").split("@")[1]) || "")) echanges++;
        }
        for (const uid of retenus.reverse().slice(0, max)) {
          const m = await client.fetchOne(uid, { source: true }, { uid: true });
          if (!m || !m.source) continue;
          const p = await simpleParser(m.source, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true });
          const de = (p.from && p.from.value && p.from.value[0]) || {};
          mails.push({
            id: "imap:" + dossier + ":" + uid, sujet: p.subject || "", de: de.address || "", nomDe: de.name || "",
            date: p.date ? p.date.toISOString() : "",
            html: typeof p.html === "string" ? p.html.slice(0, 1.5e6) : "", texte: p.html ? "" : String(p.text || "").slice(0, 3e5),
          });
        }
        // messages des plateformes (questions-réponses, rectificatifs) : texte court, sans pièces jointes
        for (const uid of suivis.reverse().slice(0, 60)) {
          const m = await client.fetchOne(uid, { source: true }, { uid: true });
          if (!m || !m.source) continue;
          const p = await simpleParser(m.source, { skipImageLinks: true, skipTextToHtml: true });
          const de = (p.from && p.from.value && p.from.value[0]) || {};
          const html = typeof p.html === "string" ? p.html : "";
          const liens = [...new Set([...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(x => x[1].replace(/&amp;/g, "&")).filter(u => /^https?:/i.test(u)))].slice(0, 30);
          messages.push({
            id: "imap:" + dossier + ":" + uid, sujet: p.subject || "", de: de.address || "", nomDe: de.name || "",
            date: p.date ? p.date.toISOString() : "", texte: String(p.text || "").replace(/\s+/g, " ").slice(0, 4000), liens,
          });
        }
      } finally { verrou.release(); }
    }
  } finally { try { await client.logout(); } catch (e) { client.close(); } }
  return avecMessages ? { mails, messages, parcourus, echanges } : { mails, parcourus, echanges };
}

module.exports = { lireAlertes, estAlerte, estMessageSuivi };
