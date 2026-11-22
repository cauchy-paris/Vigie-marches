/* Vigie Marchés : Travail d'équipe dans une société. */
"use strict";
/* ====================================================================
   Travail d'équipe (serveur : /equipe/…, partagé entre les comptes d'une même société)
   - « J'y réponds » : le marché est pris par un seul collaborateur, les autres voient
     « Pris par Léa » et ne peuvent pas le prendre (pas de doublon).
   - L'administrateur de la société attribue un marché à un collaborateur depuis l'encart
     ou depuis le tableau de bord, et voit tous les dossiers « J'y réponds » de l'équipe.
   - L'étape de l'offre (en préparation, déposée, gagnée, perdue…) est partagée.
   Société d'une seule personne : rien ne change à l'écran.
   ==================================================================== */
const Equipe={entrees:{},membres:[],moi:"",chef:false,charge:false,silence:false};
const equipeVisible=()=>Equipe.charge&&Equipe.membres.length>1;
const nomMembre=email=>{ const x=Equipe.membres.find(y=>y.email===email); return x?x.nom:email; };
function appelEquipe(chemin,corps){
  return fetch(SERVEUR_DCE+"/equipe/"+chemin,{method:corps?"POST":"GET",headers:corps?{"Content-Type":"application/json"}:{},body:corps?JSON.stringify(corps):undefined,signal:AbortSignal.timeout(60000)})
    .then(async r=>{ const j=await r.json().catch(()=>({})); if(!r.ok){ const e=new Error(j.message||"Erreur "+r.status); e.statut=r.status; e.entree=j.entree; throw e; } return j; });
}
// collaborateur désigné pour un marché (nom), pour l'encart et le tableau Excel
function collaborateurDe(id){
  const e=Equipe.entrees[id];
  if(e) return e.collabNom||nomMembre(e.collab);
  const s=window.Comptes&&Comptes.session(); return statuts[id]&&statuts[id].statut==="reponse"&&s&&s.compte?s.compte.nom||s.compte.email:"";
}
function redessinerCartes(id){
  document.querySelectorAll(id?'.carte[data-id="'+CSS.escape(id)+'"]':".carte[data-id]").forEach(c=>{ if(c._m) c.replaceWith(carte(c._m)); });
  if(!$("#vue-bord").hidden) afficherBord();
}

let equipeEnCours=null;
async function chargerEquipe(){
  if(equipeEnCours) return equipeEnCours;
  equipeEnCours=(async()=>{
    let r; try{ r=await appelEquipe("liste"); }catch(e){ return; }
    Equipe.membres=r.membres||[]; Equipe.moi=r.moi; Equipe.chef=!!r.chef; Equipe.charge=true;
    Equipe.entrees=Object.fromEntries((r.entrees||[]).map(e=>[e.id,e]));
    let chg=false;
    Equipe.silence=true;
    try{
      for(const e of Object.values(Equipe.entrees)){
        // marché attribué à moi par l'administrateur : il arrive dans « Mes marchés »
        if(e.collab===Equipe.moi&&(!statuts[e.id]||statuts[e.id].statut!=="reponse")&&e.m&&e.m.objet){
          statuts[e.id]={statut:"reponse",date:new Date().toISOString(),m:{deps:[],types:[],descripteurs:[],lots:[],cpv:[],urls:[],...e.m},...(statuts[e.id]&&statuts[e.id].dce?{dce:statuts[e.id].dce}:{})};
          chg=true; if(e.par&&e.par!==Equipe.moi) toast("Marché attribué par "+(e.parNom||e.par)+" : « "+e.m.objet.slice(0,60)+" »");
        }
        // étape changée par un autre membre de l'équipe
        const res=resultats[e.id];
        if(e.par!==Equipe.moi&&(!res||res.etape!==e.etape||(e.montant&&res.montant!==e.montant))){
          majResultat(e.id,{etape:e.etape,...(e.montant?{montant:e.montant}:{}),m:resumeMarche(e.m||{})});
        }
      }
      // mes « J'y réponds » d'avant le travail d'équipe : enregistrés pour l'équipe
      if(Equipe.membres.length>1) for(const [id,s] of Object.entries(statuts)){
        if(s.statut==="reponse"&&!Equipe.entrees[id]&&s.m) appelEquipe("prendre",{id,m:snapshotEquipe(s.m)}).then(x=>{ Equipe.entrees[id]=x.entree; },()=>{});
      }
    }finally{ Equipe.silence=false; }
    if(chg){ ecrire(CLE_STATUTS,statuts); majCompteSuivis(); if(!$("#vue-suivi").hidden) afficherSuivi(); synchroBientot(); }
    redessinerCartes();
  })().finally(()=>{ equipeEnCours=null; });
  return equipeEnCours;
}
function initEquipe(){
  chargerEquipe();
  setInterval(()=>{ if(!document.hidden) chargerEquipe(); },120000);
  document.addEventListener("visibilitychange",()=>{ if(!document.hidden) chargerEquipe(); });
}
// copie du marché envoyée à l'équipe (sans le texte brut de l'avis, trop lourd)
function snapshotEquipe(m){ const x=snapshot(m); delete x.brut; return x; }

