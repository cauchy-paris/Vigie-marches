/* Vigie Marchés : recherche directe sur PLACE, Maximilien et AWS-Achat, en plus du BOAMP. */
"use strict";
/* ====================================================================
   Le serveur Vigie interroge les plateformes (route /plateformes, cache 30 min).
   Ici : mêmes filtres que la recherche BOAMP, retrait des consultations déjà publiées au BOAMP
   (l'avis BOAMP cite le numéro de la consultation, ou même référence et même date limite),
   puis affichage dans le bloc « Directement sur les plateformes ».
   Si une plateforme ne répond pas, les autres s'affichent et le bloc le signale.
   ==================================================================== */
const PF_PREFIXE={place:"PLACE",maximilien:"MAXI",aws:"AWS"};
const PF_AFFICHES=20;
let pfSeq=0, pfMinuteur=null, pfTous=false;
const pfDejaBoamp=new Map(); // idweb plateforme -> idweb BOAMP (ou "" si absent du BOAMP)

function pfActif(){ const c=$("#fPlateformes"); const n=$("#fNature").value; return (!c||c.checked)&&(n==="APPEL_OFFRE"||n===""); }
function pfTermes(){
  const t=[];
  etat.metiers.forEach(v=>{
    if(v.startsWith("d:")) t.push(v.slice(2));
    else (METIERS.find(m=>m.id===v.replace(/^m:/,""))||{termes:[]}).termes.forEach(x=>t.push(x));
  });
  return [...new Set(t)];
}
// consultation renvoyée par le serveur -> marché au format Vigie (mêmes encarts, statuts, DCE)
function pfVersMarche(x,source,nom){
  const objet=x.intitule||x.objet||"(sans objet)";
  return {
    idweb:PF_PREFIXE[source]+"-"+x.id, source:nom, horsBoamp:true, depsFiltres:!!x.depsFiltres,
    objet, description:x.objet&&x.objet!==objet?x.objet:"", acheteur:x.acheteur||"",
    parution:x.parution||null, limite:x.limite||null,
    types:x.types||[], deps:x.deps||[], descripteurs:[],
    procedure:x.procedure||"", famille:"", nature:"Avis de marché",
    urlAvis:x.url, urlDocs:x.urlDce||x.url, urlDepot:null, urlProfil:null, urls:[x.url,x.urlDce].filter(Boolean),
    lots:[], nbLots:x.lots||0, cpv:[], duree:"", montant:"",
    refAcheteur:x.reference||"", refDocs:"", lieu:x.lieu&&!/^\d{5}$/.test(x.lieu)&&!/^\s*\((\d{2,3}|2A|2B)\)/i.test(x.lieu)?x.lieu:"", // la liste des départements s'affiche déjà villeAcheteur:"", siretAcheteur:"", accordCadre:false,
    rectifie:!!x.rectifie, brut:null,
  };
}
// mêmes filtres que la recherche BOAMP, appliqués dans le navigateur
function pfFiltrer(items,parTermes){
  const mots=sansAccent($("#fMots").value.trim()).split(/\s+/).filter(Boolean), ach=sansAccent($("#fAcheteur").value.trim());
  const termes=pfTermes().map(sansAccent);
  const cibles=depsCibles(etat.regions,etat.deps);
  const auj=new Date(); auj.setHours(0,0,0,0);
  const pub=$("#fPublie").value, depuis=pub?Date.now()-Number(pub)*86400000:0;
  return items.filter(m=>{
    if(etat.type&&m.types.length&&!m.types.includes(etat.type)) return false;
    if(cibles.length&&!m.depsFiltres&&m.deps.length&&!m.deps.some(d=>cibles.includes(d))) return false;
    if(ach&&!sansAccent(m.acheteur).includes(ach)) return false;
    const t=sansAccent([m.objet,m.description,m.acheteur,m.refAcheteur,m.lieu].join(" "));
    if(mots.length&&!mots.every(w=>t.includes(w))) return false;
    // métiers : déjà demandés à PLACE et Maximilien (recherche par ces mots) ; vérifiés ici pour AWS
    if(termes.length&&!parTermes(m)&&!termes.some(w=>t.includes(w))) return false;
    if($("#fEnCours").checked&&m.limite&&new Date(m.limite)<auj) return false;
    if(depuis&&m.parution&&new Date(m.parution).getTime()<depuis) return false;
    return true;
  });
}
const pfNormRef=r=>sansAccent(r||"").replace(/[^a-z0-9]/g,"");
const pfJour=iso=>{ if(!iso) return ""; const d=new Date(iso); return isNaN(d)?"":d.toLocaleDateString("fr-FR",{timeZone:"Europe/Paris"}); };
const pfRefDistinctive=r=>{ const n=pfNormRef(r); return n.length>=6&&/\d/.test(n)&&/[a-z]|\d{6,}/.test(n); };
// même consultation qu'un avis BOAMP ? numéro de la consultation dans l'avis, ou même référence et même date limite
function pfMemeQueBoamp(m,b){
  const num=m.idweb.split("-").slice(1).join("-");
  const d=String(b.brut||b.donnees||"").replace(/&amp;/g,"&");
  if(d&&(m.source==="AWS-Achat"?new RegExp("(IDM=|_)"+num+"(\\D|$)"):new RegExp("(consultation/|refConsultation=|[?&;]id=)"+num+"(\\D|$)")).test(d)) return true;
  const ref=pfNormRef(m.refAcheteur);
  const memeJour=m.limite&&pfJour(m.limite)===pfJour(b.limite||b.datelimitereponse);
  if(ref.length>=4&&memeJour&&(pfNormRef(b.refAcheteur)===ref||(pfRefDistinctive(m.refAcheteur)&&pfNormRef(d).includes(ref)))) return true;
  const o1=sansAccent(m.objet).replace(/[^a-z0-9]+/g," ").trim(), o2=sansAccent(b.objet||"").replace(/[^a-z0-9]+/g," ").trim();
  return !!(memeJour&&o1.length>=25&&(o1===o2||(o2.length>=25&&(o1.includes(o2)||o2.includes(o1)))));
}
// avis BOAMP qui citent ces consultations : une requête pour 20 consultations
async function pfChercherDansBoamp(items){
  const aVoir=items.filter(m=>!pfDejaBoamp.has(m.idweb));
  for(let i=0;i<aVoir.length;i+=20){
    const lot=aVoir.slice(i,i+20);
    const conds=[];
    lot.forEach(m=>{ conds.push("search("+q(m.idweb.split("-").slice(1).join("-"))+")"); if(pfRefDistinctive(m.refAcheteur)) conds.push("search("+q(m.refAcheteur)+")"); });
    try{
      const p=new URLSearchParams({select:"idweb,objet,datelimitereponse,donnees",limit:"100",where:"("+conds.join(" OR ")+")",order_by:"dateparution desc"});
      const j=await fetch(API+"?"+p,{headers:{Accept:"application/json"}}).then(r=>r.ok?r.json():Promise.reject(new Error("HTTP "+r.status)));
      const avis=(j.results||[]).map(r=>({idweb:r.idweb,objet:r.objet,limite:r.datelimitereponse,brut:r.donnees,refAcheteur:""}));
      lot.forEach(m=>{ const b=avis.find(a=>pfMemeQueBoamp(m,a)); pfDejaBoamp.set(m.idweb,b?b.idweb:""); });
    }catch(e){ /* BOAMP injoignable : on garde la comparaison avec la page affichée */ }
  }
}

