/* Vigie Marchés : Statuts, multi-sélecteurs, filtres, sources, divers. */
"use strict";
/* ---------- Statuts ---------- */
function snapshot(m){ const {source,nbLots,horsBoamp,idweb,objet,acheteur,parution,limite,types,deps,descripteurs,procedure,famille,nature,urlAvis,description,lieu,duree,montant,lots,cpv,urlDocs,urlDepot,urlProfil,urls,refAcheteur,refDocs,villeAcheteur,accordCadre,manuel,lienSaisi,siretAcheteur}=m; return {...(source?{source,nbLots,horsBoamp}:{}),siretAcheteur,manuel,lienSaisi,villeAcheteur,accordCadre,idweb,objet,acheteur,parution,limite,types,deps,descripteurs,procedure,famille,nature,urlAvis,description:(description||"").slice(0,1500),lieu,duree,montant,lots,cpv,urlDocs,urlDepot,urlProfil,urls,refAcheteur,refDocs}; }
function changerStatut(m,k){
  const actuel=statuts[m.idweb]&&statuts[m.idweb].statut;
  // accès démo : 3 dossiers « J'y réponds » au plus
  if(k==="reponse"&&actuel!=="reponse"&&window.Comptes&&Comptes.demoDossier&&!Comptes.demoDossier(m)) return;
  // travail d'équipe : un marché « J'y réponds » n'est pris que par un collaborateur de la société
  if(k==="reponse"&&actuel!=="reponse"&&equipeVisible()){
    if(!equipePeutPrendre(m)) return;
    equipePrendre(m).then(ok=>{ if(ok) appliquerStatut(m,k,actuel); });
    return;
  }
  if(actuel==="reponse"&&equipeVisible()) equipeLiberer(m.idweb);
  appliquerStatut(m,k,actuel);
}
function appliquerStatut(m,k,actuel){
  if(actuel===k){ delete statuts[m.idweb]; toast("Statut retiré"); }
  else{ statuts[m.idweb]={statut:k,date:new Date().toISOString(),m:snapshot(m),...(statuts[m.idweb]&&statuts[m.idweb].dce?{dce:statuts[m.idweb].dce}:{})}; toast("« "+LIB_STATUT[k]+" » enregistré"); if(k==="reponse") preparerDossier(m).finally(()=>synchroTableau(false)); }
  if(!ecrire(CLE_STATUTS,statuts)) toast("Attention : ce navigateur bloque l'enregistrement local");
  document.querySelectorAll('.carte[data-id="'+CSS.escape(m.idweb)+'"]').forEach(c=>c.replaceWith(carte(m)));
  majCompteSuivis(); afficherRappels();
  if(!$("#vue-suivi").hidden) afficherSuivi();
}
function majSnapshots(items){ let chg=false; items.forEach(m=>{ if(statuts[m.idweb]&&!manuels[m.idweb]){ statuts[m.idweb].m=snapshot(m); chg=true; } }); if(chg) ecrire(CLE_STATUTS,statuts); }
function majCompteSuivis(){ $("#nbSuivis").textContent=Object.keys(statuts).length; }

let filtreSuivi="";
function afficherSuivi(){
  const f=$("#suiviFiltres"); f.innerHTML="";
  const tousS=Object.values(statuts);
  const comptes={"":tousS.length}; Object.keys(LIB_STATUT).forEach(k=>comptes[k]=tousS.filter(s=>s.statut===k).length);
  [["","Tous"],...Object.entries(LIB_STATUT)].forEach(([k,lib])=>{
    const b=el("button",{type:"button",class:"statut","data-s":k||"lecture","aria-pressed":String(filtreSuivi===k),text:lib+" ("+comptes[k]+")"});
    b.onclick=()=>{ filtreSuivi=k; afficherSuivi(); };
    f.append(b);
  });
  const items=tousS.filter(s=>!filtreSuivi||s.statut===filtreSuivi)
    .sort((a,b)=>(a.m.limite||"9999").localeCompare(b.m.limite||"9999")).map(s=>s.m);
  const cont=$("#listeSuivi"); cont.innerHTML="";
  if(!items.length) cont.append(el("div",{class:"etat",text:"Aucun marché suivi pour l'instant. Dans la recherche, cliquez sur « Lecture », « En réflexion » ou « J'y réponds » sur un encart pour le retrouver ici."}));
  else{ const frag=document.createDocumentFragment(); items.forEach(m=>frag.append(ligneSuivi(m))); cont.append(frag); }
  majBarreSuivi(items.map(m=>m.idweb));
}