/* ---------- « J'y réponds » : pas de doublon ---------- */
// appelé avant de passer un marché en « J'y réponds » : false = refusé
function equipePeutPrendre(m){
  const e=Equipe.entrees[m.idweb];
  if(!e||e.collab===Equipe.moi) return true;
  if(Equipe.chef) return confirm("« "+m.objet.slice(0,80)+" » est déjà pris par "+e.collabNom+". Le reprendre pour vous ?");
  toast("Déjà pris par "+e.collabNom+" : demandez à l'administrateur de votre société de vous l'attribuer.");
  return false;
}
async function equipePrendre(m,pour){
  if(!Equipe.charge) await chargerEquipe();
  if(!Equipe.charge) return true;
  try{
    const r=await appelEquipe("prendre",{id:m.idweb,m:snapshotEquipe(m),...(pour?{pour}:{})});
    Equipe.entrees[m.idweb]=r.entree; redessinerCartes(m.idweb);
    return true;
  }catch(e){
    if(e.statut===409){ if(e.entree) Equipe.entrees[m.idweb]=e.entree; toast(e.message); return false; }
    toast("Équipe : "+e.message); return true;
  }
}
function equipeLiberer(id){
  const e=Equipe.entrees[id];
  if(!e||(e.collab!==Equipe.moi&&!Equipe.chef)) return;
  appelEquipe("liberer",{id}).then(()=>{ delete Equipe.entrees[id]; redessinerCartes(id); },e=>toast("Équipe : "+e.message));
}
// appelé à chaque changement d'étape ou de montant (encart, tableau de bord, tableau Excel)
function equipeEtape(id,res){
  if(Equipe.silence||!Equipe.charge||!res||!res.etape) return;
  const e=Equipe.entrees[id];
  if(e&&e.collab!==Equipe.moi&&!Equipe.chef) return;
  if(!e&&!(statuts[id]&&statuts[id].statut==="reponse")) return;
  const m=statuts[id]&&statuts[id].m;
  appelEquipe("etape",{id,etape:res.etape,montant:res.montant||null,...(m?{m:snapshotEquipe(m)}:{})}).then(r=>{ Equipe.entrees[id]=r.entree; redessinerCartes(id); },()=>{});
}

