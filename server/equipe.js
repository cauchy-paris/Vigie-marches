// Vigie Marchés : travail d'équipe dans une société.
// Un marché « J'y réponds » est pris par UN collaborateur de la société : les autres le voient
// (pas de doublon), l'administrateur de la société peut l'attribuer à quelqu'un d'autre,
// et l'étape de l'offre (en préparation, déposée, gagnée, perdue…) est partagée.
// Base Postgres : table vigie_equipe. Sans base : en mémoire (perdu au redémarrage du serveur).
"use strict";
const { membresSociete, baseDeDonnees, nomDe } = require("./comptes");

const ETAPES = new Set(["prepa", "depose", "gagne", "perdu", "sanssuite", "abandon"]);
const chef = moi => moi.r === "admin" || moi.r === "gerant";
const jourIso = d => (d instanceof Date ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString() : String(d)).slice(0, 10);
const dateValide = d => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d + "T12:00:00"));
const idValide = id => typeof id === "string" && id.length >= 1 && id.length <= 120;

/* ---------- stockage ---------- */
const memoire = new Map(); // "societe|id" -> entrée (sans base)
let tablePrete = null;
async function pool() {
  const p = baseDeDonnees();
  if (!p) return null;
  if (!tablePrete) tablePrete = p.query(`create table if not exists vigie_equipe (
    societe text not null,
    id text not null,
    m jsonb not null,
    collab text not null,
    etape text not null default 'prepa',
    montant numeric,
    par text,
    cree timestamptz not null default now(),
    maj timestamptz not null default now(),
    primary key (societe, id)
  );
  alter table vigie_equipe add column if not exists depot date`).catch(e => { tablePrete = null; throw e; });
  await tablePrete;
  return p;
}
const versEntree = l => ({ id: l.id, m: l.m, collab: l.collab, etape: l.etape, montant: l.montant == null ? null : Number(l.montant), dateDepot: l.depot ? jourIso(l.depot) : null, par: l.par, cree: new Date(l.cree).toISOString(), maj: new Date(l.maj).toISOString() });
async function lister(societe) {
  const p = await pool();
  if (!p) return [...memoire.values()].filter(e => e.societe === societe).map(({ societe: _s, ...e }) => e);
  return (await p.query("select * from vigie_equipe where societe = $1 order by maj desc", [societe])).rows.map(versEntree);
}
async function lire(societe, id) {
  const p = await pool();
  if (!p) { const e = memoire.get(societe + "|" + id); if (!e) return null; const { societe: _s, ...x } = e; return x; }
  const r = await p.query("select * from vigie_equipe where societe = $1 and id = $2", [societe, id]);
  return r.rows[0] ? versEntree(r.rows[0]) : null;
}
async function ecrire(societe, e) {
  const p = await pool();
  const maj = new Date().toISOString();
  if (!p) { const avant = memoire.get(societe + "|" + e.id); memoire.set(societe + "|" + e.id, { ...e, societe, cree: avant ? avant.cree : maj, maj }); return; }
  await p.query(`insert into vigie_equipe (societe, id, m, collab, etape, montant, depot, par) values ($1,$2,$3,$4,$5,$6,$7,$8)
    on conflict (societe, id) do update set m = excluded.m, collab = excluded.collab, etape = excluded.etape, montant = excluded.montant, depot = excluded.depot, par = excluded.par, maj = now()`,
  [societe, e.id, JSON.stringify(e.m), e.collab, e.etape, e.montant, e.dateDepot || null, e.par]);
}
async function retirer(societe, id) {
  const p = await pool();
  if (!p) { memoire.delete(societe + "|" + id); return; }
  await p.query("delete from vigie_equipe where societe = $1 and id = $2", [societe, id]);
}

// une entrée telle qu'envoyée au navigateur : avec le nom du collaborateur
const publique = e => e && ({ ...e, collabNom: nomDe(e.collab), parNom: e.par ? nomDe(e.par) : "" });
function lireMarche(m) {
  if (!m || typeof m !== "object") return null;
  const texte = JSON.stringify(m);
  if (texte.length > 40000) return null;
  return JSON.parse(texte);
}
const dateFr = d => new Date(d).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });

