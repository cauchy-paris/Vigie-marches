/* Vigie Marchés : Tableau Excel de suivi « 00_Suivi des marchés.xlsx ». */
"use strict";
/* ====================================================================
   Tableau Excel de suivi « 00_Suivi des marchés.xlsx »
   Rangé dans le dossier des consultations (OneDrive en ligne ou dossier du PC).
   - « J'y réponds » ajoute une ligne (infos de l'avis BOAMP + lecture du RC).
   - À l'ouverture de Vigie (ou bouton « Mettre à jour le tableau Excel »),
     les lignes « Je ne réponds pas » : dossier déplacé dans 05_Abandonnes
     et marché retiré de « Mes marchés ».
   Les cellules déjà remplies ne sont jamais réécrites (Farid peut les corriger).
   ==================================================================== */
const NOM_EXCEL="00_Suivi des marchés.xlsx";
const XLSX_MIME="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DECISIONS=["Je réponds","Peut-être","Je ne réponds pas"];
const COLS=[
  {k:"nom",titre:"Nom du marché",l:46},{k:"acheteur",titre:"Acheteur",l:30},{k:"lot",titre:"Lot concerné",l:28},
  {k:"lieu",titre:"Lieu des travaux",l:22},{k:"parution",titre:"Date de mise en ligne",l:13,date:1},
  {k:"questions",titre:"Date limite des questions",l:14,date:1},{k:"visite",titre:"Visite prévue",l:17},
  {k:"dateVisite",titre:"Date de visite",l:13,date:1},{k:"ponderation",titre:"Pondération de notation",l:42},
  {k:"limite",titre:"Date limite de remise",l:16,date:2},{k:"decision",titre:"Décision",l:19},
  {k:"dossier",titre:"Dossier",l:44},{k:"ref",titre:"Réf. BOAMP",l:11},
  {k:"resultat",titre:"Résultat",l:16},{k:"montantOffre",titre:"Montant de l'offre (€ HT)",l:16},
  {k:"collab",titre:"Collaborateur désigné",l:22}
];
const estNePasRepondre=v=>/ne\s*repon/.test(sansAccent(String(v||"")));
const CLE_TABLEAU="vigie.tableau.v1";

