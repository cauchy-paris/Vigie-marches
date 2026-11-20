"use strict";
const LIB = { connecte: "Connecté", deconnecte: "Non connecté", injoignable: "Injoignable", attente: "…" };
async function afficher() {
  const ul = document.getElementById("liste");
  const r = await chrome.runtime.sendMessage({ type: "etat" });
  ul.textContent = "";
  for (const p of r.plateformes) {
    const e = r.etat[p.cle] || "injoignable";
    const li = document.createElement("li");
    const nom = document.createElement("span"); nom.className = "nom"; nom.textContent = p.nom;
    const et = document.createElement("span"); et.className = "etat " + e; et.textContent = LIB[e];
    li.append(nom, et);
    if (e !== "connecte") { const a = document.createElement("a"); a.className = "btn"; a.href = p.accueil; a.target = "_blank"; a.textContent = "Se connecter"; li.append(a); }
    ul.append(li);
  }
}
const c = document.getElementById("maintien");
chrome.storage.local.get("maintien").then(({ maintien = true }) => { c.checked = maintien; });
c.onchange = () => chrome.storage.local.set({ maintien: c.checked });
document.getElementById("verifier").onclick = () => { document.getElementById("liste").innerHTML = '<li><span class="nom">Vérification…</span></li>'; afficher(); };
afficher();
