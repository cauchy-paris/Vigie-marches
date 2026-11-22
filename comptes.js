/* Vigie Marchés : comptes et mot de passe.
   - Écran de connexion avant l'application (et installation du premier compte administrateur).
   - Tout fetch vers le serveur DCE reçoit l'en-tête X-Vigie (session) ; tout lien <a> vers ce serveur
     reçoit &acces= au moment du clic (lien valable 7 jours).
   - Menu du compte dans le bandeau : changer son mot de passe, gérer les comptes (administrateur), se déconnecter.
   Les données de veille (statuts, filtres, connexions drive et mail) restent dans ce navigateur. */
(function () {
  "use strict";
  const SERVEUR = "https://vigie-marches-dce.onrender.com";
  const CLE = "vigie.session.v1";
  let session = null;
  try { session = JSON.parse(localStorage.getItem(CLE) || "null"); } catch (e) {}
  const garder = s => { session = s; try { s ? localStorage.setItem(CLE, JSON.stringify(s)) : localStorage.removeItem(CLE); } catch (e) {} };
  const derniereAdresse = () => { try { const s = JSON.parse(localStorage.getItem(CLE) || "null"); return (s && s.compte && s.compte.email) || ""; } catch (e) { return ""; } };
  const expire = j => { try { return JSON.parse(atob(j.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"))).x < Date.now() + 60000; } catch (e) { return true; } };

  /* ---------- en-tête X-Vigie sur les appels au serveur ---------- */
  const fetchOrigine = window.fetch.bind(window);
  window.fetch = function (entree, init) {
    const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : (entree && entree.url) || "";
    if (!url.startsWith(SERVEUR) || url.startsWith(SERVEUR + "/compte/") || !session) return fetchOrigine(entree, init);
    const h = new Headers((init && init.headers) || (entree instanceof Request ? entree.headers : undefined));
    h.set("X-Vigie", session.jeton);
    return fetchOrigine(entree, { ...(init || {}), headers: h }).then(rep => {
      if (rep.status === 401 && rep.headers.get("X-Vigie-Connexion")) setTimeout(() => sessionPerdue(), 0);
      return rep;
    });
  };
  const appel = (chemin, corps) => fetchOrigine(SERVEUR + "/compte/" + chemin, {
    method: corps ? "POST" : "GET",
    headers: { ...(corps ? { "Content-Type": "application/json" } : {}), ...(session ? { "X-Vigie": session.jeton } : {}) },
    body: corps ? JSON.stringify(corps) : undefined, signal: AbortSignal.timeout(90000),
  }).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.message || "Erreur " + r.status); e.statut = r.status; throw e; } return j; });

  /* ---------- jeton sur les liens ouverts dans un nouvel onglet ---------- */
  function avecAcces(a) {
    if (!session || !session.lien) return;
    try { const u = new URL(a.href); if (u.origin !== SERVEUR) return; u.searchParams.set("acces", session.lien); a.href = u.href; } catch (e) {}
  }
  for (const ev of ["click", "auxclick", "contextmenu"]) document.addEventListener(ev, e => { const a = e.target.closest && e.target.closest("a[href]"); if (a) avecAcces(a); }, true);

  /* ---------- styles ---------- */
  const css = document.createElement("style");
  css.textContent = `
.cx-voile{position:fixed;inset:0;z-index:1000;background:var(--fond,#f3f6fc);display:grid;place-items:center;padding:20px;overflow:auto}
.cx-boite{width:min(420px,100%);background:#fff;border-radius:14px;box-shadow:0 20px 60px rgba(13,34,87,.18);overflow:hidden}
.cx-tete{background:var(--bleu,#16337a);color:#fff;border-bottom:4px solid var(--rouge,#d22d39);padding:18px 22px}
.cx-tete h1{margin:0;font:800 22px/1.2 var(--f-titre,system-ui)}
.cx-tete p{margin:4px 0 0;opacity:.85;font-size:13.5px}
.cx-corps{padding:20px 22px;display:grid;gap:12px}
.cx-corps label{display:grid;gap:4px;font-weight:600;font-size:13px;color:var(--bleu-fonce,#0d2257)}
.cx-corps input,.cx-corps select{border:1.5px solid var(--trait,#d5ddef);border-radius:8px;padding:9px 11px;font:inherit;font-weight:400;width:100%;box-sizing:border-box;background:#fff}
.cx-corps input:focus{border-color:var(--bleu-moyen,#3a5fc4);outline:none;box-shadow:0 0 0 3px var(--bleu-clair,#e8eefb)}
.cx-msg{font-size:13.5px;border-radius:8px;padding:9px 12px;margin:0}
.cx-msg.err{background:var(--rouge-clair,#fdeced);border-left:4px solid var(--rouge,#d22d39)}
.cx-msg.info{background:var(--bleu-clair,#e8eefb);border-left:4px solid var(--bleu,#16337a)}
.cx-msg.ok{background:#e3f4ea;border-left:4px solid #1c7c4d}
.cx-msg:empty{display:none}
.cx-petit{font-size:12.5px;color:var(--gris,#5b6785);margin:0}
.cx-code{font:600 18px/1.3 var(--f-mono,ui-monospace,monospace);letter-spacing:.06em;background:var(--bleu-clair,#e8eefb);padding:8px 12px;border-radius:8px;user-select:all;word-break:break-all}
.cx-coller{font:12px/1.4 var(--f-mono,ui-monospace,monospace);width:100%;min-height:70px;box-sizing:border-box}
dialog.cx-dlg{border:0;border-radius:14px;padding:0;width:min(640px,calc(100% - 32px));box-shadow:0 20px 60px rgba(13,34,87,.25)}
dialog.cx-dlg::backdrop{background:rgba(13,34,87,.45)}
.cx-dlg .cx-tete{display:flex;justify-content:space-between;align-items:center;gap:10px}
.cx-dlg .cx-tete h1{font-size:18px}
.cx-fermer{background:none;border:0;color:#fff;font-size:22px;cursor:pointer;line-height:1}
.cx-table{width:100%;border-collapse:collapse;font-size:13px}
.cx-table th{text-align:left;color:var(--bleu,#16337a);font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1.5px solid var(--trait,#d5ddef);padding:6px 4px}
.cx-table td{border-bottom:1px solid var(--trait,#d5ddef);padding:7px 4px;vertical-align:middle}
.cx-table td:last-child{text-align:right;white-space:nowrap}
.cx-table .btn{padding:4px 8px;font-size:12px}
.cx-ligne{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end}
@media (max-width:560px){.cx-ligne{grid-template-columns:1fr}.cx-table .cx-mail{display:none}}
.cx-menu{position:absolute;z-index:50;background:#fff;color:var(--encre,#14203d);border-radius:10px;box-shadow:0 12px 32px rgba(13,34,87,.25);min-width:230px;padding:6px;display:grid}
.cx-menu .cx-qui{padding:8px 10px;font-size:12.5px;color:var(--gris,#5b6785);border-bottom:1px solid var(--trait,#d5ddef);margin-bottom:4px}
.cx-menu .cx-qui b{display:block;color:var(--bleu-fonce,#0d2257);font-size:14px}
.cx-menu button{background:none;border:0;text-align:left;padding:9px 10px;border-radius:6px;cursor:pointer;font-weight:600;color:var(--bleu,#16337a)}
.cx-menu button:hover{background:var(--bleu-clair,#e8eefb)}
.cx-menu button.rouge{color:var(--rouge,#d22d39)}
.cx-menu .cx-titre{padding:8px 10px 2px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--rouge,#d22d39)}
.cx-menu .cx-note{padding:2px 10px 6px;font-size:12px;color:var(--gris,#5b6785);max-width:260px}
.cx-roue{width:40px;height:40px;flex:none;border-radius:50%;border:1.5px solid rgba(255,255,255,.5);background:transparent;color:#fff;display:grid;place-items:center;cursor:pointer;padding:0}
.cx-roue:hover{background:rgba(255,255,255,.15)}
@media (max-width:900px){.bandeau-in{position:relative}.cx-roue{position:absolute;top:12px;right:14px}.bandeau .marque{padding-right:48px}}
.cx-menu{max-width:calc(100vw - 16px)}
.cx-roue svg{transition:transform .3s}.cx-roue:hover svg{transform:rotate(45deg)}`;
  document.head.appendChild(css);

  const el = (tag, attrs = {}, ...enfants) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === "text") n.textContent = v; else if (k.startsWith("on")) n[k] = v; else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? "" : v); }
    for (const e of enfants.flat()) if (e !== null && e !== undefined && e !== false) n.append(e);
    return n;
  };
  const champ = (lib, attrs) => el("label", {}, lib, el("input", attrs));
  const bouton = (texte, cls, attrs = {}) => el("button", { type: "submit", class: "btn " + (cls || ""), text: texte, ...attrs });
  function occupe(form, oui, texte) {
    const b = form.querySelector("button[type=submit]");
    if (!b) return;
    if (oui) { b.dataset.t = b.textContent; b.textContent = texte || "Un instant…"; b.disabled = true; }
    else { b.textContent = b.dataset.t || b.textContent; b.disabled = false; }
  }
  // le serveur gratuit s'endort : on prévient si la réponse tarde
  function patience(msg) { return setTimeout(() => { msg.className = "cx-msg info"; msg.textContent = "Le serveur se réveille (jusqu'à une minute la première fois de la journée)…"; }, 4000); }

  /* ---------- texte à coller dans Render quand la sauvegarde n'est pas automatique ---------- */
  function blocSauvegarde(s) {
    if (!s || s.auto) return null;
    if (s.admin) return el("p", { class: "cx-msg info", text: "Prévenez l'administrateur de Vigie : votre nouveau mot de passe doit encore être enregistré de son côté pour durer après le prochain redémarrage du serveur." });
    return el("div", { class: "cx-msg info" },
      el("p", { style: "margin:0 0 6px", text: "Pour que ce changement survive au prochain redémarrage du serveur, copiez le texte ci-dessous dans Render, service vigie-marches-dce, onglet Environment, variable VIGIE_COMPTES (ou ajoutez la variable RENDER_API_KEY pour que ce soit automatique, voir l'aide)." }),
      el("textarea", { class: "cx-coller", readonly: true, onclick: e => e.target.select() }, s.valeur),
      el("p", { class: "cx-petit", style: "margin-top:6px" }, el("a", { href: "aide/comptes.html", target: "_blank", rel: "noopener", text: "Aide : comptes et mot de passe" })));
  }

  /* ---------- écran de connexion / installation ---------- */
  function ecran(contenu, sousTitre) {
    const v = el("div", { class: "cx-voile", role: "dialog", "aria-modal": "true", "aria-labelledby": "cxTitre" },
      el("div", { class: "cx-boite" },
        el("div", { class: "cx-tete" }, el("h1", { id: "cxTitre", text: "Vigie Marchés" }), el("p", { text: sousTitre })),
        el("div", { class: "cx-corps" }, contenu)));
    document.body.appendChild(v);
    const f = v.querySelector("input"); if (f) setTimeout(() => f.focus(), 50);
    return v;
  }
  function ecranConnexion(suite, message) {
    const msg = el("p", { class: "cx-msg " + (message ? "info" : ""), role: "alert", text: message || "" });
    const form = el("form", { style: "display:grid;gap:12px" },
      champ("Adresse mail", { type: "email", name: "email", autocomplete: "username", required: true, value: derniereAdresse() }),
      champ("Mot de passe", { type: "password", name: "motdepasse", autocomplete: "current-password", required: true }),
      msg, bouton("Se connecter", "btn-plein"),
      el("p", { class: "cx-petit" }, el("a", { href: "#", text: "Mot de passe oublié ?", onclick: e => { e.preventDefault(); v.remove(); ecranOubli(suite, form.email.value); } })));
    const v = ecran(form, "Connectez-vous pour accéder à votre veille.");
    form.onsubmit = async e => {
      e.preventDefault(); occupe(form, true, "Connexion…"); msg.className = "cx-msg"; msg.textContent = "";
      const t = patience(msg);
      try {
        const r = await appel("connexion", { email: form.email.value, motdepasse: form.motdepasse.value });
        clearTimeout(t); garder(r); v.remove(); entrer(suite);
      } catch (err) { clearTimeout(t); msg.className = "cx-msg err"; msg.textContent = err.message === "Failed to fetch" ? "Serveur injoignable, réessayez dans un instant." : err.message; occupe(form, false); }
    };
    // vérifie (et réveille le serveur) : propose l'installation s'il n'existe encore aucun compte
    appel("etat").then(r => { if (!r.installe) { v.remove(); ecranInstallation(suite, r); } }).catch(() => {});
  }
  function ecranOubli(suite, adresse) {
    const msg = el("p", { class: "cx-msg", role: "alert" });
    const form = el("form", { style: "display:grid;gap:12px" },
      el("p", { class: "cx-petit", style: "font-size:13.5px", text: "Indiquez l'adresse mail de votre compte : vous recevrez un lien pour créer un nouveau mot de passe." }),
      champ("Adresse mail", { type: "email", name: "email", autocomplete: "username", required: true, value: adresse || derniereAdresse() }),
      msg, bouton("Recevoir le lien", "btn-plein"),
      el("p", { class: "cx-petit" }, el("a", { href: "#", text: "← Retour à la connexion", onclick: e => { e.preventDefault(); v.remove(); ecranConnexion(suite); } })));
    const v = ecran(form, "Mot de passe oublié");
    form.onsubmit = async e => {
      e.preventDefault(); occupe(form, true, "Envoi…"); msg.className = "cx-msg"; msg.textContent = "";
      const t = patience(msg);
      try { const r = await appel("oubli", { email: form.email.value }); clearTimeout(t); msg.className = "cx-msg ok"; msg.textContent = r.message; form.querySelector("button[type=submit]").remove(); }
      catch (err) { clearTimeout(t); msg.className = "cx-msg err"; msg.textContent = err.message === "Failed to fetch" ? "Serveur injoignable, réessayez dans un instant." : err.message; occupe(form, false); }
    };
  }
  function ecranReinitialisation(suite, jeton) {
    const msg = el("p", { class: "cx-msg", role: "alert" });
    const form = el("form", { style: "display:grid;gap:12px" },
      champ("Nouveau mot de passe (10 caractères minimum)", { type: "password", name: "nouveau", required: true, minlength: "10", autocomplete: "new-password" }),
      champ("Nouveau mot de passe, encore une fois", { type: "password", name: "confirmation", required: true, minlength: "10", autocomplete: "new-password" }),
      msg, bouton("Enregistrer et me connecter", "btn-plein"));
    const v = ecran(form, "Créer un nouveau mot de passe");
    form.onsubmit = async e => {
      e.preventDefault(); msg.className = "cx-msg"; msg.textContent = "";
      if (form.nouveau.value !== form.confirmation.value) { msg.className = "cx-msg err"; msg.textContent = "Les deux mots de passe sont différents."; return; }
      occupe(form, true, "Enregistrement…");
      const t = patience(msg);
      try {
        const r = await appel("reinitialisation", { jeton, nouveau: form.nouveau.value });
        clearTimeout(t); garder({ jeton: r.jeton, lien: r.lien, compte: r.compte });
        const b = blocSauvegarde(r.sauvegarde);
        if (b) form.replaceChildren(el("p", { class: "cx-msg ok", text: "Mot de passe enregistré." }), b, el("button", { type: "button", class: "btn btn-plein", text: "Continuer", onclick: () => { v.remove(); entrer(suite); } }));
        else { v.remove(); entrer(suite); }
      } catch (err) {
        clearTimeout(t); msg.className = "cx-msg err"; msg.textContent = err.message; occupe(form, false);
        if (err.statut === 400 && /expiré/.test(err.message)) form.append(el("p", { class: "cx-petit" }, el("a", { href: "#", text: "Redemander un lien", onclick: ev => { ev.preventDefault(); v.remove(); ecranOubli(suite); } })));
      }
    };
  }
  function ecranInstallation(suite, etat) {
    const msg = el("p", { class: "cx-msg", role: "alert" });
    const form = el("form", { style: "display:grid;gap:12px" },
      el("p", { class: "cx-msg info", text: "Première installation : créez le compte administrateur. Le code d'installation se trouve dans Render, service vigie-marches-dce, onglet Environment, variable VIGIE_CODE_INSTALLATION." }),
      champ("Code d'installation", { name: "code", required: true, autocomplete: "off", spellcheck: "false" }),
      champ("Votre nom", { name: "nom", required: true, autocomplete: "name" }),
      champ("Adresse mail", { type: "email", name: "email", required: true, autocomplete: "username" }),
      champ("Mot de passe (10 caractères minimum)", { type: "password", name: "motdepasse", required: true, minlength: "10", autocomplete: "new-password" }),
      champ("Mot de passe, encore une fois", { type: "password", name: "confirmation", required: true, minlength: "10", autocomplete: "new-password" }),
      msg, bouton("Créer le compte administrateur", "btn-plein"),
      el("p", { class: "cx-petit" }, el("a", { href: "aide/comptes.html", target: "_blank", rel: "noopener", text: "Aide pas à pas" })));
    if (etat && !etat.installable) { msg.className = "cx-msg err"; msg.textContent = "Le serveur n'a pas encore de code d'installation : attendez la fin de son déploiement sur Render, puis rechargez la page."; }
    const v = ecran(form, "Installation");
    form.onsubmit = async e => {
      e.preventDefault(); msg.className = "cx-msg"; msg.textContent = "";
      if (form.motdepasse.value !== form.confirmation.value) { msg.className = "cx-msg err"; msg.textContent = "Les deux mots de passe sont différents."; return; }
      occupe(form, true, "Création…");
      try {
        const r = await appel("installation", { code: form.code.value, nom: form.nom.value, email: form.email.value, motdepasse: form.motdepasse.value });
        garder({ jeton: r.jeton, lien: r.lien, compte: r.compte });
        const b = blocSauvegarde(r.sauvegarde);
        if (b) { form.replaceChildren(el("p", { class: "cx-msg ok", text: "Compte administrateur créé." }), b, el("button", { type: "button", class: "btn btn-plein", text: "Continuer", onclick: () => { v.remove(); entrer(suite); } })); }
        else { v.remove(); entrer(suite); }
      } catch (err) { msg.className = "cx-msg err"; msg.textContent = err.message; occupe(form, false); }
    };
  }

  /* ---------- fenêtres (dialog) ---------- */
  function fenetre(titre, contenu, { obligatoire } = {}) {
    const d = el("dialog", { class: "cx-dlg" },
      el("div", { class: "cx-tete" }, el("h1", { text: titre }), obligatoire ? null : el("button", { type: "button", class: "cx-fermer", "aria-label": "Fermer", text: "×", onclick: () => d.close() })),
      el("div", { class: "cx-corps" }, contenu));
    if (obligatoire) d.addEventListener("cancel", e => e.preventDefault());
    d.addEventListener("close", () => d.remove());
    document.body.appendChild(d); d.showModal();
    return d;
  }
  function changerMotDePasse(obligatoire) {
    const msg = el("p", { class: "cx-msg", role: "alert" });
    const form = el("form", { style: "display:grid;gap:12px" },
      obligatoire ? el("p", { class: "cx-msg info", text: "Vous utilisez un mot de passe provisoire : choisissez le vôtre pour continuer." }) : null,
      champ(obligatoire ? "Mot de passe provisoire" : "Mot de passe actuel", { type: "password", name: "ancien", required: true, autocomplete: "current-password" }),
      champ("Nouveau mot de passe (10 caractères minimum)", { type: "password", name: "nouveau", required: true, minlength: "10", autocomplete: "new-password" }),
      champ("Nouveau mot de passe, encore une fois", { type: "password", name: "confirmation", required: true, minlength: "10", autocomplete: "new-password" }),
      msg, bouton("Enregistrer", "btn-plein"));
    const d = fenetre("Changer mon mot de passe", form, { obligatoire });
    form.onsubmit = async e => {
      e.preventDefault(); msg.className = "cx-msg"; msg.textContent = "";
      if (form.nouveau.value !== form.confirmation.value) { msg.className = "cx-msg err"; msg.textContent = "Les deux mots de passe sont différents."; return; }
      occupe(form, true, "Enregistrement…");
      try {
        const r = await appel("motdepasse", { ancien: form.ancien.value, nouveau: form.nouveau.value });
        garder({ jeton: r.jeton, lien: r.lien, compte: r.compte }); majBouton();
        const b = blocSauvegarde(r.sauvegarde);
        form.replaceChildren(el("p", { class: "cx-msg ok", text: "Mot de passe changé. Vos autres appareils devront se reconnecter." }), b, el("button", { type: "button", class: "btn btn-plein", text: "Fermer", onclick: () => d.close() }));
      } catch (err) { msg.className = "cx-msg err"; msg.textContent = err.message; occupe(form, false); }
    };
  }
  async function gererComptes() {
    const msg = el("div", { role: "status" });
    const tbody = el("tbody");
    const form = el("form", { class: "cx-ligne" },
      champ("Nom", { name: "nom", required: true }),
      champ("Adresse mail", { type: "email", name: "email", required: true }),
      bouton("Créer le compte", "btn-plein"));
    const role = el("label", { class: "cx-petit", style: "display:flex;gap:6px;align-items:center;font-weight:400" }, el("input", { type: "checkbox", name: "admin", style: "width:auto" }), "Administrateur (peut gérer les comptes)");
    fenetre("Gérer les comptes", [
      el("p", { class: "cx-petit", text: "Chaque personne a son propre compte. Les marchés suivis, filtres et connexions (drive, messagerie) restent dans le navigateur de chacun." }),
      el("table", { class: "cx-table" }, el("thead", {}, el("tr", {}, el("th", { text: "Nom" }), el("th", { class: "cx-mail", text: "Adresse mail" }), el("th", { text: "Rôle" }), el("th"))), tbody),
      el("h2", { style: "margin:8px 0 0;font:700 14px/1 var(--f-titre,system-ui);color:var(--bleu,#16337a);text-transform:uppercase;letter-spacing:.05em", text: "Nouveau compte" }),
      form, role, msg]);
    const afficher = (texte, cls, extra) => { msg.replaceChildren(...[el("p", { class: "cx-msg " + cls, text: texte }), extra].filter(Boolean)); };
    const remettre = (email, mdp, sauvegarde) => afficher("Mot de passe provisoire de " + email + " (à lui transmettre ; il le changera à sa première connexion) :", "ok",
      el("div", { style: "display:grid;gap:8px;margin-top:8px" }, el("div", { class: "cx-code", text: mdp }), blocSauvegarde(sauvegarde)));
    async function charger() {
      try {
        const r = await appel("liste");
        tbody.replaceChildren(...r.comptes.map(c => el("tr", {},
          el("td", { text: c.nom + (c.provisoire ? " (provisoire)" : "") }), el("td", { class: "cx-mail", text: c.email }), el("td", { text: c.role === "admin" ? "Administrateur" : "Utilisateur" }),
          el("td", {}, c.email === session.compte.email ? el("span", { class: "cx-petit", text: "vous" }) : [
            el("button", { type: "button", class: "btn", text: "Nouveau mot de passe", onclick: async () => { if (!confirm("Donner un nouveau mot de passe provisoire à " + c.email + " ? L'ancien ne marchera plus.")) return; try { const x = await appel("reinitialiser", { email: c.email }); remettre(c.email, x.motdepasse, x.sauvegarde); charger(); } catch (e) { afficher(e.message, "err"); } } }), " ",
            el("button", { type: "button", class: "btn btn-rouge", text: "Supprimer", onclick: async () => { if (!confirm("Supprimer le compte de " + c.email + " ?")) return; try { const x = await appel("supprimer", { email: c.email }); afficher("Compte supprimé.", "ok", blocSauvegarde(x.sauvegarde)); charger(); } catch (e) { afficher(e.message, "err"); } } })]))));
      } catch (e) { afficher(e.message, "err"); }
    }
    form.onsubmit = async e => {
      e.preventDefault(); occupe(form, true, "Création…");
      try {
        const r = await appel("creer", { nom: form.nom.value, email: form.email.value, role: role.querySelector("input").checked ? "admin" : "utilisateur" });
        remettre(form.email.value.trim().toLowerCase(), r.motdepasse, r.sauvegarde); form.reset(); role.querySelector("input").checked = false; charger();
      } catch (err) { afficher(err.message, "err"); }
      occupe(form, false);
    };
    charger();
  }

  /* ---------- engrenage des réglages, en haut à droite du bandeau ---------- */
  let btn = null;
  function majBouton() {
    if (!btn || !session) return;
    btn.title = "Réglages · " + (session.compte.nom || session.compte.email);
  }
  function deconnecter() { garder(null); location.reload(); }
  function cliquer(sel) { const b = document.querySelector(sel); if (b) b.click(); }
  function menu() {
    const ouvert = document.querySelector(".cx-menu"); if (ouvert) { ouvert.remove(); return; }
    const c = session.compte, r = btn.getBoundingClientRect();
    const item = (texte, action, cls) => el("button", { type: "button", role: "menuitem", class: cls || null, onclick: () => { m.remove(); action(); } }, texte);
    const synchro = window.Synchro && window.Synchro.etat();
    const m = el("div", { class: "cx-menu", role: "menu", style: `top:${r.bottom + window.scrollY + 6}px;right:${Math.max(8, document.documentElement.clientWidth - r.right)}px` },
      el("div", { class: "cx-qui" }, el("b", { text: c.nom }), c.email + (c.role === "admin" ? " · administrateur" : "")),
      el("div", { class: "cx-titre", text: "Connexions" }),
      document.querySelector("#btnOd") ? item("☁  Mon drive (OneDrive, dossier du PC…)", () => cliquer("#btnOd")) : null,
      document.querySelector("#btnMail") ? item("✉  Alertes mail", () => cliquer("#btnMail")) : null,
      synchro ? el("div", { class: "cx-note", text: synchro }) : null,
      el("div", { class: "cx-titre", text: "Mon compte" }),
      item("🔑  Changer mon mot de passe", () => changerMotDePasse(false)),
      c.role === "admin" ? item("👥  Gérer les comptes", gererComptes) : null,
      item("↩  Se déconnecter", deconnecter, "rouge"));
    document.body.appendChild(m);
    setTimeout(() => document.addEventListener("click", function f(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener("click", f); } }), 0);
  }
  function poserBouton() {
    if (btn) return;
    const nav = document.querySelector(".bandeau .onglets"), zone = document.querySelector(".bandeau-in");
    if (!zone) return;
    btn = el("button", { type: "button", class: "cx-roue", id: "btnCompte", "aria-label": "Réglages", "aria-haspopup": "menu", onclick: menu });
    btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6a.5.5 0 0 0 .1-.6l-2-3.5a.5.5 0 0 0-.6-.2l-2.5 1a7.3 7.3 0 0 0-1.7-1l-.4-2.6a.5.5 0 0 0-.5-.4h-4a.5.5 0 0 0-.5.4l-.4 2.6a7.3 7.3 0 0 0-1.7 1l-2.5-1a.5.5 0 0 0-.6.2l-2 3.5a.5.5 0 0 0 .1.6L4.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6a.5.5 0 0 0-.1.6l2 3.5c.1.2.4.3.6.2l2.5-1c.5.4 1.1.7 1.7 1l.4 2.6c0 .2.2.4.5.4h4c.3 0 .5-.2.5-.4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.5 1c.2.1.5 0 .6-.2l2-3.5a.5.5 0 0 0-.1-.6L19.4 13ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"/></svg>';
    if (nav) nav.after(btn); else zone.appendChild(btn);
    majBouton();
  }

  /* ---------- démarrage ---------- */
  let suiteLancee = false;
  function entrer(suite) {
    poserBouton();
    if (!suiteLancee) { suiteLancee = true; suite(); if (window.Synchro) window.Synchro.demarrer(session.compte.email); }
    if (session.compte.provisoire) changerMotDePasse(true);
  }
  function sessionPerdue() {
    if (document.querySelector(".cx-voile")) return;
    garder(session && { compte: session.compte }); // garde l'adresse pour pré-remplir
    session = null;
    ecranConnexion(() => {}, "Votre session a expiré : reconnectez-vous pour continuer.");
  }
  function demarrer(suite) {
    // lien « mot de passe oublié » reçu par mail : #reinit=jeton
    const m = /[#&]reinit=([\w.-]+)/.exec(location.hash);
    if (m) { history.replaceState(null, "", location.pathname + location.search); garder(null); return ecranReinitialisation(suite, m[1]); }
    if (!session || !session.jeton || expire(session.jeton)) return ecranConnexion(suite);
    entrer(suite);
    // en arrière-plan : vérifie le compte et renouvelle le jeton des liens
    const rafraichir = () => appel("moi").then(r => { session.lien = r.lien; session.compte = r.compte; garder(session); majBouton(); })
      .catch(e => { if (e.statut === 401) sessionPerdue(); });
    rafraichir(); setInterval(rafraichir, 6 * 3600e3);
  }
  window.addEventListener("hashchange", () => { if (/[#&]reinit=/.test(location.hash)) location.reload(); });
  window.Comptes = { demarrer, deconnecter, session: () => session, chiffrer: texte => appel("chiffrer", { texte }).then(r => r.chiffre) };
})();
