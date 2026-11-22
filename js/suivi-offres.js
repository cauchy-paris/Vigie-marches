/* Vigie Marchés : Suivi des offres et tableau de bord. */
"use strict";
/* ====================================================================
   Suivi des offres (déposée, gagnée, perdue) et tableau de bord
   ==================================================================== */
const CLE_RESULTATS="vigie.resultats.v1";
const ETAPES={prepa:"En préparation",depose:"Déposée",gagne:"Gagnée",perdu:"Perdue",sanssuite:"Sans suite",abandon:"Abandonnée"};
let resultats=lire(CLE_RESULTATS,{});
function sauverResultats(){ if(!ecrire(CLE_RESULTATS,resultats)) toast("Attention : ce navigateur bloque l'enregistrement local"); }
const ETAPES_DEPOSEES=["depose","gagne","perdu","sanssuite"];
const aujourdhuiIso=()=>new Date().toLocaleDateString("sv-SE",{timeZone:"Europe/Paris"});
const dateDepotFr=d=>d?new Date(d+"T12:00:00").toLocaleDateString("fr-FR"):"";
function resumeMarche(m){ return {objet:m.objet,acheteur:m.acheteur,limite:m.limite||null,types:m.types||[],procedure:m.procedure||"",deps:m.deps||[]}; }
function etapeDeTexte(t){
  const x=sansAccent(String(t||"")).trim(); if(!x) return null;
  if(/gagn|remport|retenu(?!.*non)|attribu/.test(x)&&!/non retenu|perdu/.test(x)) return "gagne";
  if(/perdu|non retenu|rejet/.test(x)) return "perdu";
  if(/sans suite|infructu|annul/.test(x)) return "sanssuite";
  if(/abandon|ne repon/.test(x)) return "abandon";
  if(/depos|remis|envoy/.test(x)) return "depose";
  if(/prepa|en cours/.test(x)) return "prepa";
  return null;
}
// sale : à recopier dans le tableau Excel à la prochaine synchro
function majResultat(id,champs,sale=true){
  const av=resultats[id]||{etape:"prepa"};
  resultats[id]={...av,...champs,date:new Date().toISOString(),...(sale?{sale:true}:{})};
  // date de dépôt : aujourd'hui par défaut dès que l'offre est déposée
  if(ETAPES_DEPOSEES.includes(resultats[id].etape)&&!resultats[id].dateDepot) resultats[id].dateDepot=aujourdhuiIso();
  if(champs.etape&&champs.etape!==av.etape) resultats[id]["d_"+champs.etape]=new Date().toISOString();
  sauverResultats();
  equipeEtape(id,resultats[id]);
  if(!$("#vue-bord").hidden) afficherBord();
}
let minuterieRes;
function synchroBientot(){ clearTimeout(minuterieRes); minuterieRes=setTimeout(()=>synchroTableau(false),4000); }
function ligneSuiviOffre(m){
  const res=resultats[m.idweb]||{etape:"prepa"};
  const sel=el("select",{"aria-label":"Étape de l'offre"},Object.entries(ETAPES).map(([k,lib])=>el("option",{value:k,text:lib})));
  sel.value=res.etape||"prepa";
  const mt=el("input",{type:"text",inputmode:"numeric",placeholder:"ex. 185 000","aria-label":"Montant de l'offre en euros HT",value:res.montant?Number(res.montant).toLocaleString("fr-FR"):""});
  const dd=el("input",{type:"date","aria-label":"Date de dépôt de l'offre",value:res.dateDepot||aujourdhuiIso(),max:aujourdhuiIso()});
  const champDepot=el("label",{class:"date-depot",hidden:!ETAPES_DEPOSEES.includes(res.etape)},"Date de dépôt",dd);
  const sauver=()=>{ majResultat(m.idweb,{etape:sel.value,montant:nombre(mt.value)||null,...(ETAPES_DEPOSEES.includes(sel.value)?{dateDepot:dd.value||aujourdhuiIso()}:{}),m:resumeMarche(m)}); ligne.className="suivi-offre etape-"+sel.value; champDepot.hidden=!ETAPES_DEPOSEES.includes(sel.value); synchroBientot(); };
  sel.onchange=()=>{ sauver(); toast("Offre : « "+ETAPES[sel.value]+" »"); };
  dd.onchange=()=>{ if(!dd.value) dd.value=aujourdhuiIso(); sauver(); toast("Date de dépôt : "+dateDepotFr(dd.value)); };
  mt.onchange=()=>{ sauver(); if(mt.value) mt.value=nombre(mt.value).toLocaleString("fr-FR"); toast("Montant de l'offre enregistré"); };
  const ligne=el("div",{class:"suivi-offre etape-"+(res.etape||"prepa")},
    el("span",{class:"lib",text:"Suivi de l'offre"}),sel,champDepot,
    el("label",{},"Montant de l'offre",mt,"€ HT"),
    el("span",{class:"note-docs",text:"Alimente le tableau de bord et la colonne Résultat du tableau Excel."}));
  return ligne;
}