function lancerPlateformes(itemsBoamp){
  const bloc=$("#blocPlateformes"); if(!bloc) return;
  clearTimeout(pfMinuteur);
  const seq=++pfSeq;
  pfTous=false;
  if(!pfActif()||etat.page>0){ bloc.hidden=true; bloc.innerHTML=""; return; }
  bloc.hidden=false;
  bloc.innerHTML="";
  bloc.append(el("div",{class:"pf-tete"},el("h2",{text:"Directement sur PLACE, Maximilien et AWS-Achat"}),el("p",{class:"pf-etat",text:"Recherche sur les plateformes…"})));
  pfMinuteur=setTimeout(()=>chargerPlateformes(seq,itemsBoamp||[]),500);
}
async function chargerPlateformes(seq,itemsBoamp){
  const bloc=$("#blocPlateformes");
  const mots=$("#fMots").value.trim(), termes=pfTermes();
  const params=new URLSearchParams({sources:"place,maximilien,aws",mots,termes:termes.join("|"),type:etat.type||"",deps:depsCibles(etat.regions,etat.deps).join(",")});
  let corps;
  try{
    const rep=await fetch(SERVEUR_DCE+"/plateformes?"+params,{signal:AbortSignal.timeout(150000)});
    corps=await rep.json().catch(()=>null);
    if(!rep.ok||!corps||!corps.plateformes) throw new Error((corps&&corps.message)||("le serveur répond "+rep.status));
  }catch(e){
    if(seq!==pfSeq) return;
    bloc.querySelector(".pf-etat").textContent="⚠ Les plateformes n'ont pas pu être interrogées ("+(e.name==="TimeoutError"?"délai dépassé":e.message)+"). Les résultats BOAMP restent complets ; relancez la recherche dans un instant.";
    bloc.querySelector(".pf-etat").classList.add("ko");
    return;
  }
  if(seq!==pfSeq) return;
  // consultations au format Vigie, une seule fois chacune
  const tous=new Map(), parTermesIds=new Set();
  for(const p of corps.plateformes) for(const x of p.items||[]){
    const m=pfVersMarche(x,p.source,p.nom);
    if(!tous.has(m.idweb)) tous.set(m.idweb,m);
    if(p.source!=="aws"&&!mots&&termes.length) parTermesIds.add(m.idweb);
  }
  let items=pfFiltrer([...tous.values()],m=>parTermesIds.has(m.idweb));
  // retrait de ce qui est déjà au BOAMP : page affichée, puis avis BOAMP qui citent la consultation
  const filtres=items.length;
  items=items.filter(m=>!itemsBoamp.some(b=>pfMemeQueBoamp(m,b)));
  await pfChercherDansBoamp(items);
  if(seq!==pfSeq) return;
  items=items.filter(m=>!pfDejaBoamp.get(m.idweb));
  const doublons=filtres-items.length;
  const tri=$("#fTri").value;
  if(tri==="pertinence") items.sort((a,b)=>notePertinence(b).score-notePertinence(a).score);
  else if(tri==="dateparution desc") items.sort((a,b)=>(b.parution||"").localeCompare(a.parution||""));
  else items.sort((a,b)=>(a.limite||"9999").localeCompare(b.limite||"9999"));
  afficherPlateformes(corps.plateformes,items,doublons);
  majSnapshots(items);
}
function afficherPlateformes(plateformes,items,doublons){
  const bloc=$("#blocPlateformes");
  bloc.innerHTML="";
  const n=items.length;
  const etats=el("ul",{class:"pf-sources"});
  for(const p of plateformes){
    const nb=items.filter(m=>m.idweb.startsWith(PF_PREFIXE[p.source]+"-")).length;
    etats.append(el("li",{class:p.ok?"ok":"ko",title:p.ok?(p.nb+" consultation"+(p.nb>1?"s":"")+" lue"+(p.nb>1?"s":"")+" sur la plateforme"+(p.partiel?" (résultats partiels : la plateforme en a davantage)":"")):p.message},
      p.ok?("✓ "+p.nom+" : "+nb+" hors BOAMP"+(p.partiel?" (partiel)":"")):("⚠ "+p.message)));
  }
  const partiel=plateformes.some(p=>p.ok&&p.partiel);
  bloc.append(el("div",{class:"pf-tete"},
    el("h2",{},el("span",{class:"pf-nb",text:String(n)}),n>1?" consultations trouvées directement sur les plateformes, absentes du BOAMP":" consultation trouvée directement sur les plateformes, absente du BOAMP"),
    etats,
    el("p",{class:"pf-etat",text:(doublons>0?doublons+" consultation"+(doublons>1?"s":"")+" déjà publiée"+(doublons>1?"s":"")+" au BOAMP, donc masquée"+(doublons>1?"s":"")+" ici (sans doublon). ":"")+(partiel?"Les plateformes ont plus de résultats que ceux lus : ajoutez des mots-clés, un métier ou des départements pour affiner. ":"")+"Petits marchés (MAPA) compris ; le DCE se télécharge avec les mêmes boutons."})));
  if(!n){ bloc.append(el("div",{class:"etat",text:"Aucune consultation hors BOAMP ne correspond à ces filtres sur les plateformes."})); return; }
  const liste=el("div",{class:"pf-liste"});
  (pfTous?items:items.slice(0,PF_AFFICHES)).forEach(m=>liste.append(carte(m)));
  bloc.append(liste);
  if(!pfTous&&n>PF_AFFICHES){
    const b=el("button",{class:"btn",type:"button",text:"Voir les "+(n-PF_AFFICHES)+" autres consultations des plateformes"});
    b.onclick=()=>{ pfTous=true; b.remove(); items.slice(PF_AFFICHES).forEach(m=>liste.append(carte(m))); };
    bloc.append(b);
  }
}
