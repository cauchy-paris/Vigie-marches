/* Vigie Marchés : Marchés ajoutés à la main par leur lien. */
"use strict";
/* ====================================================================
   Marchés ajoutés à la main, par le lien de la consultation
   1) le lien mène à un avis BOAMP (ou l'avis BOAMP cite ce lien) : on reprend l'avis complet ;
   2) sinon le serveur Vigie lit la page de la consultation (intitulé, acheteur, date limite…) ;
   3) ce qui manque se complète dans le formulaire. Les marchés restent enregistrés dans ce navigateur.
   ==================================================================== */
const CLE_MANUELS="vigie.manuels.v1";
let manuels=lire(CLE_MANUELS,{});
function sauverManuels(){ if(!ecrire(CLE_MANUELS,manuels)) toast("Attention : ce navigateur bloque l'enregistrement local"); }
function manuelsFiltres(){
  const mots=sansAccent($("#fMots").value.trim()).split(/\s+/).filter(Boolean), ach=sansAccent($("#fAcheteur").value.trim());
  const cibles=depsCibles(etat.regions,etat.deps);
  const auj=new Date(); auj.setHours(0,0,0,0);
  return Object.values(manuels).filter(m=>{
    if(etat.type&&m.types.length&&!m.types.includes(etat.type)) return false;
    if(cibles.length&&m.deps.length&&!m.deps.some(d=>cibles.includes(d))) return false;
    if(ach&&!sansAccent(m.acheteur).includes(ach)) return false;
    if(mots.length){ const t=sansAccent([m.objet,m.description,m.acheteur,m.lieu,m.villeAcheteur,m.refAcheteur,(m.descripteurs||[]).join(" ")].join(" ")); if(!mots.every(w=>t.includes(w))) return false; }
    if($("#fEnCours").checked&&m.limite&&new Date(m.limite)<auj) return false;
    return true;
  }).sort((a,b)=>(a.limite||"9999").localeCompare(b.limite||"9999"));
}
function afficherManuels(){
  const c=$("#listeManuels"); if(!c) return;
  c.innerHTML="";
  const n=Object.keys(manuels).length; if(!n) return;
  const items=manuelsFiltres();
  if(items.length<n) c.append(el("div",{class:"manuels-tete"},el("small",{text:(n-items.length)+" marché"+(n-items.length>1?"s":"")+" ajouté"+(n-items.length>1?"s":"")+" (lien ou alerte mail) masqué"+(n-items.length>1?"s":"")+" par les filtres (type, département, mots-clés, date limite dépassée…)"})));
  items.forEach(m=>c.append(carte(m)));
}
function rafraichirCartes(m){
  document.querySelectorAll('.carte[data-id="'+CSS.escape(m.idweb)+'"]').forEach(c=>c.replaceWith(carte(m)));
}
function retirerManuel(m){
  if(!confirm("Retirer « "+m.objet+" » de la recherche ?"+(statuts[m.idweb]?"\nIl reste dans Mes marchés avec son statut.":""))) return;
  delete manuels[m.idweb]; sauverManuels(); afficherManuels(); toast("Marché retiré de la recherche");
}

/* --- heure de Paris <-> champ date-heure --- */
function parisVersIso(v){ // « 2027-01-29T19:30 » (heure de Paris) -> ISO
  const x=/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(v||""); if(!x) return null;
  const guess=Date.UTC(+x[1],+x[2]-1,+x[3],+(x[4]||0),+(x[5]||0));
  const p=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(guess)).map(y=>[y.type,y.value]));
  return new Date(guess-(Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute)-guess)).toISOString();
}
function isoVersParis(iso){
  if(!iso) return ""; const d=new Date(iso); if(isNaN(d)) return "";
  const p=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(d).map(y=>[y.type,y.value]));
  return p.year+"-"+p.month+"-"+p.day+"T"+p.hour+":"+p.minute;
}
function normProcedure(p){
  const t=sansAccent(p||"");
  if(/^ao\b|\baoo\b|appel d.offres? ouvert|\bouverte?$/.test(t)) return "Appel d'offres ouvert";
  if(/\baor\b|appel d.offres? restreint|\brestreinte?$/.test(t)) return "Appel d'offres restreint";
  if(/adaptee|mapa/.test(t)) return "Procédure adaptée";
  return p||"";
}