/* ---------- sur l'encart ---------- */
function badgeEquipe(m){
  if(!equipeVisible()) return null;
  const e=Equipe.entrees[m.idweb]; if(!e) return null;
  const moi=e.collab===Equipe.moi, et=e.etape&&e.etape!=="prepa"?" · "+ETAPES[e.etape]:"";
  return el("span",{class:"badge equipe"+(moi?" moi":""),title:(moi?"Vous répondez":e.collabNom+" répond")+" à ce marché"+(e.par&&e.par!==e.collab?" (attribué par "+e.parNom+")":"")+", depuis le "+new Date(e.cree).toLocaleDateString("fr-FR"),text:"👤 "+(moi?"Vous":e.collabNom)+et});
}
function attributionEquipe(m){
  if(!equipeVisible()||!Equipe.chef) return null;
  const e=Equipe.entrees[m.idweb];
  const sel=el("select",{class:"attribuer","aria-label":"Attribuer ce marché à un collaborateur",title:"Attribuer ce marché à un collaborateur"},
    el("option",{value:"",text:"— personne —"}),Equipe.membres.map(x=>el("option",{value:x.email,text:x.nom+(x.email===Equipe.moi?" (vous)":""),selected:!!e&&e.collab===x.email})));
  sel.onchange=async()=>{
    if(!sel.value){ if(e&&confirm("Retirer l'attribution de ce marché ?")) equipeLiberer(m.idweb); return; }
    if(await equipePrendre(m,sel.value)) toast("Marché attribué à "+nomMembre(sel.value));
    if(sel.value===Equipe.moi&&(!statuts[m.idweb]||statuts[m.idweb].statut!=="reponse")) changerStatut(m,"reponse");
  };
  return el("label",{class:"attribuer-l"},"👤 Collaborateur",sel);
}
// bouton « Offre déposée » (encart en « J'y réponds »)
function boutonOffreDeposee(m){
  const res=resultats[m.idweb], et=res&&res.etape;
  if(["depose","gagne","perdu","sanssuite"].includes(et)) return el("span",{class:"btn btn-depose fait",title:"Étape de l'offre : "+ETAPES[et]},"✓ Offre "+ETAPES[et].toLowerCase());
  return el("button",{class:"btn btn-depose",type:"button",title:"L'offre est déposée sur la plateforme : passe le suivi de l'offre à « Déposée »",onclick:()=>{
    majResultat(m.idweb,{etape:"depose",m:resumeMarche(m)}); synchroBientot(); toast("Offre déposée : bonne chance !"); redessinerCartes(m.idweb);
  }},"✓ Offre déposée");
}

