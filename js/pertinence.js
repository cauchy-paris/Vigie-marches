/* Vigie Marchés : Note de pertinence selon le profil de l'entreprise. */
"use strict";
/* ====================================================================
   Note de pertinence (règles, sans IA) selon le profil de l'entreprise
   notePertinence(m) -> {score:0..100, raisons:[{ok:true|false|null,txt}], exclu}
   ==================================================================== */
const CLE_PROFIL="vigie.profil.v1";
const PROFIL_DEFAUT={
  metiers:["grosoeuvre","menuiserie","peinture","platrerie","plomberie","cvc","electricite","couverture","serrurerie","demolition","maintenance"],
  deps:["75","77","78","91","92","93","94","95"],
  types:["TRAVAUX"],
  min:20000, max:3000000,
  favoris:"tous corps d'état, TCE, réhabilitation, rénovation, entretien, aménagement",
  exclus:"",
};
function profil(){ const p=lire(CLE_PROFIL,null); return p?{...PROFIL_DEFAUT,...p,perso:true}:{...PROFIL_DEFAUT,perso:false}; }
function nombre(v){ if(typeof v==="number") return isFinite(v)?v:0; const t=String(v||"").replace(/[\s  ]/g,"").replace(/€|HT|TTC|eur/gi,"").replace(",","."); const n=parseFloat(t); return isFinite(n)?n:0; }
function motsListe(t){ return String(t||"").split(/[,;\n]/).map(x=>sansAccent(x.trim())).filter(x=>x.length>1); }
const regionDe=d=>{ const g=REGIONS.find(r=>r[2].includes(d)); return g?g[0]:null; };
function notePertinence(m){
  const P=profil(), raisons=[]; let score=0;
  const texte=" "+sansAccent([m.objet,(m.lots||[]).join(" "),m.description,(m.descripteurs||[]).join(" ")].join(" "))+" ";
  // Métier : 35
  const noms=P.metiers.map(id=>{ const x=METIERS.find(y=>y.id===id); return x?x.nom.split(",")[0]:null; }).filter(Boolean);
  const ce=corpsEtat(m), communs=ce.filter(x=>noms.includes(x));
  const tce=/tous corps d.etat|\btce\b|multi.?techni|entreprise generale|clos.couvert/.test(texte);
  if(communs.length){ score+=35; raisons.push({ok:true,txt:"Vos métiers : "+communs.slice(0,4).join(", ")}); }
  else if(tce&&noms.length>=3){ score+=35; raisons.push({ok:true,txt:"Tous corps d'état"}); }
  else if(!ce.length){ score+=12; raisons.push({ok:null,txt:"Métier non identifié dans l'annonce"}); }
  else raisons.push({ok:false,txt:"Hors de vos métiers ("+ce.slice(0,3).join(", ")+")"});
  // Type de marché : 10
  if(!(m.types||[]).length){ score+=5; }
  else if(m.types.some(t=>P.types.includes(t))){ score+=10; }
  else raisons.push({ok:false,txt:"Type "+m.types.map(t=>TYPES_LIB[t]||t).join(", ").toLowerCase()+" hors profil"});
  // Zone : 25
  const deps=m.deps||[];
  if(!deps.length){ score+=12; raisons.push({ok:null,txt:"Lieu non précisé"}); }
  else if(deps.some(d=>P.deps.includes(d))){ score+=25; raisons.push({ok:true,txt:"Dans votre zone ("+deps.filter(d=>P.deps.includes(d)).join(", ")+")"}); }
  else{ const reg=new Set(P.deps.map(regionDe)); if(deps.some(d=>reg.has(regionDe(d)))){ score+=12; raisons.push({ok:null,txt:"Région voisine de votre zone ("+deps.join(", ")+")"}); } else raisons.push({ok:false,txt:"Hors zone ("+deps.join(", ")+")"}); }
  // Taille : 20
  let mt=nombre(m.montant), parLot=false;
  if(mt&&(m.lots||[]).length>1){ mt=mt/m.lots.length; parLot=true; }
  const k=n=>n>=1e6?(Math.round(n/1e5)/10).toLocaleString("fr-FR")+" M€":Math.round(n/1e3).toLocaleString("fr-FR")+" k€";
  if(!mt){ score+=12; raisons.push({ok:null,txt:"Montant non publié"}); }
  else if(mt>=P.min&&mt<=P.max){ score+=20; raisons.push({ok:true,txt:"Taille adaptée ("+k(mt)+(parLot?" par lot environ":"")+")"}); }
  else if(mt<P.min){ score+=10; raisons.push({ok:null,txt:"Petit marché ("+k(mt)+(parLot?" par lot":"")+")"}); }
  else if(mt<=P.max*2){ score+=8; raisons.push({ok:null,txt:"Un peu gros pour vous ("+k(mt)+(parLot?" par lot":"")+")"}); }
  else raisons.push({ok:false,txt:"Trop gros ("+k(mt)+(parLot?" par lot":"")+")"});
  // Délai : 10
  const j=joursRestants(m.limite);
  if(j==null) score+=5;
  else if(j<0) raisons.push({ok:false,txt:"Date limite passée"});
  else if(j<5){ score+=2; raisons.push({ok:false,txt:"Moins de 5 jours pour répondre"}); }
  else if(j<10){ score+=6; raisons.push({ok:null,txt:j+" jours pour répondre"}); }
  else score+=10;
  // Mots-clés : bonus 10, exclus = note plafonnée
  const fav=motsListe(P.favoris).filter(w=>texte.includes(w));
  if(fav.length){ score+=10; raisons.push({ok:true,txt:"Mot favori : "+fav.slice(0,3).join(", ")}); }
  const exc=motsListe(P.exclus).filter(w=>texte.includes(w));
  let exclu=false;
  if(exc.length){ exclu=true; score=Math.min(score,15); raisons.unshift({ok:false,txt:"Mot à éviter : "+exc.slice(0,3).join(", ")}); }
  return {score:Math.max(0,Math.min(100,Math.round(score))),raisons,exclu,perso:P.perso};
}
function niveauPert(s){ return s>=70?"haut":s>=45?"moyen":"bas"; }
function badgePertinence(p,det){
  const b=el("button",{type:"button",class:"badge pert pert-"+niveauPert(p.score),"aria-expanded":"false",title:"Pertinence pour votre entreprise. Cliquez pour le détail.\n"+p.raisons.map(r=>(r.ok?"✓ ":r.ok===false?"✗ ":"• ")+r.txt).join("\n")},"Pertinence "+p.score+" %");
  b.onclick=()=>{ det.hidden=!det.hidden; b.setAttribute("aria-expanded",String(!det.hidden)); };
  return b;
}
function detailPertinence(p){
  return el("div",{class:"pert-detail",hidden:true},
    el("ul",{},p.raisons.map(r=>el("li",{class:r.ok?"ok":r.ok===false?"ko":"neutre",text:r.txt}))),
    el("button",{type:"button",class:"lien-plus",onclick:ouvrirProfil},p.perso?"Modifier mon profil entreprise":"Profil par défaut (BTP tous corps d'état, Île-de-France) : l'ajuster"));
}
function parPage(){ return $("#fTri")&&$("#fTri").value==="pertinence"?100:PAR_PAGE; }

