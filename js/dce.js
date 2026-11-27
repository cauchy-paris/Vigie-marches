/* Vigie Marchés : Téléchargement du DCE : CAPTCHA, extension, DCE téléchargé à la main. */
"use strict";
/* ---------- Fenêtre CAPTCHA ----------
   Quand une plateforme demande de recopier un code (CAPTCHA image), Vigie l'affiche ici.
   Les cases « Je ne suis pas un robot » ne peuvent pas être relayées : on ouvre alors la plateforme. */
function demanderCaptcha(image,incorrect,lien){
  return new Promise(ok=>{
    const champ=el("input",{type:"text",autocomplete:"off",autocapitalize:"off",spellcheck:"false","aria-label":"Code de vérification"});
    let fini=false;
    const fermer=v=>{ if(fini) return; fini=true; fond.remove(); document.removeEventListener("keydown",echap); ok(v); };
    const echap=e=>{ if(e.key==="Escape") fermer(null); };
    const form=el("form",{class:"captcha",role:"dialog","aria-modal":"true","aria-label":"Code de vérification"},
      el("h3",{text:"Code de vérification"}),
      el("p",{text:"La plateforme demande de recopier ce code pour donner le DCE."}),
      incorrect?el("p",{class:"incorrect",text:"Le code précédent était incorrect, voici un nouveau code."}):null,
      el("img",{src:image,alt:"Code à recopier"}),
      champ,
      el("div",{class:"actions"},
        lien?el("a",{class:"btn",href:lien,target:"_blank",rel:"noopener",title:"Code illisible : faire le retrait sur la plateforme"},"Ouvrir la plateforme"):null,
        el("button",{class:"btn",type:"button",onclick:()=>fermer(null)},"Annuler"),
        el("button",{class:"btn btn-plein",type:"submit"},"Valider")));
    form.onsubmit=e=>{ e.preventDefault(); const v=champ.value.trim(); if(v) fermer(v); else champ.focus(); };
    const fond=el("div",{class:"captcha-fond"},form);
    fond.addEventListener("click",e=>{ if(e.target===fond) fermer(null); });
    document.addEventListener("keydown",echap);
    document.body.append(fond); champ.focus();
  });
}
// Retrait par le serveur avec gestion du CAPTCHA : renvoie la réponse fetch du fichier, ou {erreur} 
async function dceServeurAvecCaptcha(url,J){
  let rep=await fetch(url,{method:"GET"});
  for(let essai=0;essai<4&&rep.status===409;essai++){
    const r=await rep.json().catch(()=>({}));
    if(r.erreur==="robot"){ J&&J.ligne("La plateforme demande de cocher « Je ne suis pas un robot » : ouvrez la page de retrait et faites-le sur la plateforme.","ko"); return rep; }
    if(r.erreur!=="captcha") return rep;
    J&&J.ligne("🔒 La plateforme demande un code de vérification : recopiez-le dans la fenêtre.");
    const code=await demanderCaptcha(r.captcha.image,r.captcha.incorrect,r.lienDce);
    if(code==null){ J&&J.ligne("Code non saisi.","ko"); return rep; }
    rep=await fetch(SERVEUR_DCE+"/dce/captcha",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jeton:r.captcha.jeton,code})});
  }
  return rep;
}

/* AWS-Achat et e-marchespublics : retrait anonyme avec un code image, fait par le serveur Vigie
   (le code s'affiche dans Vigie, l'utilisateur le recopie, le serveur télécharge le DCE). */
