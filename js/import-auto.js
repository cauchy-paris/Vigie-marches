/* Vigie Marchés : Import automatique du matin. */
"use strict";
/* ====================================================================
   Import automatique du matin
   À la première ouverture de Vigie de la journée (ou au changement de jour si l'onglet est resté ouvert),
   la boîte choisie dans « Importer les alertes mail » est relue sans rien demander :
   - Outlook : jeton Microsoft déjà accordé (lecture seule) ;
   - Gmail et autres : mot de passe d'application mémorisé sur cet appareil.
   Les nouvelles consultations sont ajoutées, puis résumées en haut de la page :
   d'abord celles qui correspondent à votre profil ou à vos filtres, ensuite les autres.
   ==================================================================== */
const HEURE_MATIN=6;
let importAutoEnCours=false;
function estPertinent(m){
  try{ if(typeof notePertinence==="function"){ const n=notePertinence(m)||{}; return !n.exclu&&(n.score||0)>=60; } }catch(e){}
  return manuelsFiltres().some(x=>x.idweb===m.idweb);
}
function nouvellesConsultations(mails,memo){
  const vues=new Set(), maintenant=new Date(), r=[];
  for(const mail of mails) for(const c of consultationsDuMail(mail)){
    if(vues.has(c.cle)) continue; vues.add(c.cle);
    if(c.limite&&new Date(c.limite)<maintenant) continue;
    if(dejaDansVigie(c)||memo.ignores[c.cle]) continue;
    r.push(c);
  }
  return r;
}
function afficherMatin(texteAttente){
  const zone=$("#annMatin"); if(!zone) return;
  zone.innerHTML=""; zone.className="annonce"+(texteAttente?" attente":"");
  if(texteAttente){ zone.hidden=false; zone.append(el("h2",{text:"✉ Import du matin"}),el("p",{class:"note-docs",text:texteAttente})); return; }
  const memo=lire(CLE_MAIL,{}); const r=memo.resume;
  if(!r||r.date!==dateIso(new Date())||r.ferme){ zone.hidden=true; return; }
  const ms=(r.ids||[]).map(id=>manuels[id]).filter(Boolean);
  const fermer=el("button",{class:"fermer",type:"button",title:"Masquer le résumé","aria-label":"Masquer le résumé",text:"×"});
  fermer.onclick=()=>{ const x=lire(CLE_MAIL,{}); if(x.resume) x.resume.ferme=true; ecrire(CLE_MAIL,x); zone.hidden=true; };
  zone.hidden=false;
  const h=new Date(r.heure||Date.now()).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"});
  if(r.erreur){
    zone.append(el("h2",{},"✉ Import du matin impossible",fermer),el("p",{class:"note-docs",text:r.erreur}),
      el("div",{class:"actions"},el("button",{class:"btn",type:"button",onclick:()=>ouvrirImportMail()},"Ouvrir l'import des alertes")));
    return;
  }
  if(!ms.length){ zone.append(el("h2",{},"✉ Import du matin ("+h+") : aucun nouveau marché"+(r.lus?" dans "+r.lus+" mails":""),fermer)); return; }
  const pert=ms.filter(estPertinent), autres=ms.filter(m=>!pert.includes(m));
  const ligne=m=>{
    const j=joursRestants(m.limite);
    const retirer=el("button",{class:"mini",type:"button",title:"Retirer ce marché de Vigie (il ne sera plus proposé)",text:"Retirer"});
    retirer.onclick=()=>{ delete manuels[m.idweb]; sauverManuels(); const x=lire(CLE_MAIL,{ignores:{}}); x.ignores=x.ignores||{}; if(m.cleMail) x.ignores[m.cleMail]=1; ecrire(CLE_MAIL,x); afficherManuels(); afficherMatin(); };
    return el("li",{},
      el("span",{class:"jj"+(j!=null&&j<=7?" vite":""),text:j==null?"date ?":j<0?"clos":libJ(j)}),
      el("button",{class:"lien",type:"button",onclick:()=>montrerCarte(m),text:m.objet}),
      el("span",{class:"s",text:[m.acheteur,m.deps&&m.deps.join(", ")].filter(Boolean).join(" · ")}),retirer);
  };
  zone.append(el("h2",{},"✉ Import du matin ("+h+") : "+ms.length+" nouveau"+(ms.length>1?"x":"")+" marché"+(ms.length>1?"s":"")+(pert.length?", dont "+pert.length+" pertinent"+(pert.length>1?"s":""):""),fermer));
  if(pert.length) zone.append(el("div",{class:"groupe",text:"Correspondent à vos "+(typeof notePertinence==="function"?"critères":"filtres de recherche")}),el("ul",{},pert.map(ligne)));
  if(autres.length){
    const d=el("details",{},el("summary",{class:"groupe",style:"cursor:pointer",text:"Autres marchés importés ("+autres.length+")"}),el("ul",{},autres.map(ligne)));
    if(!pert.length) d.open=true;
    zone.append(d);
  }
}
async function importAutomatique(force){
  if(importAutoEnCours) return;
  const memo=lire(CLE_MAIL,{dernier:null,ignores:{}}); memo.ignores=memo.ignores||{};
  const auto=memo.auto;
  if(!auto||!auto.actif) return;
  const auj=dateIso(new Date());
  if(!force&&(memo.essaiAuto===auj||(memo.resume&&memo.resume.date===auj))) return;
  if(!force&&new Date().getHours()<HEURE_MATIN) return;
  importAutoEnCours=true;
  memo.essaiAuto=auj; ecrire(CLE_MAIL,memo);
  const depuis=new Date(Math.max(Date.now()-14*864e5,memo.dernier?new Date(memo.dernier).getTime()-864e5:Date.now()-3*864e5));
  const fin=(resume)=>{ const x=lire(CLE_MAIL,memo); x.resume={date:auj,heure:new Date().toISOString(),...resume}; ecrire(CLE_MAIL,x); importAutoEnCours=false; afficherMatin(); };
  try{
    let r=null;
    afficherMatin("⏳ Lecture des alertes reçues depuis le "+depuis.toLocaleDateString("fr-FR")+"…");
    if(auto.source==="outlook"){
      if(!msConfigure()) return fin({erreur:"La connexion Outlook n'est pas disponible sur ce site."});
      r=await alertesOutlook(depuis.toISOString(),t=>afficherMatin(t),true);
      if(!r) return fin({erreur:"Microsoft demande de vous reconnecter : ouvrez « Importer les alertes mail » et cliquez « Se connecter et chercher dans Outlook »."});
    }else{
      const cfg=lire(CLE_IMAP,{});
      if(!cfg.motdepasse&&!cfg.motdepasseChiffre) return fin({erreur:"Le mot de passe de la boîte "+(cfg.utilisateur||"")+" n'est pas mémorisé sur cet appareil : ouvrez « Importer les alertes mail », cochez « Se souvenir du mot de passe » et lancez un import."});
      afficherMatin("⏳ Lecture de la boîte "+cfg.utilisateur+" (jusqu'à deux minutes si le serveur Vigie était en veille)…");
      r=await alertesImap(cfg,depuis.toISOString());
    }
    const x=lire(CLE_MAIL,memo); x.dernier=new Date().toISOString(); ecrire(CLE_MAIL,x);
    const cs=nouvellesConsultations(r.mails,x);
    const ids=[];
    for(const [i,c] of cs.entries()){
      afficherMatin("⏳ Ajout des nouveaux marchés : "+(i+1)+" / "+cs.length+"…");
      try{ const a=await ajouterDepuisAlerte(c); if(a&&a.m) ids.push(a.m.idweb); }catch(e){}
    }
    traiterMessagesSuivi(r.messages);
    afficherManuels();
    if(ids.length) notifier("Vigie · "+ids.length+" nouveau"+(ids.length>1?"x":"")+" marché"+(ids.length>1?"s":""),"Import du matin : "+ids.map(id=>manuels[id]&&manuels[id].objet).filter(Boolean).slice(0,3).join(" · "),"vigie-matin");
    fin({ids,lus:r.lus||0});
  }catch(e){ fin({erreur:"L'import du matin a échoué : "+(e.name==="TimeoutError"?"la messagerie met trop de temps à répondre.":e.message)}); }
  finally{ importAutoEnCours=false; }
}
function initImportAuto(){
  afficherMatin();
  setTimeout(()=>importAutomatique(false),2500);
  setInterval(()=>importAutomatique(false),30*6e4); // onglet resté ouvert : l'import part au changement de jour
}