/* ---------- Multi-sélecteurs ---------- */
function multiSelecteur(cont,options,choix,placeholder,surChange){
  cont.innerHTML="";
  const opts=typeof options==="function"?options:()=>options;
  const btn=el("button",{type:"button",class:"multi-btn","aria-expanded":"false"});
  const pop=el("div",{class:"multi-pop",hidden:true});
  const rech=el("input",{type:"search",placeholder:"Filtrer la liste…","aria-label":"Filtrer la liste"});
  const lst=el("div",{class:"multi-liste"});
  const puces=el("div",{class:"puces"});
  pop.append(rech,lst);
  cont.append(btn,pop,puces);
  function rendre(){
    btn.textContent=choix.length?choix.length+" sélectionné"+(choix.length>1?"s":""):placeholder;
    const filtre=rech.value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    lst.innerHTML="";
    let groupe=null;
    opts().forEach(([v,lib,g])=>{
      const norm=lib.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
      if(filtre&&!norm.includes(filtre)&&!v.toLowerCase().startsWith(filtre)) return;
      const cb=el("input",{type:"checkbox",checked:choix.includes(v)});
      cb.onchange=()=>{ const i=choix.indexOf(v); if(cb.checked&&i<0) choix.push(v); if(!cb.checked&&i>=0) choix.splice(i,1); rendrePuces(); btn.textContent=choix.length?choix.length+" sélectionné"+(choix.length>1?"s":""):placeholder; surChange(); };
      if(g&&g!==groupe){ groupe=g; lst.append(el("div",{class:"multi-groupe",text:g})); }
      lst.append(el("label",{},cb,lib));
    });
  }
  function rendrePuces(){
    puces.innerHTML="";
    choix.forEach(v=>{
      const o=opts().find(o=>o[0]===v); const lib=o?String(o[1]).replace(/\s+\(\d[\d\s\u202f]*\)$/,""):v;
      const x=el("button",{type:"button","aria-label":"Retirer "+lib,text:"×"});
      x.onclick=()=>{ choix.splice(choix.indexOf(v),1); rendrePuces(); rendre(); surChange(); };
      puces.append(el("span",{class:"puce"},lib,x));
    });
  }
  btn.onclick=()=>{ const ouvrir=pop.hidden; pop.hidden=!ouvrir; btn.setAttribute("aria-expanded",String(ouvrir)); if(ouvrir){ rech.value=""; rendre(); rech.focus(); } };
  rech.oninput=rendre;
  document.addEventListener("click",e=>{ if(!cont.contains(e.target)){ pop.hidden=true; btn.setAttribute("aria-expanded","false"); } });
  rendre(); rendrePuces();
  return {rafraichir(){ rendre(); rendrePuces(); }};
}