const HOTES_CODE=/(^|\.)(marches-publics\.info|e-marchespublics\.com)$/i;
function pageACode(m){
  const cands=[m.urlDocs,m.urlDepot,m.urlProfil,...(m.urls||[])].filter(Boolean).map(u=>String(u).replace(/&amp;/g,"&").replace(/^http:\/\//i,"https://")).filter(u=>{ try{ const x=new URL(u); return x.protocol==="https:"&&HOTES_CODE.test(x.hostname)&&!estAccueil(u)&&!/demat\.termes/i.test(u); }catch(e){ return false; } });
  const url=cands.find(u=>/type=DCE|dematEnt|annonce_marche_public|appel-offre|dossier_de_consultation/i.test(u))||cands.find(u=>/\/Annonces\//i.test(u))||cands[0];
  if(!url) return null;
  // avis AWS « /Annonces/AAPC_1898458.htm » : la page de retrait du DCE porte le même numéro (IDM)
  const aws=url.match(/marches-publics\.info\/Annonces\/[A-Z]*_?(\d{5,9})\.htm/i);
  const retrait=aws?"https://www.marches-publics.info/mpiaws/index.cfm?fuseaction=dematEnt.login&type=DCE&IDM="+aws[1]:url;
  return {url,dceAuto:SERVEUR_DCE+"/dce?url="+encodeURIComponent(retrait)};
}

/* ---------- Extension Vigie (sessions des plateformes, Chrome/Edge) ---------- */
const HOTES_EXT=/(^|\.)(marches-publics\.info|achatpublic\.com|e-marchespublics\.com|marches-securises\.fr|klekoon\.com|local-trust\.com|atexo\.com)$/i;
function extensionDispo(){ return !!document.documentElement.dataset.vigieExt; }
let extN=0;
function appelExtension(demande,J){
  return new Promise((ok,ko)=>{
    const n=++extN; let ligne=null;
    const ecoute=async e=>{
      if(e.source!==window||!e.data||!e.data.vigieExt||e.data.n!==n) return;
      const m=e.data;
      if(m.type==="etape"){ if(J){ if(ligne) ligne.textContent="⏳ "+m.texte; else ligne=J.ligne("⏳ "+m.texte); } return; }
      if(m.type==="progression"){ if(J&&ligne&&m.taille) ligne.textContent="⏳ Téléchargement du DCE… "+Math.round(100*m.recu/m.taille)+" %"; return; }
      if(m.type==="captcha"){ J&&J.ligne("🔒 La plateforme demande un code de vérification : recopiez-le dans la fenêtre."); const code=await demanderCaptcha(m.image,m.incorrect,""); window.postMessage({vigie:"ext",n,type:"code",code},location.origin); return; }
      window.removeEventListener("message",ecoute);
      if(ligne) ligne.remove();
      if(m.type==="fichier") ok({blob:new Blob([m.donnees],{type:m.mime||"application/octet-stream"}),nom:m.nom||"DCE.zip",type:m.mime||""});
      else { const err=new Error(m.message||"Erreur de l'extension"); Object.assign(err,{lien:m.lien,robot:m.robot,connexion:m.connexion,telecharge:m.telecharge}); ko(err); }
    };
    window.addEventListener("message",ecoute);
    window.postMessage({vigie:"ext",n,type:"dce",demande},location.origin);
  });
}
// Ce que l'extension doit retirer : consultation Atexo (origine, id, org) ou page d'une autre plateforme (mode assisté)
async function demandeExtension(m,atx){
  if(atx&&atx.dceAuto){
    let p; try{ p=new URL(atx.dceAuto).searchParams; }catch(e){}
    if(p&&p.get("id")) return {origine:p.get("origine"),id:p.get("id"),org:p.get("org")};
    if(p&&p.get("origine")){ // l'avis ne donne que l'accueil : le serveur retrouve la consultation
      const l=await lienDirectDce(m,atx).catch(()=>null);
      try{ const u=new URL(l&&l.lien); const id=u.searchParams.get("id"), org=u.searchParams.get("orgAcronyme"); if(id&&org&&/^\d+$/.test(id)) return {origine:u.origin,id,org}; }catch(e){}
    }
    return null;
  }
  const cible=m.urlDocs||m.urlDepot||m.urlProfil;
  try{ const u=new URL(cible); if(u.protocol==="https:"&&HOTES_EXT.test(u.hostname)&&!estAccueil(cible)) return {url:cible}; }catch(e){}
  return null;
}
async function dceParExtension(m,atx,J){
  if(!extensionDispo()) return null;
  const d=await demandeExtension(m,atx);
  if(!d) return null;
  if(d.url&&J) J.ligne("Extension Vigie : la consultation va s'ouvrir dans un onglet ; cliquez sur le téléchargement du DCE, Vigie récupère le fichier.");
  try{ const r=await appelExtension(d,J); J&&J.ligne("✓ DCE récupéré avec votre session sur la plateforme ("+(r.blob.size/1048576).toFixed(1).replace(".",",")+" Mo)","ok"); return r; }
  catch(e){ J&&J.ligne("Extension Vigie : "+e.message+(atx?" ; essai par le serveur Vigie.":""),"ko"); if(e.telecharge) return {telecharge:true}; return null; }
}
async function telechargerExtension(){
  if(typeof JSZip==="undefined"){ toast("Bibliothèque zip indisponible, rechargez la page"); return; }
  const fichiers=["manifest.json","background.js","content.js","popup.html","popup.js","icone16.png","icone48.png","icone128.png","LISEZMOI.html"];
  const zip=new JSZip(), dossier=zip.folder("vigie-extension");
  try{
    for(const f of fichiers){ const r=await fetch("extension/"+f,{cache:"no-store"}); if(!r.ok) throw new Error(f); dossier.file(f,await r.arrayBuffer()); }
    const blob=await zip.generateAsync({type:"blob"});
    const a=el("a",{href:URL.createObjectURL(blob),download:"vigie-extension.zip"}); document.body.append(a); a.click(); a.remove();
    toast("Extension téléchargée : suivez « Comment l'installer »");
  }catch(e){ toast("Téléchargement impossible ("+e.message+")"); }
}
function majExtension(){
  const e=$("#extEtat"); if(!e) return;
  if(extensionDispo()){ e.textContent="installée (version "+document.documentElement.dataset.vigieExt+")"; e.className="ext-etat ok"; }
  else { e.textContent="non installée sur ce navigateur"; e.className="ext-etat ko"; }
}
// Bouton « Télécharger le DCE » : avec l'extension, retrait par la session de l'utilisateur
async function boutonDce(ev,m,atx,lien){
  const pc=!atx&&pageACode(m);
  if(pc){
    ev.preventDefault();
    const J=journal("Téléchargement du DCE");
    const l=J.ligne("⏳ Téléchargement du DCE… (jusqu'à une minute si le serveur était en veille)");
    let rep=null; try{ rep=await dceServeurAvecCaptcha(pc.dceAuto,J); }catch(e){}
    const type=(rep&&rep.headers.get("content-type"))||"";
    if(!rep||!rep.ok||/text\/html|json/i.test(type)){
      const r=rep?await rep.clone().json().catch(()=>({})):{};
      l.textContent="✗ Le DCE n'a pas pu être téléchargé automatiquement"+(r.message?" ("+r.message+")":rep?"":" (serveur injoignable)")+"."; l.className="ko";
      etapesManuelles(J,m,pc.url); return;
    }
    const cd=rep.headers.get("content-disposition")||"";
    const nom=propre(decodeURIComponent((cd.match(/filename\*=UTF-8''([^;]+)/i)||[])[1]||"")||(cd.match(/filename="?([^";]+)/i)||[])[1]||"")||"DCE.zip";
    const blob=await rep.blob();
    const a=el("a",{href:URL.createObjectURL(blob),download:nom}); document.body.append(a); a.click(); a.remove();
    l.textContent="✓ DCE téléchargé ("+(blob.size/1048576).toFixed(1).replace(".",",")+" Mo) : « "+nom+" » est dans vos Téléchargements"; l.className="ok";
    return;
  }
  if(!extensionDispo()||!atx) return; // lien normal (serveur Vigie, qui gère aussi le CAPTCHA)
  ev.preventDefault();
  const J=journal("Téléchargement du DCE");
  const r=await dceParExtension(m,atx,J);
  if(r&&r.blob){ const a=el("a",{href:URL.createObjectURL(r.blob),download:r.nom}); document.body.append(a); a.click(); a.remove(); J.ligne("✓ Fichier « "+r.nom+" » enregistré dans vos Téléchargements","ok"); return; }
  J.ligne("").append(el("a",{href:lien,target:"_blank",rel:"noopener"},"Essayer le retrait anonyme par le serveur Vigie"));
}

/* Raccourcis déposés à la racine du dossier de la consultation quand le DCE n'a pas pu être téléchargé automatiquement */
// Lien direct vers la page de retrait du DCE (jamais la page d'accueil de la plateforme quand on peut l'éviter)
function estAccueil(u){ try{ const x=new URL(u); return /^\/?(index\.php|entreprise|accueil)?\/?$/i.test(x.pathname)&&!/(id|ref|consultation|reference)=/i.test(x.search); }catch(e){ return true; } }
async function lienDirectDce(m,atx,serveur){
  if(serveur&&serveur.lienDce) return {lien:serveur.lienDce,consultation:serveur.lienConsultation||""};
  if(atx&&atx.dce) return {lien:atx.dce,consultation:atx.consultation};
  if(atx&&atx.recherche){
    // la plateforme ne donne que sa page d'accueil : le serveur retrouve la consultation
    try{
      const u=new URL(atx.dceAuto); u.searchParams.set("quoi","lien");
      const rep=await fetch(u,{signal:AbortSignal.timeout(90000)});
      const j=await rep.json(); if(j&&j.lien) return {lien:j.lien,consultation:j.consultation||""};
    }catch(e){}
  }
  const directs=[m.urlDocs,m.urlDepot,m.urlProfil,...(m.urls||[])].filter(Boolean);
  const lien=directs.find(u=>!estAccueil(u))||m.urlAvis||directs[0]||("https://www.boamp.fr/pages/avis/?q=idweb:"+encodeURIComponent(m.idweb||""));
  return {lien,consultation:""};
}
function fichiersRaccourci(m,liensDce,raison){
  const lien=liensDce.lien;
  const echap=t=>String(t||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const pf=plateformeDe(lien);
  let lim=""; try{ if(m.limite) lim=new Date(m.limite).toLocaleString("fr-FR",{timeZone:"Europe/Paris",dateStyle:"full",timeStyle:"short"}); }catch(e){}
  const url="[InternetShortcut]\r\nURL="+lien+"\r\n";
  const liens=[[lien===m.urlAvis?"Ouvrir l'avis BOAMP (il indique où retirer le DCE)":"Télécharger le DCE sur la plateforme"+(pf?" ("+pf.nom+")":""),lien]];
  if(liensDce.consultation&&liensDce.consultation!==lien) liens.push(["Voir la page de la consultation",liensDce.consultation]);
  if(m.urlAvis&&m.urlAvis!==lien) liens.push(["Voir l'avis BOAMP",m.urlAvis]);
  const html='<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Télécharger le DCE</title>'+
    '<style>body{font-family:Segoe UI,Arial,sans-serif;max-width:640px;margin:32px auto;padding:0 16px;color:#1b2a4a}h1{font-size:20px;color:#1d4ed8}a.b{display:block;margin:12px 0;padding:14px 16px;background:#1d4ed8;color:#fff;border-radius:8px;text-decoration:none;font-weight:600}a.b+a.b{background:#fff;color:#1d4ed8;border:1px solid #1d4ed8}p{line-height:1.5}.n{color:#b91c1c}</style></head><body>'+
    '<h1>'+echap(m.objet)+'</h1><p>'+echap(m.acheteur)+(lim?'<br>Date limite : <b>'+echap(lim)+'</b>':'')+'</p>'+
    '<p class="n">Le DCE n\'a pas pu être téléchargé automatiquement'+(raison?' : '+echap(raison):'')+'.</p>'+
    (/AdvancedSearch/.test(lien)?'<p>La consultation n\'a pas été identifiée de façon certaine : le lien ouvre la recherche sur la plateforme, repérez-la par sa date limite.</p>':'')+
    liens.map(([t,u])=>'<a class="b" href="'+echap(u)+'" target="_blank" rel="noopener">'+echap(t)+'</a>').join("")+
    (pf&&pf.compte?'<p>'+echap(pf.compte)+'.</p>':'')+
    '<p>Une fois le DCE téléchargé, rangez-le avec le bouton « 📥 Ranger le DCE téléchargé » de l\'encart dans Vigie (il le dézippe dans le dossier DCE), ou enregistrez-le vous-même dans le dossier DCE de la consultation.</p></body></html>';
  return [{nom:"Télécharger le DCE.url",texte:url},{nom:"Télécharger le DCE.html",texte:html}];
}
async function deposerRaccourciLocal(dossier,m,liens,raison,J){
  try{
    const dceDir=dossier;
    for(const f of fichiersRaccourci(m,liens,raison)){
      let h; try{ h=await dceDir.getFileHandle(f.nom,{create:true}); }catch(e){ h=await dceDir.getFileHandle(f.nom.normalize("NFD").replace(/[\u0300-\u036f]/g,""),{create:true}); }
      const w=await h.createWritable(); await w.write(f.texte); await w.close();
    }
    J.ligne("✓ Lien « Télécharger le DCE » déposé dans le dossier de la consultation","ok");
  }catch(e){ J.ligne("Le lien n'a pas pu être déposé dans le dossier ("+(e.message||e)+").","ko"); }
}
async function deposerRaccourciEnLigne(jeton,driveId,dossierId,m,liens,raison,J){
  try{
    for(const f of fichiersRaccourci(m,liens,raison)){
      const rep=await fetch("https://graph.microsoft.com/v1.0/drives/"+encodeURIComponent(driveId)+"/items/"+encodeURIComponent(dossierId)+":/"+encodeURIComponent(f.nom)+":/content?@microsoft.graph.conflictBehavior=replace",{method:"PUT",headers:{Authorization:"Bearer "+jeton,"Content-Type":"text/plain"},body:f.texte});
      if(!rep.ok) throw new Error("erreur "+rep.status);
    }
    J.ligne("✓ Lien « Télécharger le DCE » déposé dans le dossier de la consultation","ok");
  }catch(e){ J.ligne("Le lien n'a pas pu être déposé dans le dossier OneDrive ("+(e.message||e)+").","ko"); }
}

let preparationEnCours=false;
async function preparerDossier(m){
  if(preparationEnCours) return;
  if(window.Comptes&&Comptes.demoDossier&&!Comptes.demoDossier(m)) return; // accès démo : 3 dossiers au plus
  const od=lire(CLE_OD,null);
  if(msConfigure()&&od&&(msCompte()||!FS_OK)){ preparationEnCours=true; try{ await preparerEnLigne(m,od); }finally{ preparationEnCours=false; } return; }
  if(!FS_OK){ toast(msConfigure()?"Connectez-vous à Microsoft dans l'onglet Mes marchés":"Création du dossier : utilisez Chrome ou Edge sur PC"); return; }
  preparationEnCours=true;
  const nom=nomDossier(m);
  const J=journal("Dossier de réponse");
  try{
    let racine;
    try{ racine=await dossierRacine(false); }
    catch(e){ if(e.name==="AbortError"){ J.ligne("Aucun dossier choisi : rien n'a été créé.","ko"); return; } throw e; }
    const dossier=await racine.getDirectoryHandle(nom,{create:true});
    for(const sd of ["01_Analyse","02_Candidature","03_Offre","04_Contrôle"]){ try{ await dossier.getDirectoryHandle(sd,{create:true}); }catch(e){ await dossier.getDirectoryHandle(sd.normalize("NFD").replace(/[\u0300-\u036f]/g,""),{create:true}); } }
    J.ligne("✓ Dossier « "+nom+" » dans « "+racine.name+" », avec Analyse, Candidature, Offre et Contrôle","ok");
    // le DCE
    let atx=null; for(const u of [m.urlDocs,m.urlDepot,m.urlProfil,...(m.urls||[])]){ atx=atexoLiens(u); if(atx) break; }
    if(!atx) atx=atexoParRecherche(m); else atx=avecContexte(atx,m);
    const pc=!atx&&pageACode(m);
    if(!atx&&!pc&&!extensionDispo()){
      J.ligne("Cette plateforme demande un code de vérification ou un compte : Vigie ne peut pas télécharger le DCE tout seul.","ko");
      const liens=await lienDirectDce(m,null);
      etapesManuelles(J,m,liens.lien);
      await deposerRaccourciLocal(dossier,m,liens,"plateforme sans retrait anonyme",J);
      return;
    }
    // 1. avec l'extension Vigie : session de l'utilisateur sur la plateforme
    const parExt=pc?null:await dceParExtension(m,atx,J);
    let blob, nomFichier, type;
    if(parExt&&parExt.blob){ blob=parExt.blob; nomFichier=propre(parExt.nom)||"DCE.zip"; type=parExt.type||""; }
    else{
      if(!atx&&!pc){ const liens=await lienDirectDce(m,null); etapesManuelles(J,m,liens.lien); await deposerRaccourciLocal(dossier,m,liens,parExt&&parExt.telecharge?"DCE dans le dossier Téléchargements":"plateforme sans retrait anonyme",J); return; }
      // 2. par le serveur Vigie (retrait anonyme), avec CAPTCHA si besoin
      const l=J.ligne("⏳ Téléchargement du DCE… (jusqu'à une minute si le serveur était en veille)");
      let rep=null; try{ rep=await dceServeurAvecCaptcha((atx||pc).dceAuto,J); }catch(e){}
      type=(rep&&rep.headers.get("content-type"))||"";
      if(!rep||!rep.ok||/text\/html|json/i.test(type)){ const r=rep?await rep.clone().json().catch(()=>({})):{}; l.textContent="✗ Le DCE n'a pas pu être téléchargé automatiquement"+(r.message?" ("+r.message+")":"")+"."; l.className="ko"; const liens=pc?{lien:pc.url,consultation:""}:await lienDirectDce(m,atx); etapesManuelles(J,m,liens.lien); await deposerRaccourciLocal(dossier,m,liens,rep?"":"serveur injoignable",J); return; }
      const cd=rep.headers.get("content-disposition")||"";
      nomFichier=decodeURIComponent((cd.match(/filename\*=UTF-8''([^;]+)/i)||[])[1]||"")||(cd.match(/filename="?([^";]+)/i)||[])[1]||"DCE.zip";
      nomFichier=propre(nomFichier)||"DCE.zip";
      blob=await rep.blob();
      l.textContent="✓ DCE téléchargé ("+(blob.size/1048576).toFixed(1).replace(".",",")+" Mo)"; l.className="ok";
    }
    const n=await ecrireDceLocal(dossier,nom,blob,nomFichier,type,J,false);
    if(n) marquerDce(m,n,"dossier du PC");
  }catch(e){
    J.ligne("✗ Erreur : "+(e.message||e)+(e.name==="NotAllowedError"?" (autorisation refusée sur le dossier)":""),"ko");
  }finally{ preparationEnCours=false; }
}

