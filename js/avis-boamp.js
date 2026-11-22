/* Vigie Marchés : Lecture et normalisation des avis BOAMP (champ « donnees »). */
"use strict";
/* ====================================================================
   Lecture du champ « donnees » (eForms, FNSimple, MAPA…)
   ==================================================================== */
function txt(v){
  if(v==null) return "";
  if(typeof v==="string"||typeof v==="number") return String(v).trim();
  if(Array.isArray(v)){
    const fr=v.find(x=>x&&typeof x==="object"&&/^FR/i.test(x["@languageID"]||""));
    return txt(fr||v[0]);
  }
  if(typeof v==="object"){
    if("#text" in v) return txt(v["#text"]);
    if("$" in v) return txt(v["$"]);
  }
  return "";
}
/* Parcourt l'arbre : appelle f(clé, valeur, chemin) */
function parcourir(o,f,chemin=""){
  if(o==null||typeof o!=="object") return;
  if(Array.isArray(o)){ o.forEach((x,i)=>parcourir(x,f,chemin)); return; }
  for(const k of Object.keys(o)){
    const v=o[k], p=chemin?chemin+"/"+k:k;
    f(k,v,p);
    if(v&&typeof v==="object") parcourir(v,f,p);
  }
}
function premier(o,cle){ let r; parcourir(o,(k,v)=>{ if(r===undefined&&k===cle) r=v; }); return r; }
function tous(o,cle){ const r=[]; parcourir(o,(k,v)=>{ if(k===cle) r.push(v); }); return r; }
function premierRe(o,re,filtre){ let r; parcourir(o,(k,v,p)=>{ if(r===undefined&&re.test(k)){ const t=txt(v); if(t&&(!filtre||filtre(t))) r=t; } }); return r; }

