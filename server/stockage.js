// Vigie Marchés : où sont gardés les comptes et les sociétés clientes.
// - Avec DATABASE_URL (base Postgres, par exemple Neon gratuit) : tables vigie_societes et vigie_comptes,
//   plus une copie quotidienne de l'ensemble dans vigie_sauvegardes (30 jours gardés).
//   Au premier démarrage sur une base vide, les comptes de la variable VIGIE_COMPTES y sont recopiés.
// - Sans DATABASE_URL : fonctionnement d'origine, tout est dans la variable VIGIE_COMPTES de Render.
"use strict";

const JOURS_SAUVEGARDE = 30;

/* ---------- lecture de la variable VIGIE_COMPTES (ancien format : liste de comptes ; nouveau : {societes, comptes}) ---------- */
function lireVariable(texte) {
  let d;
  try { d = JSON.parse(texte || "[]"); } catch (e) { console.log("VIGIE_COMPTES illisible :", e.message); return { societes: [], comptes: [] }; }
  const comptes = (Array.isArray(d) ? d : (d && d.comptes) || []).filter(c => c && c.e && c.h);
  const societes = (Array.isArray(d) ? [] : (d && d.societes) || []).filter(s => s && s.id && s.nom);
  return { societes, comptes };
}

/* ---------- conversions base <-> mémoire ---------- */
const jour = d => (d instanceof Date ? d.toISOString() : String(d || "")).slice(0, 10);
const versCompte = l => ({ e: l.email, n: l.nom, r: l.role, s: l.societe, h: l.hachage, v: l.version, ...(l.provisoire ? { t: 1 } : {}), c: jour(l.cree) });
const versSociete = l => ({ id: l.id, nom: l.nom, places: l.places == null ? null : Number(l.places), actif: l.actif !== false, c: jour(l.cree) });

const SCHEMA = `
create table if not exists vigie_societes (
  id text primary key,
  nom text not null,
  places integer,
  actif boolean not null default true,
  cree date not null default current_date
);
create table if not exists vigie_comptes (
  email text primary key,
  nom text not null,
  role text not null check (role in ('admin', 'gerant', 'utilisateur')),
  societe text not null references vigie_societes(id),
  hachage text not null,
  version integer not null default 1,
  provisoire boolean not null default false,
  cree date not null default current_date,
  maj timestamptz not null default now()
);
create table if not exists vigie_sauvegardes (
  jour date primary key,
  contenu jsonb not null,
  le timestamptz not null default now()
);`;