/* Bouton « 📁 Dossier de réponse » : rouge tant que le DCE n'est pas dans le dossier, vert quand le dossier
   est créé et que le DCE s'y trouve. L'état est gardé dans le statut du marché, donc synchronisé entre appareils. */
function etatDossier(b,d){
  let quand=""; try{ if(d) quand=new Date(d.date).toLocaleString("fr-FR",{dateStyle:"short",timeStyle:"short"}); }catch(e){}
  b.className="btn btn-dossier "+(d?"dossier-ok":"dossier-ko");
  b.title=d?"Dossier créé, DCE rangé"+(d.lieu?" dans "+d.lieu:"")+(d.fichiers?" ("+d.fichiers+" fichier"+(d.fichiers>1?"s":"")+")":"")+(quand?" le "+quand:"")+". Cliquer pour le recréer ou y redéposer le DCE.":"DCE pas encore dans le dossier de réponse : cliquer pour créer le dossier et y déposer le DCE dézippé";
}
function boutonDossier(m){
  const b=el("button",{type:"button",onclick:()=>preparerDossier(m)},"📁 Dossier de réponse");
  b.dataset.dossier=m.idweb;
  etatDossier(b,statuts[m.idweb]&&statuts[m.idweb].dce);
  return b;
}
function marquerDce(m,fichiers,lieu){
  if(!m||!m.idweb) return;
  if(!statuts[m.idweb]) statuts[m.idweb]={statut:"reponse",date:new Date().toISOString(),m:snapshot(m)};
  statuts[m.idweb].dce={date:new Date().toISOString(),fichiers:fichiers||0,lieu:lieu||"",nom:nomDossier(m)};
  ecrire(CLE_STATUTS,statuts);
  document.querySelectorAll('button[data-dossier="'+CSS.escape(m.idweb)+'"]').forEach(b=>etatDossier(b,statuts[m.idweb].dce));
}
// Écrit le DCE (zip dézippé dans DCE/, sinon fichier tel quel) dans le dossier de réponse du PC
async function ecrireDceLocal(dossier,nom,blob,nomFichier,type,J,dansDce){
  const sansAcc=t=>t.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^\x20-\x7e]/g,"_");
  const ecrireFichier=async(rep,chemin,donnees)=>{
    const parts=chemin.split("/").map(propre).filter(Boolean); let d=rep;
    for(const p of parts.slice(0,-1)){ try{ d=await d.getDirectoryHandle(p,{create:true}); }catch(e){ d=await d.getDirectoryHandle(sansAcc(p),{create:true}); } }
    const nomF=parts[parts.length-1]||"fichier";
    let f; try{ f=await d.getFileHandle(nomF,{create:true}); }catch(e){ f=await d.getFileHandle(sansAcc(nomF),{create:true}); }
    const w=await f.createWritable(); await w.write(donnees); await w.close();
  };
  if(!/zip/i.test(type)&&!/\.zip$/i.test(nomFichier)){ await ecrireFichier(dansDce?await dossier.getDirectoryHandle("DCE",{create:true}):dossier,nomFichier,blob); J.ligne("✓ Fichier enregistré : "+(dansDce?"DCE/":"")+nomFichier,"ok"); return 1; }
  const l2=J.ligne("⏳ Décompression…");
  const dceDir=await dossier.getDirectoryHandle("DCE",{create:true});
  let n=0;
  const deziper=async(donnees,cible,profondeur)=>{
    const zip=await JSZip.loadAsync(donnees,{decodeFileName:nomZip});
    for(const e of Object.values(zip.files)){
      if(e.dir) continue;
      const contenu=await e.async("uint8array");
      if(/\.zip$/i.test(e.name)&&profondeur<2){
        // archive dans l'archive : dézippée dans un dossier du même nom
        const parts=e.name.split("/").map(propre).filter(Boolean); let d=cible;
        for(const p of parts.slice(0,-1)) d=await d.getDirectoryHandle(p,{create:true});
        const sous=await d.getDirectoryHandle(parts[parts.length-1].replace(/\.zip$/i,""),{create:true});
        try{ await deziper(contenu,sous,profondeur+1); continue; }catch(err){}
      }
      await ecrireFichier(cible,e.name,contenu); n++;
      if(n%10===0) l2.textContent="⏳ Décompression… "+n+" fichiers";
    }
  };
  try{ await deziper(blob,dceDir,0); l2.textContent="✓ DCE dézippé : "+n+" fichiers dans « "+nom+"/DCE »"; l2.className="ok"; }
  catch(e){ await ecrireFichier(dossier,nomFichier,blob); l2.textContent="Archive non lisible ("+(e.message||e)+"), le fichier « "+nomFichier+" » est enregistré tel quel."; l2.className="ko"; n=1; }
  J.ligne("OneDrive va synchroniser le dossier automatiquement.");
  return n;
}