function chargerScriptLib(srcs){
  return srcs.reduce((p,src)=>p.catch(()=>new Promise((ok,ko)=>{ const e=document.createElement("script"); e.src=src; e.onload=ok; e.onerror=ko; document.head.append(e); })),Promise.reject())
    .catch(()=>{ throw new Error("Impossible de charger le module Excel (connexion internet ?)"); });
}
async function chargerExcelJS(){
  if(!window.ExcelJS) await chargerScriptLib(["https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js","https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js"]);
  return window.ExcelJS;
}
// Date « affichée » telle quelle dans Excel (Excel n'a pas de fuseau : on écrit l'heure de Paris)
function dateExcel(y,mo,d,h,mi){ return new Date(Date.UTC(y,mo-1,d,h||0,mi||0)); }
function dateParis(iso,avecHeure){
  if(!iso) return null; const x=new Date(iso); if(isNaN(x)) return null;
  const p=Object.fromEntries(new Intl.DateTimeFormat("fr-FR",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(x).map(v=>[v.type,v.value]));
  return dateExcel(+p.year,+p.month,+p.day,avecHeure?+p.hour:0,avecHeure?+p.minute:0);
}
function dateTexte(t,annee){ // « 25/11/2026 » ou « 25/11 »
  const m=String(t||"").match(/^(\d{2})\/(\d{2})(?:\/(\d{4}))?$/); if(!m) return null;
  return dateExcel(+(m[3]||annee),+m[2],+m[1]);
}

function atxDe(m){ let atx=null; for(const u of [m.urlDocs,m.urlDepot,m.urlProfil,...(m.urls||[])]){ atx=atexoLiens(u); if(atx) break; } return atx||atexoParRecherche(m); }
// Lecture du RC (gratuite, par règles) pour remplir la ligne ; réutilise l'analyse déjà faite si elle est assez récente
async function analysePourTableau(m){
  const cache=lire(CLE_ANALYSES,{})[m.idweb];
  if(cache&&cache.synthese&&cache.synthese.questions) return cache;
  try{ return await obtenirAnalyse(m,atxDe(m),!!cache); }catch(e){ return cache||null; }
}
function lotConcerne(m,s){
  const lots=s&&(s.lots||[]).length?s.lots.map(l=>(l.numero?l.numero+" : ":"")+l.intitule):(m.lots||[]);
  if(lots.length<=1) return {v:lots[0]||"Lot unique"};
  const termes=[];
  etat.metiers.forEach(v=>{ if(v.startsWith("d:")) termes.push(sansAccent(v.slice(2))); else{ const x=METIERS.find(y=>y.id===v.replace(/^m:/,"")); if(x) termes.push(...x.termes.map(sansAccent)); } });
  const ok=termes.length?lots.filter(l=>termes.some(t=>sansAccent(l).includes(t))):[];
  return {v:ok.length?ok.join(" ; "):"À préciser ("+lots.length+" lots)", note:"Lots de la consultation :\n"+lots.join("\n")};
}
async function ligneTableau(m,od){
  const r=await analysePourTableau(m), s=(r&&r.synthese)||{};
  const L={}, notes={};
  L.nom=m.objet; L.acheteur=m.acheteur;
  const lot=lotConcerne(m,s); L.lot=lot.v; if(lot.note) notes.lot=lot.note;
  L.lieu=m.lieu||m.villeAcheteur||(m.deps&&m.deps[0]?(NOM_DEP[m.deps[0]]||m.deps[0]):"");
  L.parution=dateParis(m.parution,false);
  const lim=m.limite?new Date(m.limite):null, annee=lim?lim.getFullYear():new Date().getFullYear();
  const q=s.questions||{};
  if(q.date) L.questions=dateTexte(q.date,annee)||q.date;
  else if(q.jours&&lim){ L.questions=dateParis(new Date(lim.getTime()-q.jours*864e5).toISOString(),false); notes.questions="Calculé : "+q.jours+" jours avant la date limite de remise."; }
  if(q.texte) notes.questions=(notes.questions?notes.questions+"\n":"")+"RC : "+q.texte;
  L.visite={obligatoire:"Oui (obligatoire)",facultative:"Oui (facultative)",non:"Non"}[s.visite_type]||(r&&r.source==="rc"?"Non indiqué dans le RC":"RC non lu");
  if(s.visite) notes.visite="RC : "+s.visite;
  if(s.visite_date) L.dateVisite=dateTexte(s.visite_date,annee)||s.visite_date;
  L.ponderation=(s.criteres||[]).length?s.criteres.map(c=>c.critere.split(/[(:]/)[0].trim()+" "+(c.ponderation||"")).join(" ; "):(r&&r.source==="rc"?"Non trouvée, voir le RC":"RC non lu, voir le RC");
  L.limite=dateParis(m.limite,true);
  L.decision="Je réponds";
  const nom=nomDossier(m);
  L.dossier=od&&od.webUrl?{text:nom,hyperlink:od.webUrl.replace(/\/$/,"")+"/"+encodeURIComponent(nom)}:nom;
  L.ref=m.idweb;
  const res=resultats[m.idweb];
  L.resultat=ETAPES[(res&&res.etape)||"prepa"];
  if(res&&res.montant) L.montantOffre=res.montant;
  L.collab=collaborateurDe(m.idweb);
  return {L,notes};
}

/* ---------- accès au fichier : OneDrive en ligne (Graph) ou dossier du PC ---------- */
const reAbandon=n=>/^0?5\s*[_\- ]*\s*abandon/.test(sansAccent(n||""));
function modeEnLigne(){ const od=lire(CLE_OD,null); return msConfigure()&&od&&(msCompte()||!FS_OK)?od:null; }
async function accesTableau(interactif){
  const od=modeEnLigne();
  if(od){
    const jeton=await msJeton(interactif,scopesDossier()); if(!jeton) return null;
    const G="https://graph.microsoft.com/v1.0/drives/"+encodeURIComponent(od.driveId), H={Authorization:"Bearer "+jeton};
    const item=id=>G+"/items/"+encodeURIComponent(id);
    const fichier=item(od.id)+":/"+encodeURIComponent(NOM_EXCEL)+":/content";
    const erreurG=async(r,quoi)=>{ const j=await r.json().catch(()=>({})); return new Error(quoi+" ("+((j.error&&j.error.message)||r.status)+")"); };
    let abandonId=null;
    const dossierAbandon=async()=>{
      if(abandonId) return abandonId;
      const rr=await fetch(item(od.id)+"?$select=id,name,parentReference",{headers:H}); if(!rr.ok) throw await erreurG(rr,"dossier OneDrive inaccessible");
      const racine=await rr.json(), parentId=racine.parentReference&&racine.parentReference.id;
      // 05_Abandonnes à côté de « 01_En cours » (sinon dans le dossier des consultations)
      for(const id of [parentId,od.id].filter(Boolean)){
        const r=await fetch(item(id)+"/children?$select=id,name,folder&$top=999",{headers:H}); if(!r.ok) continue;
        const f=((await r.json()).value||[]).find(x=>x.folder&&reAbandon(x.name)); if(f) return abandonId=f.id;
      }
      const cible=parentId&&/^\d{1,2}[_ ]/.test(racine.name)?parentId:od.id;
      const r=await fetch(item(cible)+"/children",{method:"POST",headers:{...H,"Content-Type":"application/json"},body:JSON.stringify({name:"05_Abandonnes",folder:{},"@microsoft.graph.conflictBehavior":"rename"})});
      if(!r.ok) throw await erreurG(r,"création de 05_Abandonnes impossible");
      return abandonId=(await r.json()).id;
    };
    return {
      od, lieu:"« "+od.nom+" »",
      async lire(){ const r=await fetch(fichier,{headers:H}); if(r.status===404) return null; if(!r.ok) throw await erreurG(r,"lecture du tableau impossible"); return await r.arrayBuffer(); },
      async ecrire(buf){
        const r=await fetch(fichier,{method:"PUT",headers:{...H,"Content-Type":XLSX_MIME},body:buf});
        if(r.status===423||r.status===409) throw new Error("le tableau est ouvert dans Excel sur un ordinateur : fermez-le puis cliquez « Mettre à jour le tableau Excel »");
        if(!r.ok) throw await erreurG(r,"enregistrement du tableau impossible");
        const j=await r.json().catch(()=>({})); if(j.webUrl) ecrire(CLE_TABLEAU,{webUrl:j.webUrl});
      },
      async deplacer(nom){
        const r=await fetch(item(od.id)+":/"+encodeURIComponent(nom)+"?$select=id,name,folder",{headers:H});
        if(r.status===404) return "absent"; if(!r.ok) throw await erreurG(r,"dossier « "+nom+" » inaccessible");
        const src=await r.json(), dest=await dossierAbandon();
        const corps=nouveauNom=>JSON.stringify({parentReference:{id:dest},...(nouveauNom?{name:nouveauNom}:{})});
        let r2=await fetch(item(src.id),{method:"PATCH",headers:{...H,"Content-Type":"application/json"},body:corps()});
        if(r2.status===409) r2=await fetch(item(src.id),{method:"PATCH",headers:{...H,"Content-Type":"application/json"},body:corps(nom+" ("+new Date().toLocaleDateString("sv-SE")+")")});
        if(!r2.ok) throw await erreurG(r2,"déplacement de « "+nom+" » impossible");
        return "ok";
      }
    };
  }
  if(!FS_OK) return null;
  let racine=await idbGet("racine");
  if(!racine) return null;
  let perm=await racine.queryPermission({mode:"readwrite"});
  if(perm!=="granted"&&interactif) perm=await racine.requestPermission({mode:"readwrite"});
  if(perm!=="granted") return null;
  const sansAcc=t=>t.normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const fichierH=async creer=>{ try{ return await racine.getFileHandle(NOM_EXCEL,{create:creer}); }catch(e){ if(e.name==="NotFoundError") return null; return await racine.getFileHandle(sansAcc(NOM_EXCEL),{create:creer}).catch(()=>null); } };
  const copier=async(src,dest)=>{ for await(const [n,h] of src.entries()){ if(h.kind==="directory") await copier(h,await dest.getDirectoryHandle(n,{create:true})); else{ const w=await (await dest.getFileHandle(n,{create:true})).createWritable(); await w.write(await h.getFile()); await w.close(); } } };
  return {
    od:null, lieu:"« "+racine.name+" »",
    async lire(){ const h=await fichierH(false); return h?await (await h.getFile()).arrayBuffer():null; },
    async ecrire(buf){
      try{ const h=await fichierH(true); const w=await h.createWritable(); await w.write(buf); await w.close(); }
      catch(e){ throw new Error(e.name==="NoModificationAllowedError"||e.name==="InvalidStateError"?"le tableau est ouvert dans Excel : fermez-le puis cliquez « Mettre à jour le tableau Excel »":(e.message||e)); }
    },
    async deplacer(nom){
      let src=null;
      for(const n of [nom,sansAcc(nom)]){ try{ const h=await racine.getDirectoryHandle(n); if(!await h.isSameEntry(racine)){ src=h; nom=n; break; } }catch(e){} }
      if(!src) return "absent";
      let dest=null; for await(const [n,h] of racine.entries()) if(h.kind==="directory"&&reAbandon(n)){ dest=h; break; }
      if(!dest) dest=await racine.getDirectoryHandle("05_Abandonnes",{create:true});
      let cibleNom=nom; try{ await dest.getDirectoryHandle(nom); cibleNom=nom+" ("+new Date().toLocaleDateString("sv-SE")+")"; }catch(e){}
      if(typeof src.move==="function"){ try{ await src.move(dest,cibleNom); return "ok"; }catch(e){} }
      await copier(src,await dest.getDirectoryHandle(cibleNom,{create:true}));
      await racine.removeEntry(nom,{recursive:true});
      return "ok";
    }
  };
}

/* ---------- création / lecture / mise à jour du classeur ---------- */
function feuilleNeuve(wb){
  const ws=wb.addWorksheet("Marchés",{views:[{state:"frozen",ySplit:1}]});
  ws.columns=COLS.map(c=>({header:c.titre,key:c.k,width:c.l}));
  const h=ws.getRow(1); h.height=32;
  h.eachCell(c=>{ c.font={bold:true,color:{argb:"FFFFFFFF"}}; c.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF16337A"}}; c.alignment={vertical:"middle",horizontal:"center",wrapText:true}; });
  ws.autoFilter={from:{row:1,column:1},to:{row:1,column:COLS.length}};
  const col=String.fromCharCode(64+COLS.findIndex(c=>c.k==="decision")+1);
  const regle=(texte,fond,police)=>({type:"containsText",operator:"containsText",text:texte,style:{fill:{type:"pattern",pattern:"solid",bgColor:{argb:fond}},font:{color:{argb:police},bold:true}}});
  ws.addConditionalFormatting({ref:col+"2:"+col+"1000",rules:[regle("ne réponds","FFFBE3E5","FFD22D39"),regle("Peut","FFFFF1D6","FF9A6100"),regle("Je réponds","FFE3F4E8","FF1E7B3C")]});
  return ws;
}
function colonnes(ws){
  const map={}; const norm=t=>sansAccent(String(t||"")).replace(/[^a-z0-9]/g,"");
  ws.getRow(1).eachCell((c,i)=>{ const col=COLS.find(x=>norm(x.titre)===norm(c.text)); if(col) map[col.k]=i; });
  return map;
}
function valeurVide(v){ return v==null||v===""||(typeof v==="object"&&!(v instanceof Date)&&!v.text&&!v.richText&&!v.formula&&!v.hyperlink); }
function ecrireCellule(ws,ligne,col,v,def,note){
  const c=ws.getCell(ligne,col);
  if(!valeurVide(c.value)) return false;
  if(v==null||v==="") return false;
  c.value=v;
  if(v instanceof Date) c.numFmt=def.date===2?"dd/mm/yyyy hh:mm":"dd/mm/yyyy";
  if(v&&v.hyperlink) c.font={color:{argb:"FF16337A"},underline:true};
  c.alignment={vertical:"top",wrapText:!(v instanceof Date)};
  if(note) c.note=note;
  return true;
}
function validationDecision(ws,col,jusqua){
  for(let r=2;r<=jusqua;r++){
    const c=ws.getCell(r,col);
    if(!c.dataValidation||c.dataValidation.type!=="list") c.dataValidation={type:"list",allowBlank:true,formulae:['"'+DECISIONS.join(",")+'"'],showErrorMessage:true,errorTitle:"Décision",error:"Choisissez : "+DECISIONS.join(", ")};
  }
}

let synchroEnCours=false;
// interactif : bouton cliqué (journal affiché, connexion demandée si besoin)
async function synchroTableau(interactif){
  if(synchroEnCours) return;
  synchroEnCours=true;
  let J=interactif?journal("Tableau Excel de suivi"):null;
  const jl=(t,cls)=>{ if(!J) J=journal("Tableau Excel de suivi"); return J.ligne(t,cls); };
  try{
    const acces=await accesTableau(interactif);
    if(!acces){ if(interactif) jl(FS_OK||msConfigure()?"Choisissez d'abord le dossier des réponses (OneDrive en ligne ou dossier du PC) ci-dessous, ou reconnectez-vous à Microsoft.":"Utilisez Chrome ou Edge sur PC, ou la connexion Microsoft.","ko"); return; }
    const ExcelJS=await chargerExcelJS();
    const wb=new ExcelJS.Workbook();
    const buf=await acces.lire();
    let ws, cree=false, colAjoutee=false;
    if(buf){ await wb.xlsx.load(buf); ws=wb.getWorksheet("Marchés")||wb.worksheets[0]; }
    if(!ws){ ws=feuilleNeuve(wb); cree=true; }
    let C=colonnes(ws);
    // colonnes ajoutées depuis (Résultat, Montant de l'offre) : créées au bout du tableau existant
    for(const k of ["resultat","montantOffre","collab"]) if(!C[k]){
      const col=COLS.find(x=>x.k===k), n=ws.getRow(1).cellCount+1, h=ws.getCell(1,n);
      h.value=col.titre; h.font={bold:true,color:{argb:"FFFFFFFF"}}; h.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF16337A"}}; h.alignment={vertical:"middle",horizontal:"center",wrapText:true};
      ws.getColumn(n).width=col.l; C=colonnes(ws); colAjoutee=true;
    }
    if(!C.ref){ jl("La colonne « Réf. BOAMP » a disparu du tableau : impossible de relier les lignes aux marchés. Remettez-la (titre exact) puis réessayez.","ko"); return; }
    let modifie=cree||colAjoutee, nRetire=0;
    const lignes=new Map();
    ws.eachRow((row,i)=>{ if(i>1){ const ref=String(ws.getCell(i,C.ref).text||"").trim(); if(ref) lignes.set(ref,i); } });
    // 1. « Je ne réponds pas » : dossier vers 05_Abandonnes, marché retiré de « Mes marchés »
    if(C.decision){
      for(const [ref,i] of lignes){
        if(!estNePasRepondre(ws.getCell(i,C.decision).text)) continue;
        const nom=C.dossier?String(ws.getCell(i,C.dossier).text||"").trim():"";
        const objet=C.nom?ws.getCell(i,C.nom).text:ref;
        let deplace="absent";
        if(nom){ try{ deplace=await acces.deplacer(nom); }catch(e){ jl("✗ « "+objet+" » : "+(e.message||e),"ko"); continue; } }
        if(deplace==="ok") jl("✓ Dossier « "+nom+" » rangé dans 05_Abandonnes","ok");
        if(!resultats[ref]||resultats[ref].etape!=="abandon"){ const sm=statuts[ref]&&statuts[ref].m; majResultat(ref,{etape:"abandon",m:sm?resumeMarche(sm):{objet,acheteur:C.acheteur?ws.getCell(i,C.acheteur).text:""}},false); }
        if(statuts[ref]){ delete statuts[ref]; ecrire(CLE_STATUTS,statuts); nRetire++; jl("✓ « "+objet+" » retiré de Mes marchés","ok"); }
        if(manuels[ref]){ delete manuels[ref]; sauverManuels(); afficherManuels(); }
        if(deplace==="ok"){ ws.getRow(i).eachCell(c=>{ c.font={...(c.font||{}),color:{argb:"FF8A93A6"}}; }); modifie=true; }
      }
    }
    // 2. Marchés « J'y réponds » absents du tableau : nouvelle ligne
    const aAjouter=Object.entries(statuts).filter(([id,s])=>s.statut==="reponse"&&!lignes.has(id));
    let suivante=ws.rowCount+1;
    for(const [id,s] of aAjouter){
      const l=jl("⏳ Ajout de « "+s.m.objet.slice(0,80)+" » (lecture du RC)…");
      const {L,notes}=await ligneTableau(s.m,acces.od);
      for(const col of COLS) if(C[col.k]) ecrireCellule(ws,suivante,C[col.k],L[col.k],col,notes[col.k]);
      lignes.set(id,suivante); suivante++; modifie=true;
      l.textContent="✓ Ligne ajoutée : "+s.m.objet.slice(0,80); l.className="ok";
    }
    if(C.decision) validationDecision(ws,C.decision,Math.max(ws.rowCount+100,300));
    // 3. Résultat et montant de l'offre : Vigie -> Excel si modifié dans Vigie, sinon Excel -> Vigie
    const nettoyer=[];
    if(C.resultat) for(const [ref,i] of lignes){
      const res=resultats[ref], cR=ws.getCell(i,C.resultat), cM=C.montantOffre?ws.getCell(i,C.montantOffre):null;
      if(res&&res.sale){
        cR.value=ETAPES[res.etape]||""; if(cM&&res.montant){ cM.value=res.montant; cM.numFmt='#,##0 "€"'; }
        nettoyer.push(ref); modifie=true; continue;
      }
      const et=etapeDeTexte(cR.text), mt=cM?nombre(cM.value&&cM.value.result!=null?cM.value.result:cM.text):0;
      if((et&&(!res||res.etape!==et))||(mt&&(!res||res.montant!==mt))){
        const sm=statuts[ref]&&statuts[ref].m;
        majResultat(ref,{...(et?{etape:et}:{}),...(mt?{montant:mt}:{}),m:(res&&res.m)||(sm?resumeMarche(sm):{objet:C.nom?ws.getCell(i,C.nom).text:ref,acheteur:C.acheteur?ws.getCell(i,C.acheteur).text:""})},false);
      }
    }
    // 4. Collaborateur désigné (travail d'équipe) : toujours celui du moment
    if(C.collab) for(const [ref,i] of lignes){
      const nom=collaborateurDe(ref), c=ws.getCell(i,C.collab);
      if(nom&&c.text!==nom){ c.value=nom; c.alignment={vertical:"top",wrapText:true}; modifie=true; }
    }
    for(let r=2,fin=Math.max(ws.rowCount+100,300);C.resultat&&r<=fin;r++){ const c=ws.getCell(r,C.resultat); if(!c.dataValidation||c.dataValidation.type!=="list") c.dataValidation={type:"list",allowBlank:true,formulae:['"'+Object.values(ETAPES).join(",")+'"']}; }
    if(modifie){
      await acces.ecrire(await wb.xlsx.writeBuffer());
      if(nettoyer.length){ nettoyer.forEach(r=>{ if(resultats[r]) delete resultats[r].sale; }); sauverResultats(); }
      const t=lire(CLE_TABLEAU,{});
      const l=jl((cree?"✓ Tableau « "+NOM_EXCEL+" » créé dans ":"✓ Tableau « "+NOM_EXCEL+" » mis à jour dans ")+acces.lieu+" ","ok");
      if(t&&t.webUrl&&acces.od) l.append(el("a",{href:t.webUrl,target:"_blank",rel:"noopener"},"Ouvrir le tableau"));
    }else if(interactif) jl("Le tableau est à jour : rien à ajouter, aucun « Je ne réponds pas » à traiter.","ok");
    if(nRetire){ majCompteSuivis(); if(!$("#vue-suivi").hidden) afficherSuivi(); toast(nRetire+" marché"+(nRetire>1?"s":"")+" « Je ne réponds pas » retiré"+(nRetire>1?"s":"")+" de Mes marchés"); }
  }catch(e){
    jl("✗ Tableau Excel : "+(e.message||e),"ko");
  }finally{ synchroEnCours=false; majBlocTableau(); }
}
function majBlocTableau(){
  const a=$("#lienTableau"); if(!a) return;
  const t=lire(CLE_TABLEAU,{}); a.hidden=!(t.webUrl&&modeEnLigne()); if(t.webUrl) a.href=t.webUrl;
}

function afficherListe(cont,items,vide){
  cont.innerHTML="";
  if(!items.length){ cont.append(el("div",{class:"etat",text:vide})); return; }
  const frag=document.createDocumentFragment();
  items.forEach(m=>frag.append(carte(m)));
  cont.append(frag);
}