/* ---------- Filtres : sauvegarde / restauration ---------- */
function sauverFiltres(){
  ecrire(CLE_FILTRES,{type:etat.type,metiers:etat.metiers,regions:etat.regions,deps:etat.deps,mots:$("#fMots").value,complet:$("#fTexteComplet").checked,acheteur:$("#fAcheteur").value,nature:$("#fNature").value,publie:$("#fPublie").value,enCours:$("#fEnCours").checked,plateformes:$("#fPlateformes")?$("#fPlateformes").checked:true,tri:$("#fTri").value});
}
function restaurerFiltres(){
  const f=lire(CLE_FILTRES,null); if(!f) return;
  etat.type=f.type||""; etat.metiers.splice(0,etat.metiers.length,...(f.metiers||[])); etat.deps.splice(0,etat.deps.length,...(f.deps||[])); etat.regions.splice(0,etat.regions.length,...(f.regions||[]));
  $("#fMots").value=f.mots||""; $("#fTexteComplet").checked=!!f.complet; $("#fAcheteur").value=f.acheteur||"";
  $("#fNature").value=f.nature??"APPEL_OFFRE"; $("#fPublie").value=f.publie||""; $("#fEnCours").checked=f.enCours!==false; if($("#fPlateformes")) $("#fPlateformes").checked=f.plateformes!==false; $("#fTri").value=f.tri||"datelimitereponse asc";
}
function majSegments(){ document.querySelectorAll("#fType button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.v===etat.type))); }

/* ---------- Sources ---------- */
const SOURCES=[
  {nom:"BOAMP",url:"https://www.boamp.fr/",etat:"ok",lib:"Intégré",txt:"API open data publique, interrogée en direct par cet outil. Filtres, compteur et encarts reposent sur ces données."},
  {nom:"DECP · marchés attribués",url:"https://data.economie.gouv.fr/explore/dataset/decp-v3-marches-valides/",etat:"ok",lib:"Intégré",txt:"API open data publique. Elle alimente l'onglet « Marchés attribués », le bouton « Historique acheteur » et, sur chaque encart, le volet « Qui gagne chez cet acheteur ? » : titulaires, montants, nombre d'offres reçues, prix constatés dans le département."},
  {nom:"TED (Journal officiel de l'UE)",url:"https://ted.europa.eu/",etat:"partiel",lib:"Non branché",txt:"API publique ouverte, mais pour la France elle reprend les mêmes avis que le BOAMP (marchés au-dessus des seuils européens). La brancher ferait des doublons."},
  {nom:"PLACE (État)",url:"https://www.marches-publics.gouv.fr/",etat:"partiel",lib:"Via BOAMP",txt:"Pas d'API publique de recherche. Les marchés de l'État publiés au BOAMP renvoient vers PLACE. Le DCE s'y télécharge sans compte (identification facultative)."},
  {nom:"Maximilien (Île-de-France)",url:"https://marches.maximilien.fr/",etat:"partiel",lib:"Via BOAMP",txt:"Pas d'API publique. Même moteur que PLACE : DCE en général téléchargeable sans compte. Les annonces publiées au BOAMP y renvoient."},
  {nom:"AWS-Achat",url:"https://www.marches-publics.info/",etat:"partiel",lib:"Via BOAMP",txt:"Pas d'API publique. Compte entreprise gratuit souvent nécessaire pour télécharger le DCE."},
  {nom:"achatpublic.com",url:"https://www.achatpublic.com/",etat:"partiel",lib:"Via BOAMP",txt:"Pas d'API publique. Compte gratuit nécessaire pour télécharger le DCE."},
  {nom:"e-marchespublics",url:"https://www.e-marchespublics.com/",etat:"partiel",lib:"Via BOAMP",txt:"Pas d'API publique. Compte gratuit nécessaire pour télécharger le DCE."},
];
function afficherSources(){
  const c=$("#sources"); c.innerHTML="";
  SOURCES.forEach(s=>c.append(el("div",{class:"source"},
    el("div",{style:"display:flex;justify-content:space-between;gap:8px;align-items:center"},el("h3",{text:s.nom}),el("span",{class:"tag "+s.etat,text:s.lib})),
    el("p",{text:s.txt}),
    el("a",{class:"btn",href:s.url,target:"_blank",rel:"noopener",style:"align-self:flex-start"},"Ouvrir le site"))));
}

/* ---------- Divers ---------- */
function $(s){ return document.querySelector(s); }
let toastT; function toast(t){ const e=$("#toast"); e.textContent=t; e.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>e.hidden=true,2200); }

function changerVue(v){
  document.querySelectorAll(".onglet").forEach(b=>b.setAttribute("aria-selected",String(b.dataset.vue===v)));
  ["recherche","suivi","attribues","bord","sources"].forEach(x=>$("#vue-"+x).hidden=(x!==v));
  if(v==="bord") afficherBord();
  if(v==="suivi") afficherSuivi();
}
