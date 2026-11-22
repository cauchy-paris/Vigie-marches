/* Vigie Marchés : suppression de plusieurs marchés de « Mes marchés », avec leur dossier de réponse. */
"use strict";
/* ====================================================================
   Dans « Mes marchés », une case à cocher devant chaque encart et un bouton « Supprimer ».
   La suppression retire le marché de la liste (statut, marché ajouté, suivi de l'offre,
   rectificatifs, ligne du tableau Excel) et met son dossier de réponse à la corbeille du drive.
   Travail d'équipe : un marché pris par un autre collaborateur est seulement retiré de ma
   liste ; son dossier et son attribution ne sont pas touchés.
   ==================================================================== */
const selSuivi=new Set();

const normNom=t=>propre(t||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();
const sansDate=n=>n.replace(/^\d{10}_/,"");
// noms possibles du dossier d'un marché : celui enregistré à la création, celui calculé aujourd'hui
function nomsDossier(id){
  const s=statuts[id]||{}, m=s.m;
  return [s.dce&&s.dce.nom,s.dossier,m?nomDossier({deps:[],types:[],descripteurs:[],lots:[],cpv:[],urls:[],...m}):""].filter(Boolean);
}
/* Associe à chaque marché son dossier parmi ceux du drive.
   1. nom exact (accents et casse ignorés) ; 2. même nom sauf la date (date limite reportée
   depuis la création), seulement si un seul dossier correspond et qu'il n'est celui d'aucun autre marché suivi. */
function associerDossiers(ids,liste){
  const res={}, pris=new Set();
  const exacts=new Map(); liste.forEach(d=>exacts.set(normNom(d.nom),d));
  const autres=new Set(); Object.keys(statuts).filter(id=>!ids.includes(id)).forEach(id=>nomsDossier(id).forEach(n=>autres.add(normNom(n))));
  for(const id of ids){ const d=nomsDossier(id).map(normNom).map(n=>exacts.get(n)).find(Boolean); if(d&&!pris.has(d.nom)){ res[id]=d; pris.add(d.nom); } }
  for(const id of ids){
    if(res[id]) continue;
    const suf=new Set(nomsDossier(id).map(n=>sansDate(normNom(n))).filter(x=>x.includes("_")));
    const c=liste.filter(d=>/^\d{10}_/.test(d.nom)&&!pris.has(d.nom)&&!autres.has(normNom(d.nom))&&suf.has(sansDate(normNom(d.nom))));
    if(c.length===1){ res[id]=c[0]; pris.add(c[0].nom); }
  }
  return res;
}
// marché pris par un autre collaborateur de la société : on ne touche ni à son dossier ni à son attribution
function prisParAutre(id){ const e=Equipe.entrees[id]; return e&&e.collab&&Equipe.moi&&e.collab!==Equipe.moi?e:null; }

/* ---------- barre de sélection ---------- */
function majBarreSuivi(visibles){
  const barre=$("#suiviBarre"); if(!barre) return;
  for(const id of [...selSuivi]) if(!statuts[id]) selSuivi.delete(id);
  const ids=visibles||[...document.querySelectorAll("#listeSuivi .suivi-coche input")].map(c=>c.value);
  barre.hidden=!ids.length;
  const n=selSuivi.size, tout=$("#suiviTout");
  tout.checked=ids.length>0&&ids.every(id=>selSuivi.has(id)); tout.indeterminate=!tout.checked&&ids.some(id=>selSuivi.has(id));
  $("#suiviNb").textContent=n?n+" sélectionné"+(n>1?"s":""):"Cochez les marchés à supprimer";
  const b=$("#btnSupprimer"); b.disabled=!n; b.textContent="🗑 Supprimer"+(n?" ("+n+")":"");
}
// encart de « Mes marchés » entouré de sa case à cocher (l'encart peut être redessiné sans perdre la case)
function ligneSuivi(m){
  const cb=el("input",{type:"checkbox",value:m.idweb,checked:selSuivi.has(m.idweb),"aria-label":"Sélectionner « "+(m.objet||"").slice(0,80)+" »"});
  cb.onchange=()=>{ if(cb.checked) selSuivi.add(m.idweb); else selSuivi.delete(m.idweb); majBarreSuivi(); };
  return el("div",{class:"suivi-ligne"},el("label",{class:"suivi-coche",title:"Sélectionner ce marché"},cb),carte(m));
}
function initSuppression(){
  const tout=$("#suiviTout"), b=$("#btnSupprimer"); if(!tout||!b) return;
  tout.onchange=()=>{
    document.querySelectorAll("#listeSuivi .suivi-coche input").forEach(c=>{ c.checked=tout.checked; if(tout.checked) selSuivi.add(c.value); else selSuivi.delete(c.value); });
    majBarreSuivi();
  };
  b.onclick=()=>ouvrirSuppression([...selSuivi].filter(id=>statuts[id]));
}

/* ---------- fenêtre de confirmation ---------- */
let suppressionEnCours=false;
async function ouvrirSuppression(ids){
  if(!ids.length||suppressionEnCours) return;
  // accès au drive demandé tout de suite (le clic autorise la fenêtre Microsoft ou l'accès au dossier du PC)
  const accesP=accesTableau(true).catch(e=>({erreur:e}));
  const fermer=()=>{ fond.remove(); document.removeEventListener("keydown",echap); };
  const echap=e=>{ if(e.key==="Escape") fermer(); };
  const n=ids.length, pl=n>1?"s":"";
  const etat=el("p",{class:"pn-etat",text:"⏳ Recherche des dossiers de réponse dans votre drive…"});
  const liste=el("ul",{class:"supp-liste"});
  const caseDossiers=el("input",{type:"checkbox",checked:true});
  const blocDossiers=el("label",{class:"supp-option",hidden:true},caseDossiers," Mettre aussi les dossiers de réponse à la corbeille du drive");
  const note=el("p",{class:"note"});
  const bOk=el("button",{class:"btn btn-supprimer",type:"button",disabled:true},"Supprimer "+n+" marché"+pl);
  const boite=el("div",{class:"captcha panneau",role:"dialog","aria-modal":"true","aria-label":"Supprimer des marchés"},
    el("h3",{text:"Supprimer "+n+" marché"+pl+" de « Mes marchés » ?"}),
    el("p",{class:"note",text:"Le marché sort de votre liste, avec son statut, le suivi de l'offre et sa ligne du tableau Excel. Il reste trouvable dans la recherche."}),
    etat,liste,blocDossiers,note,
    el("div",{class:"actions"},el("button",{class:"btn",type:"button",onclick:fermer},"Annuler"),bOk));
  const fond=el("div",{class:"captcha-fond"},boite);
  fond.addEventListener("click",e=>{ if(e.target===fond) fermer(); });
  document.addEventListener("keydown",echap);
  document.body.append(fond);

  let acces=await accesP, dossiers={}, raison="";
  if(acces&&acces.erreur){ raison="drive inaccessible ("+(acces.erreur.message||acces.erreur)+")"; acces=null; }
  else if(!acces) raison=FS_OK||msConfigure()?"drive non connecté (bouton « Connecter mon drive »)":"drive non connecté";
  if(acces){
    try{ dossiers=associerDossiers(ids,await acces.dossiers()); }
    catch(e){ raison="drive inaccessible ("+(e.message||e)+")"; acces=null; }
  }
  if(!fond.isConnected) return;
  let nbDossiers=0;
  for(const id of ids){
    const s=statuts[id], m=s.m||{}, autre=prisParAutre(id), d=dossiers[id];
    let ligne;
    if(autre) ligne=el("span",{class:"supp-d",text:"👤 Pris par "+(autre.collabNom||autre.collab)+" : retiré de votre liste seulement, son dossier est conservé"});
    else if(d){ nbDossiers++; ligne=el("span",{class:"supp-d supp-dossier",text:"📁 "+d.nom}); }
    else ligne=el("span",{class:"supp-d",text:acces?"Aucun dossier de réponse trouvé":"Dossier non vérifié"});
    liste.append(el("li",{},el("strong",{text:m.objet||id}),m.acheteur?el("span",{class:"supp-a",text:m.acheteur}):null,ligne));
  }
  etat.textContent=acces?(nbDossiers?nbDossiers+" dossier"+(nbDossiers>1?"s":"")+" de réponse trouvé"+(nbDossiers>1?"s":"")+" dans "+acces.lieu+" :":"Aucun dossier de réponse trouvé dans "+acces.lieu+"."):"Les dossiers de réponse ne seront pas supprimés : "+raison+".";
  etat.className="pn-etat"+(acces?"":" ko");
  blocDossiers.hidden=!nbDossiers;
  const majNote=()=>{ note.textContent=nbDossiers&&caseDossiers.checked?"Les dossiers partent dans "+acces.corbeille+".":""; bOk.textContent="Supprimer "+n+" marché"+pl+(nbDossiers&&caseDossiers.checked?" et "+nbDossiers+" dossier"+(nbDossiers>1?"s":""):""); };
  caseDossiers.onchange=majNote; majNote();
  bOk.disabled=false; bOk.focus();
  bOk.onclick=()=>{ const avecDossiers=nbDossiers>0&&caseDossiers.checked; fermer(); supprimerMarches(ids,avecDossiers?dossiers:{},acces); };
}

/* ---------- suppression ---------- */
async function supprimerMarches(ids,dossiers,acces){
  suppressionEnCours=true;
  const J=journal("Suppression de marchés");
  const retires=[];
  try{
    for(const id of ids){
      const s=statuts[id]; if(!s) continue;
      const objet=(s.m&&s.m.objet||id).slice(0,80), d=dossiers[id];
      if(d&&acces&&!prisParAutre(id)){
        try{ const r=await acces.supprimer(d); J.ligne(r==="ok"?"✓ Dossier « "+d.nom+" » mis à la corbeille":"Dossier « "+d.nom+" » déjà absent",r==="ok"?"ok":""); }
        catch(e){ J.ligne("✗ « "+objet+" » : dossier non supprimé ("+(e.message||e)+"). Le marché reste dans la liste.","ko"); continue; }
      }
      if(!prisParAutre(id)&&Equipe.entrees[id]&&Equipe.entrees[id].collab===Equipe.moi) equipeLiberer(id);
      delete statuts[id];
      if(manuels[id]){ delete manuels[id]; sauverManuels(); }
      if(resultats[id]){ delete resultats[id]; sauverResultats(); }
      if(rectif.par[id]){ delete rectif.par[id]; sauverRectif(); }
      selSuivi.delete(id); retires.push(id);
      J.ligne("✓ « "+objet+" » retiré de Mes marchés","ok");
    }
    if(retires.length){
      ecrire(CLE_STATUTS,statuts);
      majCompteSuivis(); afficherSuivi(); afficherRappels(); afficherManuels(); afficherModifs();
      retires.forEach(id=>document.querySelectorAll('#liste .carte[data-id="'+CSS.escape(id)+'"]').forEach(c=>{ if(c._m) c.replaceWith(carte(c._m)); }));
      if(!$("#vue-bord").hidden) afficherBord();
      if(acces) await retirerLignesTableau(acces,retires,J);
      toast(retires.length+" marché"+(retires.length>1?"s":"")+" supprimé"+(retires.length>1?"s":""));
    }
  }finally{ suppressionEnCours=false; }
}
// lignes du tableau « 00_Suivi des marchés.xlsx » des marchés supprimés
async function retirerLignesTableau(acces,ids,J){
  for(let i=0;synchroEnCours&&i<60;i++) await new Promise(ok=>setTimeout(ok,500));
  try{
    const buf=await acces.lire(); if(!buf) return;
    const ExcelJS=await chargerExcelJS(), wb=new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws=wb.getWorksheet("Marchés")||wb.worksheets[0]; if(!ws) return;
    const C=colonnes(ws); if(!C.ref) return;
    const a=new Set(ids), lignes=[];
    ws.eachRow((row,i)=>{ if(i>1&&a.has(String(ws.getCell(i,C.ref).text||"").trim())) lignes.push(i); });
    if(!lignes.length) return;
    lignes.sort((x,y)=>y-x).forEach(i=>ws.spliceRows(i,1));
    await acces.ecrire(await wb.xlsx.writeBuffer());
    J.ligne("✓ "+lignes.length+" ligne"+(lignes.length>1?"s":"")+" retirée"+(lignes.length>1?"s":"")+" du tableau « "+NOM_EXCEL+" »","ok");
  }catch(e){ J.ligne("Tableau Excel non modifié : "+(e.message||e),"ko"); }
}