const URL_RE=/https?:\/\/[^\s"'<>\\)]+/gi;
const URL_IGNOREES=/telerecours|juradm|europa\.eu|legifrance|service-public|conseil-etat|economie\.gouv\.fr\/daj|w3\.org|schemas|xmlns|boamp\.journal-officiel/i;

function analyserDonnees(brut){
  const res={description:"",lieu:"",duree:"",montant:"",lots:[],cpv:[],urlDocs:null,urlDepot:null,urlProfil:null,refAcheteur:"",villeAcheteur:"",siretAcheteur:"",accordCadre:false};
  if(!brut) return res;
  let d; try{ d=typeof brut==="string"?JSON.parse(brut):brut; }catch(e){ return res; }

  // --- liens : classement d'après la clé où l'URL apparaît
  const docs=[],depot=[],profil=[],autres=[];
  parcourir(d,(k,v,p)=>{
    const t=typeof v==="string"?v:(v&&typeof v==="object"&&!Array.isArray(v)&&typeof v["#text"]==="string"?v["#text"]:null);
    if(!t) return;
    const urls=t.match(URL_RE); if(!urls) return;
    for(let u of urls){
      u=u.replace(/&amp;/g,"&").replace(/[.,;]+$/,"");
      if(URL_IGNOREES.test(u)) continue;
      if(/CallForTendersDocumentReference|DocConsul|URL_DOCUMENT|document|dce/i.test(p)) docs.push(u);
      else if(/EndpointID|TenderRecipient|PARTICIPATION|depot|Depot|soumission|remise/i.test(p)) depot.push(u);
      else if(/BuyerProfile|PROFIL|profil/i.test(p)) profil.push(u);
      else if(!/WebsiteURI|URL_ACHETEUR|urlAcheteur|MEL|mail/i.test(p)) autres.push(u);
    }
  });
  const plateformeConnue=u=>{ const p=plateformeDe(u); return p&&PLATEFORMES.includes(p); };
  res.urlDocs = docs[0] || depot.find(plateformeConnue) || autres.find(plateformeConnue) || null;
  res.urlDepot = depot[0]||null;
  res.urlProfil = profil[0]||null;
  res.urls = [...new Set([...docs,...depot,...autres,...profil])].slice(0,12);

  // --- CPV
  const cpv=[];
  parcourir(d,(k,v,p)=>{
    if(k==="cbc:ItemClassificationCode"||/cpv/i.test(p)){
      const t=txt(v); const m=t.match(/^(\d{8})(-\d)?$/);
      if(m&&!cpv.includes(m[1])) cpv.push(m[1]);
    }
  });
  res.cpv=cpv;

  // --- description / résumé
  const projet = premier(d,"cac:ProcurementProject");
  res.description = (projet&&txt(premier(projet,"cbc:Description")))
    || premierRe(d,/^(RESUME_OBJET|OBJET_COMPLET|objetComplet|descriptionMarche|DESCRIPTION_SUCCINCTE|description)$/i, t=>t.length>20) || "";

  // --- montant estimé
  const montantE = premier(d,"cbc:EstimatedOverallContractAmount");
  if(montantE!==undefined){ res.montant=formaterMontant(txt(montantE), montantE&&montantE["@currencyID"]); }
  else{
    const m=premierRe(d,/^(VALEUR_ESTIMEE|valeurEstimee|VALEUR|MONTANT|montant|valeurTotale)$/i,t=>/^\d[\d\s.,]*$/.test(t));
    if(m) res.montant=formaterMontant(m,"EUR");
  }

  // --- durée
  const dur = premier(d,"cbc:DurationMeasure");
  if(dur!==undefined){ res.duree=formaterDuree(txt(dur), dur&&dur["@unitCode"]); }
  else{
    const mo=premierRe(d,/^(DUREE_MOIS|dureeMois|NB_MOIS)$/i,t=>/^\d+$/.test(t)); if(mo) res.duree=mo+" mois";
    else{ const j=premierRe(d,/^(DUREE_JOURS|dureeJours|NB_JOURS)$/i,t=>/^\d+$/.test(t)); if(j) res.duree=j+" jours"; }
  }

  // --- lieu d'exécution
  const lieuNoeud = premier(d,"cac:RealizedLocation");
  if(lieuNoeud){
    const ville=txt(premier(lieuNoeud,"cbc:CityName")), cp=txt(premier(lieuNoeud,"cbc:PostalZone")), desc=txt(premier(lieuNoeud,"cbc:Description"));
    res.lieu=[cp,ville].filter(Boolean).join(" ")||desc;
  }
  if(!res.lieu) res.lieu = premierRe(d,/^(LIEU_EXECUTION|lieuExecution|LIEU_PRINCIPAL|lieuPrincipal|LIEU_EXEC_LIVR|lieuExecutionLivraison)$/i)||"";

  // --- lots
  const lotsE = tous(d,"cac:ProcurementProjectLot").flatMap(x=>Array.isArray(x)?x:[x]);
  if(lotsE.length>1){
    res.lots = lotsE.map(l=>{ const pp=premier(l,"cac:ProcurementProject"); return txt(pp&&premier(pp,"cbc:Name"))||txt(premier(l,"cbc:ID")); }).filter(Boolean);
  }else{
    const lotsL = tous(d,"LOT").concat(tous(d,"lot")).flatMap(x=>Array.isArray(x)?x:[x]).filter(x=>x&&typeof x==="object");
    if(lotsL.length>1) res.lots = lotsL.map(l=>premierRe(l,/^(INTITULE|intitule|DESCRIPTION|description|objet)$/i)||"").filter(Boolean);
  }

  // --- référence acheteur
  res.refAcheteur = (projet&&txt(premier(projet,"cbc:ID"))) || premierRe(d,/^(REF_MARCHE|numeroReference|REFERENCE_MARCHE|referenceMarche)$/i)||"";
  const docRefNoeud = premier(d,"cac:CallForTendersDocumentReference");
  res.refDocs = (docRefNoeud&&txt(premier(docRefNoeud,"cbc:ID")))||"";

  // --- ville de l'acheteur (nom du dossier de réponse)
  const cp=premier(d,"cac:ContractingParty"), idAch=cp&&txt(premier(cp,"cbc:ID"));
  let ville="";
  if(idAch) for(const o of tous(d,"efac:Company").flatMap(x=>Array.isArray(x)?x:[x])){
    if(txt(premier(premier(o,"cac:PartyIdentification")||{},"cbc:ID"))===idAch){ ville=txt(premier(o,"cbc:CityName")); break; }
  }
  res.villeAcheteur = ville || premierRe(d,/^(cbc:CityName|VILLE|ville|commune)$/i) || "";
  // --- SIRET de l'acheteur (historique DECP exact)
  let siret="";
  if(idAch) for(const o of tous(d,"efac:Company").flatMap(x=>Array.isArray(x)?x:[x])){
    if(txt(premier(premier(o,"cac:PartyIdentification")||{},"cbc:ID"))===idAch){ siret=txt(premier(premier(o,"cac:PartyLegalEntity")||{},"cbc:CompanyID")); break; }
  }
  if(!/^\d{9}/.test((siret||"").replace(/\s/g,""))) siret=premierRe(d,/^(SIRET|siret|CODE_IDENT_NATIONAL|codeIdentificationNational|NUM_SIRET)$/i,t=>/^\d[\d\s]{8,}$/.test(t))||"";
  res.siretAcheteur=(siret||"").replace(/\s/g,"");
  // --- accord-cadre
  const brutTxt=typeof brut==="string"?brut:JSON.stringify(brut);
  res.accordCadre = /"(fa-wo-rc|fa-w-rc|fa-mix)"|accord[- ]?cadre|ACCORD_CADRE"\s*:\s*\{|"accordCadre"\s*:\s*"?(true|oui)/i.test(brutTxt);
  return res;
}
function formaterMontant(v,devise){
  const n=parseFloat(String(v).replace(/\s/g,"").replace(",","."));
  if(!isFinite(n)||n<=0) return "";
  return n.toLocaleString("fr-FR",{maximumFractionDigits:0})+" "+(devise&&devise!=="EUR"?devise:"€")+" HT";
}
function formaterDuree(v,u){
  if(!v) return "";
  const unites={MONTH:"mois",DAY:"jours",YEAR:"ans",WEEK:"semaines"};
  let n=v; if(u==="YEAR"&&v==="1") return "1 an";
  return n+" "+(unites[u]||u||"");
}

/* ---------- Normalisation d'un enregistrement ---------- */
function liste(v){ return v==null?[]:Array.isArray(v)?v:[v]; }
function normaliser(r){
  const a=analyserDonnees(r.donnees);
  return {
    idweb:r.idweb, objet:r.objet||"(sans objet)", acheteur:r.nomacheteur||"",
    parution:r.dateparution||null, limite:r.datelimitereponse||null,
    types:liste(r.type_marche), deps:liste(r.code_departement), descripteurs:liste(r.descripteur_libelle),
    procedure:r.procedure_libelle||"", famille:r.famille_libelle||"", nature:r.nature_libelle||"",
    urlAvis:r.url_avis||("https://www.boamp.fr/pages/avis/?q=idweb:"+r.idweb),
    brut:r.donnees||null,
    ...a
  };
}
