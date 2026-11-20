// Pont entre la page Vigie Marchés et l'extension.
// Vigie envoie : window.postMessage({ vigie: "ext", n, type: "dce", demande }) et { vigie: "ext", n, type: "code", code }.
// L'extension répond : { vigieExt: true, n, type: "etape" | "captcha" | "fichier" | "erreur", ... }.
"use strict";
const VERSION = chrome.runtime.getManifest().version;
document.documentElement.dataset.vigieExt = VERSION;
const ports = new Map();
const versPage = m => window.postMessage({ vigieExt: true, ...m }, location.origin);
window.addEventListener("message", e => {
  if (e.source !== window || e.origin !== location.origin || !e.data || e.data.vigie !== "ext") return;
  const { n, type } = e.data;
  if (type === "ping") return versPage({ n, type: "pong", version: VERSION });
  if (type === "code") { const p = ports.get(n); if (p) p.port.postMessage({ type: "code", code: e.data.code }); return; }
  if (type !== "dce") return;
  const port = chrome.runtime.connect({ name: "vigie" });
  // garde le service de l'extension éveillé pendant un long retrait
  const reveil = setInterval(() => { try { port.postMessage({ type: "reveil" }); } catch (x) {} }, 20000);
  const etat = { port, morceaux: [], nom: "", mime: "" };
  ports.set(n, etat);
  const fin = () => { clearInterval(reveil); ports.delete(n); try { port.disconnect(); } catch (x) {} };
  port.onMessage.addListener(m => {
    if (m.type === "fichier") { etat.nom = m.nom; etat.mime = m.mime; etat.taille = m.taille; return; }
    if (m.type === "morceau") {
      const bin = atob(m.b64), o = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i);
      etat.morceaux.push(o);
      versPage({ n, type: "progression", recu: etat.morceaux.reduce((a, x) => a + x.length, 0), taille: etat.taille });
      return;
    }
    if (m.type === "fin") {
      const donnees = new Uint8Array(etat.morceaux.reduce((a, x) => a + x.length, 0));
      let i = 0; for (const x of etat.morceaux) { donnees.set(x, i); i += x.length; }
      window.postMessage({ vigieExt: true, n, type: "fichier", nom: etat.nom, mime: etat.mime, donnees: donnees.buffer }, location.origin, [donnees.buffer]);
      return fin();
    }
    versPage({ n, ...m });
    if (m.type === "erreur") fin();
  });
  port.onDisconnect.addListener(() => { if (ports.has(n)) { versPage({ n, type: "erreur", message: "L'extension a été interrompue, relancez le téléchargement" }); fin(); } });
  port.postMessage({ type: "dce", demande: e.data.demande });
});