/* ---------- mode base Postgres ---------- */
async function ouvrirBase(url, variable, preparer) {
  const { Pool } = require("pg");
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || /[?&]sslmode=disable/.test(url);
  const pool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000, ...(local || /sslmode=/.test(url) ? {} : { ssl: { rejectUnauthorized: true } }) });
  pool.on("error", e => console.log("Base de comptes :", e.message));
  await pool.query(SCHEMA);

  // première mise en route : recopie des comptes de la variable Render, dans une seule transaction
  const { rows: [{ n }] } = await pool.query("select count(*)::int as n from vigie_comptes");
  if (n === 0) {
    const depart = preparer(lireVariable(variable));
    if (depart.comptes.length) {
      const cx = await pool.connect();
      try {
        await cx.query("begin");
        for (const s of depart.societes) await cx.query("insert into vigie_societes (id, nom, places, actif, cree) values ($1,$2,$3,$4,coalesce($5::date, current_date)) on conflict (id) do nothing", [s.id, s.nom, s.places, s.actif, s.c || null]);
        for (const c of depart.comptes) await cx.query("insert into vigie_comptes (email, nom, role, societe, hachage, version, provisoire, cree) values ($1,$2,$3,$4,$5,$6,$7,coalesce($8::date, current_date)) on conflict (email) do nothing", [c.e, c.n, c.r, c.s, c.h, c.v, !!c.t, c.c || null]);
        await cx.query("commit");
        console.log("Base de comptes : " + depart.comptes.length + " compte(s) et " + depart.societes.length + " société(s) recopiés depuis VIGIE_COMPTES");
      } catch (e) { await cx.query("rollback").catch(() => {}); throw e; } finally { cx.release(); }
    }
  }
  const societes = (await pool.query("select * from vigie_societes order by nom")).rows.map(versSociete);
  const comptes = (await pool.query("select * from vigie_comptes order by email")).rows.map(versCompte);
  const lu = preparer({ societes, comptes });
  // comptes rattachés pendant la préparation (anciens comptes sans société) : enregistrés tout de suite
  for (const s of lu.societes) if (!societes.some(x => x.id === s.id)) await ecrireSociete(s);
  for (const c of lu.comptes) { const avant = comptes.find(x => x.e === c.e); if (!avant || avant.s !== c.s || avant.r !== c.r) await ecrireCompte(c); }

  async function ecrireCompte(c) {
    await pool.query(`insert into vigie_comptes (email, nom, role, societe, hachage, version, provisoire, cree, maj) values ($1,$2,$3,$4,$5,$6,$7,$8, now())
      on conflict (email) do update set nom = excluded.nom, role = excluded.role, societe = excluded.societe, hachage = excluded.hachage, version = excluded.version, provisoire = excluded.provisoire, maj = now()`,
    [c.e, c.n, c.r, c.s, c.h, c.v, !!c.t, c.c || jour(new Date())]);
  }
  async function ecrireSociete(s) {
    await pool.query(`insert into vigie_societes (id, nom, places, actif, cree) values ($1,$2,$3,$4,$5)
      on conflict (id) do update set nom = excluded.nom, places = excluded.places, actif = excluded.actif`, [s.id, s.nom, s.places, s.actif, s.c || jour(new Date())]);
  }
  return {
    mode: "base", societes: lu.societes, comptes: lu.comptes,
    ecrireCompte, ecrireSociete,
    supprimerCompte: e => pool.query("delete from vigie_comptes where email = $1", [e]),
    supprimerSociete: id => pool.query("delete from vigie_societes where id = $1", [id]),
    // copie du jour (la dernière de la journée remplace la précédente), 30 jours gardés
    async copieDuJour(contenu) {
      await pool.query("insert into vigie_sauvegardes (jour, contenu) values (current_date, $1) on conflict (jour) do update set contenu = excluded.contenu, le = now()", [JSON.stringify(contenu)]);
      await pool.query("delete from vigie_sauvegardes where jour < current_date - $1::int", [JOURS_SAUVEGARDE]);
    },
    async copies() { return (await pool.query("select jour, le, jsonb_array_length(contenu->'comptes') as comptes from vigie_sauvegardes order by jour desc")).rows.map(l => ({ jour: jour(l.jour), le: l.le, comptes: l.comptes })); },
    async copie(j) { const r = await pool.query("select contenu from vigie_sauvegardes where jour = $1", [j]); return r.rows[0] ? r.rows[0].contenu : null; },
    pool,
    fermer: () => pool.end(),
  };
}

/* ---------- mode variable Render (sans base) ---------- */
function ouvrirVariable(variable, preparer) {
  const lu = preparer(lireVariable(variable));
  const rien = async () => {};
  return { mode: "variable", societes: lu.societes, comptes: lu.comptes, ecrireCompte: rien, ecrireSociete: rien, supprimerCompte: rien, supprimerSociete: rien, copieDuJour: rien, copies: async () => [], copie: async () => null, pool: null, fermer: rien };
}

async function ouvrir(preparer) {
  const url = process.env.DATABASE_URL;
  return url ? ouvrirBase(url, process.env.VIGIE_COMPTES, preparer) : ouvrirVariable(process.env.VIGIE_COMPTES, preparer);
}

module.exports = { ouvrir, lireVariable };
