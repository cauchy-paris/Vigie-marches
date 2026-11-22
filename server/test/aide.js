// Démarre le serveur Vigie sur un port libre pour les tests (aucun appel extérieur).
"use strict";
const { spawn } = require("child_process");
const net = require("net");
const path = require("path");

const SITE = "https://vigie-marches.onrender.com";

function portLibre() {
  return new Promise(ok => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });
}

async function demarrerServeur(env = {}) {
  const port = await portLibre();
  const proc = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { PATH: process.env.PATH, PORT: String(port), VIGIE_SECRET: "secret-de-test", VIGIE_CODE_INSTALLATION: "code-test", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let journal = "";
  proc.stdout.on("data", d => { journal += d; });
  proc.stderr.on("data", d => { journal += d; });
  const base = "http://127.0.0.1:" + port;
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(base + "/sante"); if (r.ok) break; } catch (e) { /* pas encore prêt */ }
    await new Promise(r => setTimeout(r, 100));
    if (i === 99) throw new Error("le serveur ne démarre pas :\n" + journal);
  }
  let ip = 0;
  const appel = async (chemin, { corps, jeton, origine = SITE, methode, ipFixe } = {}) => {
    const r = await fetch(base + chemin, {
      method: methode || (corps ? "POST" : "GET"),
      headers: { Origin: origine, "Content-Type": "application/json", "X-Forwarded-For": ipFixe || "10.0.0." + (++ip % 250), ...(jeton ? { "X-Vigie": jeton } : {}) },
      body: corps ? JSON.stringify(corps) : undefined,
    });
    const texte = await r.text();
    let json = null; try { json = JSON.parse(texte); } catch (e) { /* pas du JSON */ }
    return { statut: r.status, json, texte, entetes: r.headers };
  };
  return { base, appel, journal: () => journal, arreter: () => new Promise(ok => { proc.once("exit", ok); proc.kill(); }) };
}

// Base Postgres neuve pour un test (TEST_DATABASE_URL = serveur Postgres de test ; sans elle, ces tests sont sautés)
async function baseNeuve() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return null;
  const { Client } = require("pg");
  const nom = "vigie_t_" + process.pid + "_" + Math.random().toString(36).slice(2, 8);
  const cx = new Client({ connectionString: url });
  await cx.connect();
  await cx.query("create database " + nom);
  await cx.end();
  const u = new URL(url); u.pathname = "/" + nom;
  return u.toString();
}
async function requete(url, sql, params) {
  const { Client } = require("pg");
  const cx = new Client({ connectionString: url });
  await cx.connect();
  try { return (await cx.query(sql, params)).rows; } finally { await cx.end(); }
}

module.exports = { demarrerServeur, SITE, baseNeuve, requete };