/* ---------- DCE téléchargé à la main ----------
   Quand la plateforme impose un code, une case « robot » ou un compte, l'utilisateur télécharge
   le DCE lui-même (souvent un seul clic) puis le donne à Vigie (bouton ou glisser-déposer sur l'encart) :
   Vigie le range et le dézippe dans le sous-dossier DCE du dossier de réponse. Marche aussi sur téléphone
   en mode OneDrive en ligne (le fichier est choisi dans Téléchargements). */
const TYPES_DCE=".zip,.pdf,.doc,.docx,.xls,.xlsx,.odt,.ods,.rar,.7z,application/zip,application/pdf";
function boutonRangerDce(m,libelle){
  const champ=el("input",{type:"file",multiple:true,accept:TYPES_DCE,hidden:true});
  champ.onchange=()=>{ const f=[...champ.files]; champ.value=""; rangerDceFichiers(m,f); };
  const b=el("button",{class:"btn btn-plein",type:"button",title:"Choisissez le DCE que vous venez de télécharger (dossier Téléchargements) : Vigie le range et le dézippe dans le dossier de réponse. Vous pouvez aussi le glisser sur l'encart.",onclick:()=>champ.click()},libelle||"📥 Ranger le DCE téléchargé");
  return el("span",{class:"ranger-dce"},b,champ);
}
// Glisser-déposer d'un fichier sur l'encart d'un marché « J'y réponds »
function deposeSurCarte(c,m){
  const avecFichiers=e=>e.dataTransfer&&[...e.dataTransfer.types].includes("Files");
  c.addEventListener("dragover",e=>{ if(!avecFichiers(e)) return; e.preventDefault(); c.classList.add("depot-survol"); });
  c.addEventListener("dragleave",e=>{ if(!c.contains(e.relatedTarget)) c.classList.remove("depot-survol"); });
  c.addEventListener("drop",e=>{ if(!avecFichiers(e)) return; e.preventDefault(); c.classList.remove("depot-survol"); rangerDceFichiers(m,[...e.dataTransfer.files]); });
}
// Les deux étapes proposées quand le DCE n'a pas pu être téléchargé automatiquement
function etapesManuelles(J,m,lien){
  const li=J.ligne("");
  li.append(el("div",{class:"etapes-dce"},
    el("span",{text:"Faites-le en 2 gestes :"}),
    el("a",{class:"btn",href:lien,target:"_blank",rel:"noopener"},"1. Ouvrir la page et télécharger le DCE ↗"),
    boutonRangerDce(m,"2. 📥 Ranger le fichier téléchargé")));
  return li;
}
let rangementEnCours=false;
async function rangerDceFichiers(m,fichiers){
  fichiers=[...(fichiers||[])].filter(f=>f&&f.size>0);
  if(!fichiers.length||rangementEnCours) return;
  const nom=nomDossier(m);
  const od=lire(CLE_OD,null);
  const J=journal("Ranger le DCE");
  const mo=n=>(n/1048576).toFixed(1).replace(".",",");
  rangementEnCours=true;
  try{
    if(msConfigure()&&od&&(msCompte()||!FS_OK)){
      const jeton=await msJeton(false,scopesDossier());
      if(!jeton){
        const l=J.ligne("La connexion Microsoft doit être renouvelée.","ko");
        l.append(" ",el("button",{class:"lien-plus",type:"button",onclick:async()=>{ if(!msCompte()) await msConnecter(); if(await msJeton(true,scopesDossier())) rangerDceFichiers(m,fichiers); }},"Se reconnecter"));
        return;
      }
      const l=J.ligne("⏳ Dossier « "+nom+" »…");
      const rep=await fetch(SERVEUR_DCE+"/onedrive",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+jeton},body:JSON.stringify({driveId:od.driveId,parentId:od.id,dossier:nom})});
      const r=await rep.json().catch(()=>({message:"Réponse illisible du serveur ("+rep.status+")"}));
      if(!rep.ok||!r.id){ l.textContent="✗ "+(r.message||"Erreur "+rep.status); l.className="ko"; return; }
      l.textContent="✓ Dossier « "+nom+" » dans « "+od.nom+" »"; l.className="ok";
      for(const f of fichiers){
        if(f.size>200e6){ J.ligne("✗ « "+f.name+" » dépasse 200 Mo : déposez-le à la main dans OneDrive.","ko"); continue; }
        const l2=J.ligne("⏳ Envoi de « "+f.name+" » ("+mo(f.size)+" Mo) et décompression… (jusqu'à une minute si le serveur était en veille)");
        try{
          const rf=await fetch(SERVEUR_DCE+"/onedrive/dce",{method:"POST",headers:{Authorization:"Bearer "+jeton,"X-Drive":od.driveId,"X-Dossier":r.id,"X-Nom":encodeURIComponent(f.name),"Content-Type":"application/octet-stream"},body:f});
          const d=await rf.json().catch(()=>({message:"Réponse illisible du serveur ("+rf.status+")"}));
          if(!rf.ok){ l2.textContent="✗ « "+f.name+" » : "+(d.message||"erreur "+rf.status); l2.className="ko"; continue; }
          l2.textContent="✓ « "+f.name+" » : "+d.fichiers+" fichier"+(d.fichiers>1?"s":"")+" dans le sous-dossier DCE"+(d.total>d.fichiers?" ("+(d.total-d.fichiers)+" en échec)":"");
          l2.className=d.total>d.fichiers?"ko":"ok";
          if(d.fichiers) marquerDce(m,d.fichiers,"OneDrive");
        }catch(e){ l2.textContent="✗ Le serveur ne répond pas ("+e.message+"). Réessayez dans une minute."; l2.className="ko"; }
      }
      if(r.webUrl) J.ligne("").append(el("a",{href:r.webUrl,target:"_blank",rel:"noopener"},"Ouvrir le dossier dans OneDrive"));
      return;
    }
    if(!FS_OK){ J.ligne("Pour ranger le DCE, connectez-vous à Microsoft (⚙ Réglages) ou utilisez Chrome ou Edge sur PC.","ko"); return; }
    let racine;
    try{ racine=await dossierRacine(false); }
    catch(e){ if(e.name==="AbortError"){ J.ligne("Aucun dossier choisi : rien n'a été rangé.","ko"); return; } throw e; }
    const dossier=await racine.getDirectoryHandle(nom,{create:true});
    for(const sd of ["01_Analyse","02_Candidature","03_Offre","04_Contrôle"]){ try{ await dossier.getDirectoryHandle(sd,{create:true}); }catch(e){ await dossier.getDirectoryHandle(sd.normalize("NFD").replace(/[\u0300-\u036f]/g,""),{create:true}); } }
    J.ligne("✓ Dossier « "+nom+" » dans « "+racine.name+" »","ok");
    let total=0;
    for(const f of fichiers) total+=(await ecrireDceLocal(dossier,nom,f,propre(f.name)||"DCE.zip",f.type||"",J,true))||0;
    if(total) marquerDce(m,total,"dossier du PC");
  }catch(e){
    J.ligne("✗ Erreur : "+(e.message||e)+(e.name==="NotAllowedError"?" (autorisation refusée sur le dossier)":""),"ko");
  }finally{ rangementEnCours=false; }
}