function ouvrirProfil(){
  const P=profil(), metiers=[...P.metiers], deps=[...P.deps];
  const fermer=()=>{ fond.remove(); document.removeEventListener("keydown",echap); };
  const echap=e=>{ if(e.key==="Escape") fermer(); };
  const f={
    min:el("input",{type:"number",min:"0",step:"1000",value:String(P.min)}),
    max:el("input",{type:"number",min:"0",step:"10000",value:String(P.max)}),
    favoris:el("textarea",{rows:"2"}), exclus:el("textarea",{rows:"2",placeholder:"ex. fourniture seule, nettoyage, Corse"}),
  };
  f.favoris.value=P.favoris; f.exclus.value=P.exclus;
  const types=Object.entries(TYPES_LIB).map(([k,lib])=>{ const c=el("input",{type:"checkbox",value:k}); c.checked=P.types.includes(k); return el("label",{class:"coche-ac"},c,lib); });
  const cMet=el("div",{class:"multi"}), cDeps=el("div",{class:"multi"});
  const form=el("form",{class:"captcha ajout",role:"dialog","aria-modal":"true","aria-label":"Mon profil entreprise"},
    el("h3",{text:"Mon profil entreprise"}),
    el("p",{class:"note-docs",text:"Sert à noter la pertinence de chaque marché sur 100 : métier (35), zone (25), taille (20), délai (10), type (10), et un bonus de 10 si un mot favori apparaît. Un mot à éviter plafonne la note à 15. Enregistré dans ce navigateur."}),
    el("div",{class:"grille"},
      el("div",{class:"large"},el("label",{},"Vos métiers"),cMet),
      el("div",{class:"large"},el("label",{},"Départements où vous travaillez"),cDeps),
      el("label",{},"Montant minimum par marché ou par lot (€ HT)",f.min),
      el("label",{},"Montant maximum par marché ou par lot (€ HT)",f.max),
      el("div",{class:"large",style:"display:flex;gap:14px;flex-wrap:wrap"},el("span",{style:"font-size:12.5px;font-weight:600;color:var(--bleu-fonce)"},"Types de marché :"),types),
      el("label",{class:"large"},"Mots favoris (séparés par des virgules)",f.favoris),
      el("label",{class:"large"},"Mots à éviter",f.exclus)),
    el("div",{class:"actions"},
      el("button",{type:"button",class:"btn",onclick:()=>{ try{ localStorage.removeItem(CLE_PROFIL); }catch(e){} fermer(); rafraichirNotes(); toast("Profil par défaut rétabli"); }},"Profil par défaut"),
      el("button",{type:"button",class:"btn",onclick:fermer},"Annuler"),
      el("button",{type:"submit",class:"btn btn-plein"},"Enregistrer")));
  form.onsubmit=e=>{
    e.preventDefault();
    const min=nombre(f.min.value), max=nombre(f.max.value)||PROFIL_DEFAUT.max;
    ecrire(CLE_PROFIL,{metiers,deps,types:[...form.querySelectorAll('input[type=checkbox][value]')].filter(c=>c.checked).map(c=>c.value),min:Math.min(min,max),max:Math.max(min,max),favoris:f.favoris.value,exclus:f.exclus.value});
    fermer(); rafraichirNotes(); toast("Profil enregistré : notes de pertinence recalculées");
  };
  const fond=el("div",{class:"captcha-fond"},form);
  fond.addEventListener("mousedown",e=>{ if(e.target===fond) fermer(); });
  document.addEventListener("keydown",echap);
  document.body.append(fond);
  multiSelecteur(cMet,METIERS.map(x=>[x.id,x.nom]),metiers,"Aucun métier",()=>{});
  multiSelecteur(cDeps,DEPS.map(([c,n])=>[c,c+" · "+n]),deps,"Toute la France",()=>{});
}
function rafraichirNotes(){ rechercher(etat.page); if(!$("#vue-suivi").hidden) afficherSuivi(); }