/* ---------- tableau de bord de l'équipe (administrateur de la société) ---------- */
function blocEquipe(){
  if(!equipeVisible()||!Equipe.chef) return null;
  const E=Object.values(Equipe.entrees);
  const parMembre=Equipe.membres.map(x=>{
    const L=E.filter(e=>e.collab===x.email), n=k=>L.filter(e=>e.etape===k).length, g=n("gagne"), p=n("perdu");
    return {x,prepa:n("prepa"),depose:n("depose"),g,p,taux:g+p?Math.round(g/(g+p)*100):null,montant:L.filter(e=>e.etape==="gagne").reduce((a,e)=>a+(e.montant||0),0)};
  });
  const enCours=E.filter(e=>["prepa","depose"].includes(e.etape)).sort((a,b)=>((a.m&&a.m.limite)||"9").localeCompare((b.m&&b.m.limite)||"9"));
  const choix=e=>{
    const s=el("select",{"aria-label":"Collaborateur désigné"},Equipe.membres.map(x=>el("option",{value:x.email,text:x.nom,selected:x.email===e.collab})));
    s.onchange=async()=>{ if(await equipePrendre({idweb:e.id,objet:e.m.objet,...e.m},s.value)) toast("Marché attribué à "+nomMembre(s.value)); afficherBord(); };
    return s;
  };
  return el("div",{class:"encadre"},
    el("div",{class:"titre-ligne"},el("h2",{text:"Équipe : qui travaille sur quoi"}),
      el("button",{class:"btn",type:"button",onclick:()=>recapEquipeExcel().catch(e=>toast(e.message))},"⬇ Récapitulatif Excel de l'équipe")),
    el("div",{class:"table-defil"},el("table",{class:"ia-criteres bord-table"},
      el("thead",{},el("tr",{},["Collaborateur","En préparation","Déposées","Gagnées","Perdues","Taux de réussite","Montant gagné"].map(t=>el("th",{text:t})))),
      el("tbody",{},parMembre.map(r=>el("tr",{},el("td",{text:r.x.nom}),el("td",{class:"nombre",text:r.prepa}),el("td",{class:"nombre",text:r.depose}),el("td",{class:"nombre",text:r.g}),el("td",{class:"nombre",text:r.p}),el("td",{class:"nombre",text:r.taux==null?"–":r.taux+" %"}),el("td",{class:"nombre",text:r.montant?euros(r.montant):"–"})))))),
    el("h3",{class:"sous-titre",text:"Dossiers en cours ("+enCours.length+")"}),
    enCours.length?el("div",{class:"table-defil"},el("table",{class:"ia-criteres bord-table"},
      el("thead",{},el("tr",{},["Remise","Marché","Acheteur","Collaborateur désigné","Étape"].map(t=>el("th",{text:t})))),
      el("tbody",{},enCours.map(e=>{ const j=joursRestants(e.m&&e.m.limite); return el("tr",{},
        el("td",{class:"nombre"},e.m&&e.m.limite?fmtDate(e.m.limite):"–",j!=null&&j>=0?el("small",{class:j<=7?"urgent":"",text:" J-"+j}):null),
        el("td",{text:(e.m&&e.m.objet)||e.id}),el("td",{text:(e.m&&e.m.acheteur)||"–"}),el("td",{},choix(e)),el("td",{text:ETAPES[e.etape]||e.etape})); })))):el("p",{class:"note-docs",text:"Aucun dossier « J'y réponds » en cours dans l'équipe."}));
}
async function recapEquipeExcel(){
  const ExcelJS=await chargerExcelJS();
  const wb=new ExcelJS.Workbook(), ws=wb.addWorksheet("Équipe",{views:[{state:"frozen",ySplit:1}]});
  ws.columns=[{header:"Nom du marché",key:"nom",width:46},{header:"Acheteur",key:"acheteur",width:30},{header:"Date limite de remise",key:"limite",width:18},
    {header:"Collaborateur désigné",key:"collab",width:22},{header:"Étape",key:"etape",width:16},{header:"Montant de l'offre (€ HT)",key:"montant",width:16},
    {header:"Pris le",key:"cree",width:13},{header:"Attribué par",key:"par",width:20},{header:"Réf. BOAMP",key:"ref",width:12}];
  const h=ws.getRow(1); h.height=30; h.eachCell(c=>{ c.font={bold:true,color:{argb:"FFFFFFFF"}}; c.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF16337A"}}; c.alignment={vertical:"middle",horizontal:"center",wrapText:true}; });
  Object.values(Equipe.entrees).sort((a,b)=>((a.m&&a.m.limite)||"9").localeCompare((b.m&&b.m.limite)||"9")).forEach(e=>{
    const r=ws.addRow({nom:(e.m&&e.m.objet)||e.id,acheteur:(e.m&&e.m.acheteur)||"",limite:e.m&&e.m.limite?new Date(e.m.limite):null,collab:e.collabNom,etape:ETAPES[e.etape]||e.etape,montant:e.montant||null,cree:new Date(e.cree),par:e.parNom||"",ref:e.id});
    r.getCell("limite").numFmt="dd/mm/yyyy hh:mm"; r.getCell("cree").numFmt="dd/mm/yyyy"; r.getCell("montant").numFmt='#,##0 "€"';
    r.alignment={vertical:"top",wrapText:true};
  });
  ws.autoFilter={from:{row:1,column:1},to:{row:1,column:9}};
  const blob=new Blob([await wb.xlsx.writeBuffer()],{type:XLSX_MIME});
  const a=el("a",{href:URL.createObjectURL(blob),download:"Vigie_equipe_"+dateIso(new Date())+".xlsx"}); document.body.append(a); a.click(); a.remove();
}