async function preparerEnLigne(m,od){
  const nom=nomDossier(m);
  const J=journal("Dossier de réponse (OneDrive)");
  let jeton=await msJeton(false,scopesDossier());
  if(!jeton){
    const l=J.ligne("La connexion Microsoft doit être renouvelée.","ko");
    l.append(" ",el("button",{class:"lien-plus",type:"button",onclick:async()=>{ if(!msCompte()) await msConnecter(); if(await msJeton(true,scopesDossier())) preparerDossier(m); }},"Se reconnecter"));
    return;
  }
  let atx=null; for(const u of [m.urlDocs,m.urlDepot,m.urlProfil,...(m.urls||[])]){ atx=atexoLiens(u); if(atx) break; }
  if(!atx) atx=atexoParRecherche(m); else atx=avecContexte(atx,m);
  const params={};
  if(atx&&atx.dceAuto){ try{ new URL(atx.dceAuto).searchParams.forEach((v,k)=>{ if(k!=="quoi") params[k]=v; }); }catch(e){} }
  const pc=!atx&&pageACode(m);
  if(pc) params.url=new URL(pc.dceAuto).searchParams.get("url");
  // DCE récupéré d'abord avec l'extension Vigie (session de l'utilisateur), sinon par le serveur
  const parExt=pc?null:await dceParExtension(m,atx,J);
  const fichierExt=parExt&&parExt.blob?parExt:null;
  const l=J.ligne("⏳ Création du dossier « "+nom+" »"+(params.origine||params.url||fichierExt?" et dépôt du DCE (1 à 3 minutes, vous pouvez continuer à naviguer)":"")+"…");
  try{
    const envoi=extra=>fetch(SERVEUR_DCE+"/onedrive",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+jeton},body:JSON.stringify({driveId:od.driveId,parentId:od.id,dossier:nom,...(fichierExt?{}:params),...extra})});
    let rep=await envoi({});
    let r=await rep.json().catch(()=>({message:"Réponse illisible du serveur ("+rep.status+")"}));
    for(let essai=0;essai<4&&rep.ok&&r.dce==="captcha"&&r.captcha;essai++){
      J.ligne("🔒 La plateforme demande un code de vérification : recopiez-le dans la fenêtre.");
      const code=await demanderCaptcha(r.captcha.image,r.captcha.incorrect,r.lienDce||"");
      if(code==null){ r.dce="echec"; r.message="code de vérification non saisi"; break; }
      rep=await envoi({jeton:r.captcha.jeton,code});
      r=await rep.json().catch(()=>({message:"Réponse illisible du serveur ("+rep.status+")"}));
    }
    if(fichierExt&&rep.ok&&r.id){
      const l3=J.ligne("⏳ Dépôt du DCE dans OneDrive…");
      const rf=await fetch(SERVEUR_DCE+"/onedrive/dce",{method:"POST",headers:{Authorization:"Bearer "+jeton,"X-Drive":od.driveId,"X-Dossier":r.id,"X-Nom":encodeURIComponent(fichierExt.nom),"Content-Type":"application/octet-stream"},body:fichierExt.blob});
      const d=await rf.json().catch(()=>({message:"Réponse illisible du serveur ("+rf.status+")"}));
      l3.remove();
      if(rf.ok) Object.assign(r,d); else { r.dce="echec"; r.message=d.message||"erreur "+rf.status; }
    }
    if(r.webUrl){ l.textContent="✓ Dossier « "+nom+" » créé dans « "+od.nom+" », avec Analyse, Candidature, Offre et Contrôle "; l.className="ok"; l.append(el("a",{href:r.webUrl,target:"_blank",rel:"noopener"},"Ouvrir dans OneDrive")); }
    if(!rep.ok){ (r.webUrl?J.ligne(""):l).textContent="✗ "+(r.message||"Erreur "+rep.status); if(!r.webUrl) l.className="ko"; return; }
    if(r.dce==="ok"&&r.fichiers) marquerDce(m,r.fichiers,"OneDrive");
    if(r.dce==="ok") J.ligne("✓ DCE dézippé : "+r.fichiers+" fichier"+(r.fichiers>1?"s":"")+" dans le sous-dossier DCE"+(r.total>r.fichiers?" ("+(r.total-r.fichiers)+" en échec)":""),r.total>r.fichiers?"ko":"ok");
    else{
      const liens=r.dce==="introuvable"&&r.lienDce?{lien:r.lienDce,consultation:""}:await lienDirectDce(m,atx,r), lien=liens.lien;
      const msg={robot:"La plateforme demande de cocher « Je ne suis pas un robot » : faites le retrait sur la plateforme.",captcha:"Code de vérification non validé.",absent:"Cette plateforme demande un code de vérification ou un compte : Vigie ne peut pas télécharger le DCE tout seul.",introuvable:"La consultation n'a pas été retrouvée de façon certaine sur la plateforme.",echec:"Le DCE n'a pas pu être téléchargé : "+(r.message||""),trop_gros:"Le DCE dépasse 300 Mo, téléchargez-le à la main."}[r.dce]||"DCE non déposé.";
      J.ligne(msg,"ko");
      etapesManuelles(J,m,lien);
      const raison={robot:"vérification « Je ne suis pas un robot » à faire sur la plateforme",absent:parExt&&parExt.telecharge?"DCE dans le dossier Téléchargements":"plateforme sans retrait anonyme",introuvable:"consultation non retrouvée de façon certaine sur la plateforme",echec:r.message||"",trop_gros:"DCE de plus de 300 Mo"}[r.dce]||"";
      if(r.id) await deposerRaccourciEnLigne(jeton,od.driveId,r.id,m,liens,raison,J);
    }
    (r.erreurs||[]).slice(0,5).forEach(e=>J.ligne("• "+e,"ko"));
  }catch(e){ l.textContent="✗ Le serveur ne répond pas ("+e.message+"). Réessayez dans une minute avec le bouton 📁 Dossier de réponse."; l.className="ko"; }
}