/* --- 1) avis BOAMP correspondant au lien --- */
async function avisBoampParLien(url){
  let u; try{ u=new URL(url); }catch(e){ return null; }
  const essais=[];
  if(/(^|\.)boamp\.fr$/i.test(u.hostname)){
    const id=(decodeURIComponent(url).match(/(?:^|[^\d])(\d{2}-\d{4,7})(?!\d)/)||[])[1];
    if(id) essais.push({where:"idweb="+q(id)});
  }else{
    const chemin=(u.hostname.replace(/^www\./i,"")+u.pathname).replace(/\/+$/,"");
    // chemin distinctif seulement (avec un numéro), pas « index.cfm » ou « ent_detail.do » communs à toute la plateforme
    if(/\/[^\/]*\d{4,}[^\/]*\/?$|\/\d{4,}\//.test(u.pathname)) essais.push({where:"search("+q(chemin)+")",verif:d=>d.includes(chemin)});
    // numéro dans le nom de la page (AWS : /Annonces/AAPC_1905464.htm, le même numéro figure dans l'avis BOAMP : IDM=1905464)
    const num=(u.pathname.match(/[_\-\/](\d{5,})(?:\.\w+)?\/?$/)||[])[1];
    if(num) essais.push({where:"search("+q(num)+")",verif:d=>new RegExp("[=_/]"+num+"(\\D|$)").test(d)});
    const atexo=u.pathname.match(/\/consultation\/(\d{4,})/);
    if(atexo) essais.push({where:"search("+q(atexo[1])+")",verif:d=>new RegExp("(consultation/|refConsultation=|[?&;]id=)"+atexo[1]+"(\\D|$)").test(d)});
    u.searchParams.forEach((v,k)=>{ if(v.length>=5&&v.length<=60&&/\d/.test(v)&&/^[\w.\-]+$/.test(v)&&!/^(page|orgacronyme|lang|langue|e)$/i.test(k)) essais.push({where:"search("+q(v)+")",verif:d=>new RegExp("[=/_]"+v.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"(\\W|$)").test(d)}); });
  }
  for(const e of essais.slice(0,5)){
    try{
      const p=new URLSearchParams({select:CHAMPS,limit:"10",where:e.where,order_by:"dateparution desc"});
      const j=await fetch(API+"?"+p,{headers:{Accept:"application/json"}}).then(r=>r.json());
      let res=j.results||[];
      if(e.verif) res=res.filter(r=>e.verif(String(r.donnees||"").replace(/&amp;/g,"&")));
      if(!res.length||res.length>5) continue;
      const avis=res.filter(r=>!/attribution|r[ée]sultat/i.test(r.nature_libelle||""));
      return normaliser(avis[0]||res[0]);
    }catch(err){}
  }
  return null;
}
/* --- 2) lecture de la page par le serveur Vigie --- */
async function ficheParServeur(url){
  const rep=await fetch(SERVEUR_DCE+"/fiche?url="+encodeURIComponent(url),{signal:AbortSignal.timeout(75000)});
  return await rep.json().catch(()=>({ok:false,message:"Réponse illisible du serveur ("+rep.status+")"}));
}

/* --- briques communes (fenêtre d'ajout et import des alertes mail) --- */
function squeletteMarche(id){
  return {idweb:id||"MAN-"+Date.now().toString(36).toUpperCase()+Math.random().toString(36).slice(2,4).toUpperCase(),parution:null,descripteurs:[],famille:"",nature:"",lots:[],cpv:[],duree:"",montant:"",urls:[],refDocs:"",urlDepot:null,urlProfil:null,brut:null};
}
function poserLien(m,url,base){
  if(url&&!/(^|\.)boamp\.fr$/i.test((()=>{ try{ return new URL(url).hostname; }catch(e){ return ""; } })())){
    m.urlDocs=url; m.urls=[url,...(m.urls||[]).filter(x=>x!==url)].slice(0,12);
    if(!m.urlAvis||!base||!base.brut) m.urlAvis=url;
  }else if(!m.urlAvis) m.urlAvis=url||"";
  if(m.brut&&String(m.brut).length>80000) m.brut=null;
}

/* --- fenêtre d'ajout / modification --- */
function ouvrirAjout(existant){
  let base=existant?{...existant}:null, fiche=null, lu="";
  const champ=(lib,input,large)=>el("label",{class:large?"large":null},lib,input);
  const f={
    url:el("input",{type:"url",placeholder:"https://… lien de la consultation ou de l'avis",value:existant?(existant.lienSaisi||existant.urlDocs||existant.urlAvis||""):""}),
    objet:el("input",{type:"text",required:true}),
    acheteur:el("input",{type:"text",required:true}),
    limite:el("input",{type:"datetime-local"}),
    type:el("select",{},el("option",{value:"",text:"Non précisé"}),el("option",{value:"TRAVAUX",text:"Travaux"}),el("option",{value:"SERVICES",text:"Services"}),el("option",{value:"FOURNITURES",text:"Fournitures"})),
    procedure:el("input",{type:"text",list:"listeProcedures",placeholder:"ex. Procédure adaptée"}),
    dep:el("input",{type:"text",list:"listeDeps",placeholder:"ex. 75"}),
    ville:el("input",{type:"text",placeholder:"pour le nom du dossier de réponse"}),
    lieu:el("input",{type:"text"}),
    ref:el("input",{type:"text"}),
    ac:el("input",{type:"checkbox"}),
    description:el("textarea",{rows:"3"}),
  };
  const listes=el("div",{hidden:true},
    el("datalist",{id:"listeProcedures"},["Procédure adaptée","Appel d'offres ouvert","Appel d'offres restreint","Procédure négociée","Dialogue compétitif","Concours"].map(v=>el("option",{value:v}))),
    el("datalist",{id:"listeDeps"},DEPS.map(([c,n])=>el("option",{value:c+" · "+n}))));
  const etatL=el("p",{class:"etat-lecture",text:"Collez le lien puis cliquez « Lire la page » : Vigie remplit ce qu'il trouve, vous complétez le reste."});
  const bLire=el("button",{class:"btn",type:"button"},"Lire la page");
  const remplir=(v,src)=>{
    const mettre=(input,val)=>{ if(val==null||val==="") return; if(input.type==="checkbox") input.checked=!!val; else input.value=val; input.classList.add("rempli"); };
    mettre(f.objet,v.objet); mettre(f.acheteur,v.acheteur); mettre(f.limite,isoVersParis(v.limite));
    mettre(f.type,v.type); mettre(f.procedure,normProcedure(v.procedure)); mettre(f.ville,v.villeAcheteur);
    if(v.dep) mettre(f.dep,v.dep+(NOM_DEP[v.dep]?" · "+NOM_DEP[v.dep]:"")); mettre(f.lieu,v.lieu); mettre(f.ref,v.reference); if(v.accordCadre) mettre(f.ac,true);
    mettre(f.description,(v.description||"").slice(0,1500));
  };
  const depuisMarche=m=>({objet:m.objet,acheteur:m.acheteur,limite:m.limite,type:(m.types||[])[0]||"",procedure:m.procedure||m.famille,villeAcheteur:m.villeAcheteur,dep:(m.deps||[])[0]||"",lieu:m.lieu,reference:m.refAcheteur,accordCadre:m.accordCadre,description:m.description});
  if(existant){ remplir(depuisMarche(existant)); Object.values(f).forEach(i=>i.classList&&i.classList.remove("rempli")); lu=f.url.value.trim(); }
  async function lirePage(){
    const url=f.url.value.trim();
    let u; try{ u=new URL(url); if(!/^https?:$/.test(u.protocol)) throw 0; }catch(e){ etatL.className="etat-lecture ko"; etatL.textContent="Ce lien n'est pas une adresse web valide (elle doit commencer par https://)."; return; }
    const doublon=Object.values(manuels).find(m=>m.lienSaisi===url&&(!existant||m.idweb!==existant.idweb));
    if(doublon){ etatL.className="etat-lecture ko"; etatL.textContent="Ce marché est déjà dans la liste : « "+doublon.objet+" »."; return; }
    lu=url; bLire.disabled=true; etatL.className="etat-lecture"; etatL.textContent="⏳ Recherche de l'avis au BOAMP…";
    try{
      const avis=await avisBoampParLien(url);
      if(avis){
        if(manuels[avis.idweb]&&(!existant||existant.idweb!==avis.idweb)){ etatL.className="etat-lecture ko"; etatL.textContent="Ce marché est déjà dans la liste (avis BOAMP n° "+avis.idweb+")."; return; }
        base=avis; fiche=null; remplir(depuisMarche(avis));
        etatL.className="etat-lecture ok"; etatL.textContent="✓ Avis BOAMP n° "+avis.idweb+" retrouvé : toutes ses informations sont reprises. Vérifiez puis ajoutez.";
        return;
      }
      if(/(^|\.)boamp\.fr$/i.test(u.hostname)){ etatL.className="etat-lecture ko"; etatL.textContent="Avis BOAMP introuvable avec ce lien : complétez les informations à la main."; return; }
      etatL.textContent="⏳ Lecture de la page de la consultation (jusqu'à une minute si le serveur Vigie était en veille)…";
      const r=await ficheParServeur(url);
      if(!r.ok){ etatL.className="etat-lecture ko"; etatL.textContent=(r.message||"Page illisible")+" Complétez les informations à la main."; return; }
      fiche=r.fiche||{}; base=existant&&!existant.brut?existant:null;
      remplir({...fiche,dep:fiche.departement});
      const manque=[["objet","l'intitulé"],["acheteur","l'acheteur"],["limite","la date limite"]].filter(([k])=>!fiche[k]).map(x=>x[1]);
      etatL.className="etat-lecture "+(manque.length?"ko":"ok");
      etatL.textContent=manque.length?"Page lue en partie : complétez "+manque.join(", ")+" (les cases en vert ont été remplies).":"✓ Page lue : vérifiez les cases en vert puis ajoutez.";
    }catch(e){
      etatL.className="etat-lecture ko"; etatL.textContent=(e.name==="TimeoutError"||e instanceof TypeError?"Le serveur Vigie ne répond pas (réessayez dans une minute).":e.message)+" Vous pouvez aussi tout remplir à la main.";
    }finally{ bLire.disabled=false; }
  }
  bLire.onclick=lirePage;
  f.url.addEventListener("paste",()=>setTimeout(()=>{ if(f.url.value.trim()&&f.url.value.trim()!==lu) lirePage(); },0));
  f.url.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); lirePage(); } });
  const fermer=()=>{ fond.remove(); document.removeEventListener("keydown",echap); };
  const echap=e=>{ if(e.key==="Escape") fermer(); };
  const form=el("form",{class:"captcha ajout",role:"dialog","aria-modal":"true","aria-label":existant?"Modifier le marché":"Ajouter un marché"},
    el("h3",{text:existant?"Modifier le marché":"Ajouter un marché par son lien"}),
    el("label",{},"Lien de la consultation",el("div",{class:"lien"},f.url,bLire)),
    etatL,
    el("div",{class:"grille"},
      champ("Intitulé du marché *",f.objet,true),
      champ("Acheteur *",f.acheteur,true),
      champ("Date limite de remise des offres (heure de Paris)",f.limite),
      champ("Type de marché",f.type),
      champ("Procédure",f.procedure),
      champ("Département",f.dep),
      champ("Ville de l'acheteur",f.ville),
      champ("Référence de la consultation",f.ref),
      champ("Lieu d'exécution",f.lieu,true),
      el("label",{class:"large coche-ac"},f.ac,"Accord-cadre"),
      champ("Description",f.description,true)),
    listes,
    el("div",{class:"actions"},
      el("button",{class:"btn",type:"button",onclick:fermer},"Annuler"),
      el("button",{class:"btn btn-plein",type:"submit"},existant?"Enregistrer":"Ajouter le marché")));
  form.onsubmit=e=>{
    e.preventDefault();
    const url=f.url.value.trim();
    if(!f.objet.value.trim()||!f.acheteur.value.trim()){ toast("Indiquez au moins l'intitulé et l'acheteur"); (f.objet.value.trim()?f.acheteur:f.objet).focus(); return; }
    const dep=(f.dep.value.trim().match(/^(\d{2,3}|2[ab])\b/i)||[])[1];
    const m=base?{...base}:squeletteMarche(existant&&existant.idweb);
    if(!base&&fiche&&fiche.cpv) m.cpv=fiche.cpv;
    Object.assign(m,{
      objet:f.objet.value.trim(), acheteur:f.acheteur.value.trim(), limite:parisVersIso(f.limite.value),
      types:f.type.value?[f.type.value]:[], deps:dep?[dep.toUpperCase()]:[], procedure:normProcedure(f.procedure.value.trim()),
      villeAcheteur:f.ville.value.trim(), lieu:f.lieu.value.trim(), refAcheteur:f.ref.value.trim(), accordCadre:f.ac.checked,
      description:f.description.value.trim(), manuel:true, lienSaisi:url, ajoute:(existant&&existant.ajoute)||new Date().toISOString(),
    });
    poserLien(m,url,base);
    if(existant&&existant.idweb!==m.idweb){ delete manuels[existant.idweb]; }
    manuels[m.idweb]=m; sauverManuels();
    if(statuts[m.idweb]){ statuts[m.idweb].m=snapshot(m); ecrire(CLE_STATUTS,statuts); }
    if(existant&&existant.idweb!==m.idweb&&statuts[existant.idweb]){ statuts[m.idweb]={...statuts[existant.idweb],m:snapshot(m)}; delete statuts[existant.idweb]; ecrire(CLE_STATUTS,statuts); majCompteSuivis(); }
    fermer();
    afficherManuels(); rafraichirCartes(m);
    if(!$("#vue-suivi").hidden) afficherSuivi();
    toast(existant?"Marché modifié":"Marché ajouté : il apparaît en tête de la recherche");
    if(!existant&&$("#vue-recherche").hidden) changerVue("recherche");
    const c=document.querySelector('#listeManuels .carte[data-id="'+CSS.escape(m.idweb)+'"]');
    if(c) c.scrollIntoView({behavior:"smooth",block:"center"});
    else if(!existant) toast("Marché ajouté, mais masqué par les filtres en cours");
  };
  const fond=el("div",{class:"captcha-fond"},form);
  fond.addEventListener("click",e=>{ if(e.target===fond) fermer(); });
  document.addEventListener("keydown",echap);
  document.body.append(fond);
  (existant?f.objet:f.url).focus();
}