let bordPeriode="365";
function initBord(){
  const s=$("#bPeriode"); if(s) s.onchange=()=>{ bordPeriode=s.value; afficherBord(); };
  const b=$("#bProfil"); if(b) b.onclick=ouvrirProfil;
  const b2=$("#btnProfil"); if(b2) b2.onclick=ouvrirProfil;
}
function lignesBord(){
  const ids=new Set([...Object.keys(resultats),...Object.entries(statuts).filter(([,s])=>s.statut==="reponse").map(([id])=>id)]);
  const L=[];
  for(const id of ids){
    const r=resultats[id]||{etape:"prepa"}, s=statuts[id];
    const m=r.m||(s&&s.m&&resumeMarche(s.m))||{objet:id,acheteur:""};
    const ref=(m.limite&&new Date(m.limite))||(r.date&&new Date(r.date))||new Date();
    L.push({id,etape:r.etape||"prepa",montant:Number(r.montant)||0,m,ref,dateDepot:r.dateDepot||""});
  }
  if(bordPeriode){
    const debut=bordPeriode==="annee"?new Date(new Date().getFullYear(),0,1):new Date(Date.now()-Number(bordPeriode)*864e5);
    return L.filter(x=>x.ref>=debut||x.etape==="prepa");
  }
  return L;
}
function afficherBord(){
  const cont=$("#bordContenu"); if(!cont) return;
  cont.innerHTML="";
  const L=lignesBord(), nb=e=>L.filter(x=>x.etape===e).length;
  const engages=L.filter(x=>x.etape!=="abandon"), deposes=L.filter(x=>["depose","gagne","perdu","sanssuite"].includes(x.etape));
  const g=nb("gagne"), p=nb("perdu"), taux=g+p?Math.round(g/(g+p)*100):null;
  const mGagne=L.filter(x=>x.etape==="gagne").reduce((a,x)=>a+x.montant,0);
  const avecMt=deposes.filter(x=>x.montant), moy=avecMt.length?avecMt.reduce((a,x)=>a+x.montant,0)/avecMt.length:0;
  const autres=Object.values(statuts).filter(s=>s.statut!=="reponse").length;
  const tuile=(val,lib,sous,cl)=>el("div",{class:"encadre tuile"+(cl?" "+cl:"")},el("div",{class:"chiffre",text:val}),el("div",{class:"tuile-lib",text:lib}),sous?el("div",{class:"note-docs",text:sous}):null);
  cont.append(el("div",{class:"tuiles"},
    tuile(String(engages.length),"Réponses engagées",nb("prepa")+" en préparation"),
    tuile(String(deposes.length),"Offres déposées",nb("depose")+" en attente de résultat"),
    tuile(String(g),"Marchés gagnés",p+" perdu"+(p>1?"s":"")+(nb("sanssuite")?", "+nb("sanssuite")+" sans suite":""),"rouge"),
    tuile(taux==null?"–":taux+" %","Taux de réussite",taux==null?"dès le premier résultat connu":"gagnés sur résultats connus"),
    tuile(mGagne?euros(mGagne):"–","Montant gagné","somme des offres gagnées, HT"),
    tuile(moy?euros(moy):"–","Offre moyenne",avecMt.length?"sur "+avecMt.length+" offre"+(avecMt.length>1?"s":"")+" chiffrée"+(avecMt.length>1?"s":""):"saisissez le montant sur l'encart")));
  { const be=blocEquipe(); if(be) cont.append(be); }
  // Graphique mensuel : offres déposées par mois (gagnées en rouge)
  cont.append(graphiqueMois(deposes));
  // Prochaines remises
  const prepa=L.filter(x=>x.etape==="prepa").sort((a,b)=>(a.m.limite||"9").localeCompare(b.m.limite||"9"));
  const bloc=(titre,...e)=>el("div",{class:"encadre"},el("h2",{text:titre}),...e);
  if(prepa.length) cont.append(bloc("Remises à venir",tableBord(prepa,true)));
  const fini=L.filter(x=>x.etape!=="prepa").sort((a,b)=>b.ref-a.ref);
  cont.append(bloc("Offres et résultats",fini.length?tableBord(fini,false):el("p",{class:"note-docs",text:"Aucune offre déposée pour l'instant. Sur un encart « J'y réponds », choisissez l'étape (Déposée, Gagnée, Perdue…) dans « Suivi de l'offre », ou remplissez la colonne Résultat du tableau Excel."})));
  // Par acheteur
  const parA=new Map(); deposes.forEach(x=>{ const k=x.m.acheteur||"?"; const a=parA.get(k)||{n:0,g:0,mt:0}; a.n++; if(x.etape==="gagne"){ a.g++; a.mt+=x.montant; } parA.set(k,a); });
  if(parA.size) cont.append(bloc("Par acheteur",el("ol",{class:"top"},[...parA.entries()].sort((a,b)=>b[1].n-a[1].n).slice(0,10).map(([k,a])=>el("li",{},el("span",{text:k}),el("span",{text:a.n+" offre"+(a.n>1?"s":"")+" · "+a.g+" gagnée"+(a.g>1?"s":"")+(a.mt?" · "+euros(a.mt):"")}))))));
  cont.append(el("p",{class:"note-docs",text:"Calculé à partir des statuts « J'y réponds » et du suivi de l'offre de chaque marché, enregistrés dans ce navigateur et repris de la colonne Résultat du tableau Excel. "+(autres?autres+" autre"+(autres>1?"s":"")+" marché"+(autres>1?"s":"")+" en lecture ou en réflexion. ":"")+"Les marchés en préparation sont toujours comptés, quelle que soit la période."}));
}
function tableBord(L,avenir){
  return el("div",{class:"table-defil"},el("table",{class:"ia-criteres bord-table"},
    el("thead",{},el("tr",{},[avenir?"Remise":"Date","Marché","Acheteur","Étape","Montant HT"].map(t=>el("th",{text:t})))),
    el("tbody",{},L.map(x=>{
      const j=joursRestants(x.m.limite);
      const sel=el("select",{"aria-label":"Étape"},Object.entries(ETAPES).map(([k,lib])=>el("option",{value:k,text:lib}))); sel.value=x.etape;
      sel.onchange=()=>{ majResultat(x.id,{etape:sel.value,m:x.m}); synchroBientot(); };
      return el("tr",{},
        el("td",{class:"nombre"},x.m.limite?fmtDate(x.m.limite):"–",avenir&&j!=null&&j>=0?el("small",{class:j<=7?"urgent":"",text:" J-"+j}):null),
        el("td",{text:x.m.objet}),el("td",{text:x.m.acheteur||"–"}),el("td",{},sel,x.dateDepot&&ETAPES_DEPOSEES.includes(x.etape)?el("small",{class:"date-depot-bord",text:" déposée le "+dateDepotFr(x.dateDepot)}):null),el("td",{class:"nombre",text:x.montant?euros(x.montant):"–"}));
    }))));
}
function graphiqueMois(deposes){
  const mois=[], auj=new Date();
  for(let i=11;i>=0;i--){ const d=new Date(auj.getFullYear(),auj.getMonth()-i,1); mois.push({k:d.getFullYear()+"-"+d.getMonth(),lib:d.toLocaleDateString("fr-FR",{month:"short"}).replace(".",""),annee:d.getFullYear(),n:0,g:0}); }
  deposes.forEach(x=>{ const d=x.ref, k=d.getFullYear()+"-"+d.getMonth(), mo=mois.find(y=>y.k===k); if(mo){ mo.n++; if(x.etape==="gagne") mo.g++; } });
  const max=Math.max(1,...mois.map(x=>x.n));
  const W=720,H=200,ml=28,mb=26,mt=10,bw=(W-ml)/12, hy=v=>mt+(H-mt-mb)*(1-v/max);
  const NS="http://www.w3.org/2000/svg", s=(t,a,txt)=>{ const e=document.createElementNS(NS,t); for(const k in a) e.setAttribute(k,a[k]); if(txt!=null) e.textContent=txt; return e; };
  const svg=s("svg",{viewBox:"0 0 "+W+" "+H,class:"graph",role:"img","aria-label":"Offres déposées et gagnées par mois sur 12 mois"});
  const pas=max<=4?1:Math.ceil(max/4);
  for(let v=0;v<=max;v+=pas){ svg.append(s("line",{x1:ml,x2:W,y1:hy(v),y2:hy(v),class:"grille-l"}),s("text",{x:ml-6,y:hy(v)+4,"text-anchor":"end",class:"axe"},String(v))); }
  const tip=el("div",{class:"tip",hidden:true});
  mois.forEach((x,i)=>{
    const x0=ml+i*bw+bw*.2, w=bw*.6;
    if(x.n){
      const y=hy(x.n), hTot=H-mb-y;
      svg.append(s("path",{d:barre(x0,y,w,hTot),class:"barre-dep"}));
      if(x.g){ const yg=hy(x.g); svg.append(s("path",{d:barre(x0,yg,w,H-mb-yg-0),class:"barre-gagne"})); }
    }
    svg.append(s("text",{x:x0+w/2,y:H-8,"text-anchor":"middle",class:"axe"},x.lib));
    const zone=s("rect",{x:ml+i*bw,y:0,width:bw,height:H,fill:"transparent"});
    zone.addEventListener("mouseenter",()=>{ tip.hidden=false; tip.textContent=x.lib+" "+x.annee+" : "+x.n+" déposée"+(x.n>1?"s":"")+", "+x.g+" gagnée"+(x.g>1?"s":""); tip.style.left=((ml+i*bw+bw/2)/W*100)+"%"; });
    zone.addEventListener("mouseleave",()=>{ tip.hidden=true; });
    svg.append(zone);
  });
  return el("div",{class:"encadre"},el("h2",{text:"Offres déposées par mois"}),
    el("div",{class:"legende"},el("span",{class:"pastille-l dep"}),"Déposées",el("span",{class:"pastille-l gagne"}),"dont gagnées"),
    el("div",{class:"graph-cont"},svg,tip));
}
function barre(x,y,w,h){ if(h<=0) return ""; const r=Math.min(4,h,w/2); return "M"+x+","+(y+h)+"V"+(y+r)+"Q"+x+","+y+" "+(x+r)+","+y+"H"+(x+w-r)+"Q"+(x+w)+","+y+" "+(x+w)+","+(y+r)+"V"+(y+h)+"Z"; }
