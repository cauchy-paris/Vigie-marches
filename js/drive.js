/* Vigie Marchés : Bouton « Connecter mon drive ». */
"use strict";
/* ====================================================================
   Bouton du bandeau « Connecter mon drive » (chaque utilisateur connecte le sien)
   ==================================================================== */
async function majBoutonOd(){
  const t=$("#btnOdTexte"), b=$("#btnOd"); if(!t||!b) return;
  const od=lire(CLE_OD,null), c=msCompte();
  let txt="Connecter mon drive", ok=false;
  if(c&&od){ txt="OneDrive · "+od.nom; ok=true; }
  else{ const h=FS_OK?await idbGet("racine"):null; if(h){ txt="Dossier du PC · "+h.name; ok=true; } else if(c) txt="Choisir le dossier OneDrive"; }
  t.textContent=txt.length>34?txt.slice(0,33)+"…":txt; b.classList.toggle("ok",ok);
}
function ouvrirOneDrive(){
  const fermer=()=>{ fond.remove(); document.removeEventListener("keydown",echap); majBoutonOd(); };
  const echap=e=>{ if(e.key==="Escape") fermer(); };
  const etatCompte=el("p",{class:"pn-etat"}), etatDossier=el("p",{class:"pn-etat"}), etatPc=el("p",{class:"pn-etat"});
  const bCompte=el("button",{class:"btn btn-plein",type:"button"},"Se connecter à Microsoft");
  const lien=el("input",{type:"text",placeholder:"https://…-my.sharepoint.com/:f:/… (lien de partage du dossier)"});
  const bLien=el("button",{class:"btn btn-plein",type:"button"},"Enregistrer ce dossier");
  const aOuvrir=el("a",{class:"btn",target:"_blank",rel:"noopener",hidden:true},"Ouvrir le dossier");
  const bPc=el("button",{class:"btn",type:"button"},"Choisir le dossier du PC");
  const bDeco=el("button",{class:"btn btn-rouge",type:"button",hidden:true},"Se déconnecter de Microsoft");
  const avert=el("p",{class:"pn-etat ko",hidden:true});
  async function maj(){
    await msInit().catch(()=>null);
    const c=msCompte(), od=lire(CLE_OD,null);
    etatCompte.className="pn-etat "+(c?"ok":""); etatCompte.textContent=c?"✓ Connecté avec "+(c.username||c.name):"Pas encore connecté.";
    bCompte.textContent=c?"Changer de compte":"Se connecter à Microsoft";
    bDeco.hidden=!c;
    const moi=(window.Comptes&&Comptes.session()&&Comptes.session().compte&&Comptes.session().compte.email||"").toLowerCase();
    avert.hidden=!(c&&moi&&String(c.username||"").toLowerCase()!==moi);
    if(!avert.hidden) avert.textContent="Attention : ce compte Microsoft n'est pas celui de votre compte Vigie ("+moi+"). S'il ne vous appartient pas, cliquez « Se déconnecter de Microsoft ».";
    bCompte.classList.toggle("btn-plein",!c);
    lien.disabled=bLien.disabled=!c;
    if(od&&!lien.value) lien.value=od.lien||"";
    etatDossier.className="pn-etat "+(od?"ok":""); etatDossier.textContent=od?"✓ Dossier des réponses : « "+od.nom+" »":(c?"Collez le lien de partage du dossier où ranger les réponses (dans OneDrive : clic droit sur le dossier › Partager › Copier le lien).":"Connectez-vous d'abord.");
    aOuvrir.hidden=!(od&&od.webUrl); if(od&&od.webUrl) aOuvrir.href=od.webUrl;
    if(!FS_OK){ etatPc.textContent="Disponible sur PC avec Chrome ou Edge."; bPc.disabled=true; }
    else{ const h=await idbGet("racine"); etatPc.className="pn-etat "+(h?"ok":""); etatPc.textContent=h?"✓ Dossier du PC : « "+h.name+" » (utilisé si OneDrive en ligne n'est pas connecté)":"Aucun dossier du PC choisi."; }
    majMs();
  }
  bCompte.onclick=async()=>{ if(await msConnecter()) maj(); };
  bDeco.onclick=async()=>{
    if(!confirm("Se déconnecter de Microsoft sur cet appareil et oublier le dossier OneDrive enregistré ?")) return;
    try{ for(let i=localStorage.length-1;i>=0;i--){ const k=localStorage.key(i); if(k&&/^msal\.|login\.(windows\.net|microsoftonline\.com)|6b6c5506-bb5e-48d4-a594-eca34bf48837/i.test(k)) localStorage.removeItem(k); } }catch(e){}
    localStorage.removeItem(CLE_OD);
    location.reload();
  };
  bLien.onclick=async()=>{
    bLien.disabled=true; etatDossier.className="pn-etat"; etatDossier.textContent="Vérification du dossier auprès de Microsoft…";
    try{ const nom=await enregistrerLienOd(lien.value); await maj(); etatDossier.className="pn-etat ok"; etatDossier.textContent="✓ Dossier accepté : « "+nom+" ». Les dossiers des consultations y seront créés."; }
    catch(e){ etatDossier.className="pn-etat ko"; etatDossier.textContent="✗ Dossier refusé : "+e.message; }
    finally{ bLien.disabled=false; }
  };
  lien.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); bLien.click(); } });
  bPc.onclick=async()=>{ try{ await dossierRacine(true); toast("Dossier du PC enregistré"); maj(); }catch(e){} };
  const boite=el("div",{class:"captcha panneau",role:"dialog","aria-modal":"true","aria-label":"Connecter mon drive"},
    el("h3",{text:"Connecter mon drive"}),
    el("p",{class:"note",text:"Quand vous cliquez « J'y réponds », Vigie crée le dossier de la consultation dans votre drive, y dépose le DCE dézippé et tient à jour « 00_Suivi des marchés.xlsx ». Chaque utilisateur connecte son propre drive : rien n'est partagé avec les autres utilisateurs de Vigie."}),
    el("div",{class:"ligne"},el("a",{href:"aide/connexions.html#drive",target:"_blank",rel:"noopener",class:"btn"},"Procédure pas à pas"),el("a",{href:"aide/connexions.html",download:"Vigie - connecter son drive et sa messagerie.html",class:"btn"},"Télécharger la procédure")),
    msConfigure()?el("div",{class:"bloc"},
      el("h4",{text:"OneDrive ou SharePoint (Microsoft 365) — PC, téléphone, tablette"}),
      el("p",{class:"note",text:"1. Connectez votre compte Microsoft."}), etatCompte, avert, el("div",{class:"ligne"},bCompte,bDeco),
      el("p",{class:"note",text:"2. Collez le lien de partage du dossier où ranger les réponses."}), etatDossier, el("div",{class:"ligne"},lien,bLien,aOuvrir)):null,
    el("div",{class:"bloc"},
      el("h4",{text:"Google Drive, Dropbox, iCloud, OneDrive ou serveur — dossier synchronisé sur ce PC"}),
      el("p",{class:"note",text:"Installez l'application de votre drive sur le PC (Google Drive pour ordinateur, Dropbox…), puis choisissez ici le dossier des réponses : le drive le synchronise tout seul. Chrome ou Edge sur PC."}),
      etatPc, el("div",{class:"ligne"},bPc)),
    el("div",{class:"actions"},el("button",{class:"btn",type:"button",onclick:fermer},"Fermer")));
  const fond=el("div",{class:"captcha-fond"},boite);
  fond.addEventListener("click",e=>{ if(e.target===fond) fermer(); });
  document.addEventListener("keydown",echap);
  document.body.append(fond);
  maj();
}