/* ---------- routes /equipe/... (utilisateur connecté : req.compte) ---------- */
async function routeEquipe(req, res, u, { json, lireCorps }) {
  const moi = req.compte, societe = moi.s, chemin = u.pathname.slice("/equipe/".length);
  try {
    if (chemin === "liste") {
      return json(res, 200, { entrees: (await lister(societe)).map(publique), membres: membresSociete(societe), moi: moi.e, chef: chef(moi), partage: !!baseDeDonnees() });
    }
    if (req.method !== "POST") return json(res, 405, { message: "POST attendu" });
    let c; try { c = JSON.parse(await lireCorps(req, 60000) || "{}"); } catch (e) { return json(res, 400, { message: "Demande illisible." }); }
    if (!idValide(c.id)) return json(res, 400, { message: "Marché invalide." });
    const avant = await lire(societe, c.id);
    const auteur = e => e.collab === moi.e || chef(moi);

    // prendre un marché pour soi, ou l'attribuer (administrateur de la société)
    if (chemin === "prendre") {
      let pour = moi.e;
      if (c.pour && c.pour !== moi.e) {
        if (!chef(moi)) return json(res, 403, { message: "Seul l'administrateur de la société peut attribuer un marché à un collaborateur." });
        pour = String(c.pour).toLowerCase();
        if (!membresSociete(societe).some(x => x.email === pour)) return json(res, 400, { message: "Ce collaborateur n'est pas dans votre société." });
      }
      if (avant && avant.collab !== pour && !chef(moi)) {
        return json(res, 409, { message: "Déjà pris par " + nomDe(avant.collab) + " depuis le " + dateFr(avant.cree) + ". Demandez à l'administrateur de votre société de vous l'attribuer.", entree: publique(avant) });
      }
      const m = lireMarche(c.m) || (avant && avant.m);
      if (!m) return json(res, 400, { message: "Informations du marché manquantes." });
      const e = { id: c.id, m, collab: pour, etape: (avant && avant.etape) || "prepa", montant: avant ? avant.montant : null, dateDepot: avant ? avant.dateDepot : null, par: moi.e };
      await ecrire(societe, e);
      console.log(new Date().toISOString(), "Équipe :", c.id, "→", pour, "par", moi.e);
      return json(res, 200, { entree: publique(await lire(societe, c.id)) });
    }

    // étape de l'offre : en préparation, déposée, gagnée, perdue…
    if (chemin === "etape") {
      if (!ETAPES.has(c.etape)) return json(res, 400, { message: "Étape inconnue." });
      if (c.dateDepot != null && !dateValide(c.dateDepot)) return json(res, 400, { message: "Date de dépôt invalide." });
      const depot = ["depose", "gagne", "perdu", "sanssuite"].includes(c.etape) ? (c.dateDepot || (avant && avant.dateDepot) || jourIso(new Date())) : null;
      if (!avant) {
        const m = lireMarche(c.m);
        if (!m) return json(res, 404, { message: "Ce marché n'est suivi par personne dans votre société." });
        await ecrire(societe, { id: c.id, m, collab: moi.e, etape: c.etape, montant: c.montant > 0 ? Number(c.montant) : null, dateDepot: depot, par: moi.e });
      } else {
        if (!auteur(avant)) return json(res, 403, { message: "Ce marché est suivi par " + nomDe(avant.collab) + "." });
        await ecrire(societe, { ...avant, m: lireMarche(c.m) || avant.m, etape: c.etape, montant: c.montant > 0 ? Number(c.montant) : c.montant === null ? null : avant.montant, dateDepot: depot, par: moi.e });
      }
      return json(res, 200, { entree: publique(await lire(societe, c.id)) });
    }

    // ne plus suivre le marché (il redevient libre pour l'équipe)
    if (chemin === "liberer") {
      if (!avant) return json(res, 200, { ok: true });
      if (!auteur(avant)) return json(res, 403, { message: "Ce marché est suivi par " + nomDe(avant.collab) + "." });
      await retirer(societe, c.id);
      console.log(new Date().toISOString(), "Équipe :", c.id, "libéré par", moi.e);
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { message: "Introuvable" });
  } catch (e) {
    console.log("Équipe : erreur", e.message);
    return json(res, 503, { message: "Le suivi de l'équipe ne répond pas : réessayez dans une minute." });
  }
}

module.exports = { routeEquipe };
