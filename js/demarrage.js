/* Vigie Marchés : Démarrage de l'application (chargé en dernier). */
"use strict";
/* ---------- Démarrage ---------- */
let msMetiers, msDeps, msRegions, minuterie;
function relancerBientot(){ clearTimeout(minuterie); minuterie=setTimeout(()=>rechercher(0),350); }
function init(){
  majRacine();
  { const be=$("#btnExt"); if(be) be.onclick=telechargerExtension; majExtension(); setTimeout(majExtension,800); }
  if(msConfigure()){ msInit().catch(()=>{}); $("#btnMs").onclick=()=>msConnecter(); $("#btnLienOd").onclick=()=>enregistrerLienOd().catch(e=>toast(e.message)); majMs(); }
  const br=$("#btnRacine"); if(br) br.onclick=async()=>{ if(!FS_OK){ toast("Utilisez Chrome ou Edge sur PC"); return; } try{ await dossierRacine(true); toast("Dossier enregistré"); }catch(e){} };
  restaurerFiltres(); majSegments();
  // anciens choix enregistrés sans préfixe = regroupements métier
  etat.metiers.forEach((v,i)=>{ if(!/^[md]:/.test(v)) etat.metiers[i]="m:"+v; });
  msMetiers=multiSelecteur($("#fMetiers"),optionsPrestations,etat.metiers,"Toutes les prestations",relancerBientot);
  chargerDescripteurs().then(()=>{ msMetiers.rafraichir(); $("#aidePrestations").textContent="Liste complète des prestations du BOAMP, avec le nombre d'annonces sur 2 ans, plus des regroupements par métier. Elle suit le type de marché choisi."; }).catch(()=>{});
  msRegions=multiSelecteur($("#fRegions"),REGIONS.map(r=>[r[0],r[1]]),etat.regions,"Toutes les régions",relancerBientot);
  msDeps=multiSelecteur($("#fDeps"),DEPS.map(([c,n])=>[c,c+" · "+n]),etat.deps,"Toute la France",relancerBientot);
  document.querySelectorAll("#fType button").forEach(b=>b.onclick=()=>{ etat.type=b.dataset.v; majSegments(); msMetiers.rafraichir(); rechercher(0); });
  ["#fNature","#fPublie","#fEnCours","#fTexteComplet","#fTri","#fPlateformes"].forEach(s=>$(s).addEventListener("change",()=>rechercher(0)));
  $("#formFiltres").addEventListener("submit",e=>{ e.preventDefault(); rechercher(0); });
  $("#btnRaz").onclick=()=>{ etat.type=""; etat.metiers.length=0; etat.deps.length=0; etat.regions.length=0; $("#formFiltres").reset(); majSegments(); msMetiers.rafraichir(); msDeps.rafraichir(); msRegions.rafraichir(); rechercher(0); };
  document.querySelectorAll(".onglet").forEach(b=>b.onclick=()=>changerVue(b.dataset.vue));
  $("#btnExport").onclick=()=>{
    const blob=new Blob([JSON.stringify({version:1,exporte:new Date().toISOString(),statuts,manuels,rectif,resultats,profil:lire(CLE_PROFIL,null)},null,2)],{type:"application/json"});
    const a=el("a",{href:URL.createObjectURL(blob),download:"vigie-marches-statuts-"+dateIso(new Date())+".json"}); document.body.append(a); a.click(); a.remove();
  };
  $("#fichierImport").onchange=async e=>{
    const f=e.target.files[0]; if(!f) return;
    try{ const j=JSON.parse(await f.text()); const s=j.statuts||j; if(typeof s!=="object") throw 0; statuts={...statuts,...s}; ecrire(CLE_STATUTS,statuts); if(j.manuels&&typeof j.manuels==="object"){ manuels={...manuels,...j.manuels}; sauverManuels(); afficherManuels(); } if(j.resultats&&typeof j.resultats==="object"){ resultats={...resultats,...j.resultats}; sauverResultats(); } if(j.profil&&typeof j.profil==="object") ecrire(CLE_PROFIL,j.profil); if(j.rectif&&j.rectif.par){ rectif.par={...j.rectif.par,...rectif.par}; sauverRectif(); afficherModifs(); } majCompteSuivis(); afficherSuivi(); toast(Object.keys(s).length+" marchés restaurés"); }
    catch(err){ toast("Fichier de sauvegarde illisible"); }
    e.target.value="";
  };
  const bt=$("#btnTableau"); if(bt) bt.onclick=()=>synchroTableau(true);
  $("#btnAjout").onclick=()=>ouvrirAjout(null);
  $("#btnOd").onclick=()=>ouvrirOneDrive();
  $("#btnMail").onclick=()=>ouvrirImportMail();
  majBoutonOd();
  majBlocTableau();
  // à l'ouverture : relecture du tableau Excel (décisions « Je ne réponds pas »), sans rien demander
  setTimeout(()=>{ (msConfigure()?msInit().catch(()=>{}):Promise.resolve()).then(()=>synchroTableau(false)); },1500);
  afficherSources(); majCompteSuivis(); initDecp(); initRappels(); initImportAuto(); initModifs(); initBord(); initEquipe(); initSuppression();
  rechercher(0);
}
if(window.opener&&window.opener!==window&&/[#&?](code|error)=/.test(location.hash+location.search)){ document.body.innerHTML="<p style='font:16px system-ui;padding:24px'>Connexion en cours…</p>"; }
else Comptes.demarrer(init);
