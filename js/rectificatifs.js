/* Vigie Marchés : Suivi des rectificatifs et des questions-réponses. */
"use strict";
/* ====================================================================
   Suivi des rectificatifs et des questions-réponses
   Une fois par jour, pour les marchés de « Mes marchés » encore ouverts :
   1) BOAMP : avis rectificatifs, avis modifiés (eForms) ou annulations liés à l'avis suivi (champ annonce_lie) ;
   2) page de la consultation (PLACE, Maximilien, Atexo, AWS, achatpublic…) relue par le serveur Vigie :
      date limite et taille du RC / du DCE comparées à la dernière lecture ;
   3) mails des plateformes (questions-réponses, rectificatifs, report) lus lors de l'import des alertes.
   Un changement de date limite met à jour le marché (rappels et agenda suivent).
   ==================================================================== */
const CLE_RECTIF="vigie.rectif.v1";
let rectif=lire(CLE_RECTIF,{dernier:null,par:{}}); rectif.par=rectif.par||{};
function sauverRectif(){ ecrire(CLE_RECTIF,rectif); }
function changementsDe(id){ return (rectif.par[id]&&rectif.par[id].changements)||[]; }
function marchesSuivisOuverts(){
  const auj=new Date(); auj.setHours(0,0,0,0);
  return Object.values(statuts).map(s=>manuels[s.m&&s.m.idweb]||s.m).filter(m=>m&&m.idweb&&(!m.limite||new Date(m.limite)>=auj));
}
function ajouterChangement(m,ch){
  const r=rectif.par[m.idweb]=rectif.par[m.idweb]||{changements:[]};
  r.changements=r.changements||[];
  if(r.changements.some(x=>x.cle===ch.cle)) return false;
  r.changements.unshift({...ch,date:ch.date||new Date().toISOString(),lu:false,objet:m.objet});
  r.changements=r.changements.slice(0,30);
  return true;
}
function changerLimite(m,iso,source){
  if(!iso||!m.limite||Math.abs(new Date(iso)-new Date(m.limite))<6e4) return null;
  const avant=m.limite;
  const appliquer=x=>{ if(x){ x.limiteInitiale=x.limiteInitiale||avant; x.limite=iso; } };
  if(manuels[m.idweb]){ appliquer(manuels[m.idweb]); sauverManuels(); }
  if(statuts[m.idweb]){ appliquer(statuts[m.idweb].m); ecrire(CLE_STATUTS,statuts); }
  appliquer(m);
  return "Date limite "+(new Date(iso)>new Date(avant)?"reportée":"avancée")+" : du "+fmtDate(avant,true)+" au "+fmtDate(iso,true)+" ("+source+")";
}
// Nouvelle date limite dans la phrase d'un rectificatif → ISO (heure de Paris). Formes rencontrées au BOAMP :
// « Au lieu de 27/11/2026 à 12h00, lire 04/12/2026 à 12h00 », « reportée au vendredi 11 décembre 2026 à 16h00 »,
// « reportée du 24 novembre 2026 à 10 heures au 1er décembre 2026 à 10 heures », « LIRE le 23 novembre 2026 à 09:00 »,
// « reportée au 4 décembre 2026 à 12h00, en lieu et place du 20 novembre 2026 », « fixée initialement au 27 novembre… est fixée au 1er décembre 2026 à 12 H 15 min ».
const MOIS_FR={janvier:1,fevrier:2,mars:3,avril:4,mai:5,juin:6,juillet:7,aout:8,septembre:9,octobre:10,novembre:11,decembre:12};
const RE_DATE_RECTIF=/(\d{1,2})(?:er)?\s*(?:[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*|\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+)(\d{4}|\d{2}\b)(?:[\s,]*(?:a|,)?\s*(\d{1,2})\s*(?:h|:|heures?)\s*(\d{2})?)?/g;
function datesDuTexte(t){
  const r=[]; RE_DATE_RECTIF.lastIndex=0; let x;
  while((x=RE_DATE_RECTIF.exec(t))){
    const mo=x[2]?+x[2]:MOIS_FR[x[3]], an=x[4].length===2?2000+ +x[4]:+x[4], j=+x[1];
    if(!mo||mo>12||j<1||j>31||an<2020||an>2100) continue;
    r.push({i:x.index,fin:x.index+x[0].length,an,mo,j,h:x[5]!=null?+x[5]:null,mi:x[6]!=null?+x[6]:0});
  }
  return r;
}
function nouvelleDateDansTexte(texte,limiteActuelle){
  const brut=sansAccent(texte||"").replace(/\s+/g," ");
  const segments=brut.split(/ \| |rubrique ?:/).filter(x=>/limite|remise|reception|depot|plis|offres|dlro/.test(x));
  for(const t of segments){
    const ds=datesDuTexte(t); if(!ds.length) continue;
    let choix=null;
    const iLire=t.search(/\blire\b(?![\s\S]*\blire\b)/);
    if(iLire>=0) choix=ds.find(d=>d.i>iLire);
    if(!choix){
      const gardees=ds.filter(d=>!/(au lieu d[eu]|initialement(?: fixee)?(?: au| le)?|en lieu et place d[eu]|report[a-z]* du|decal[a-z]* du|prevue? (?:au|le)|lieu du)\s*(?:[a-z]+di\s+)?(?:le\s+)?$/.test(t.slice(Math.max(0,d.i-45),d.i)));
      choix=gardees[0]||null;
    }
    if(!choix) continue;
    let h=choix.h, mi=choix.mi;
    if(h==null){ // heure non précisée : on garde celle de la date limite actuelle
      const p=limiteActuelle?isoVersParis(limiteActuelle):""; const hm=/T(\d{2}):(\d{2})/.exec(p||"");
      h=hm?+hm[1]:12; mi=hm?+hm[2]:0;
    }
    if(h>23||mi>59) continue;
    const p2=n=>String(n).padStart(2,"0");
    return parisVersIso(choix.an+"-"+p2(choix.mo)+"-"+p2(choix.j)+"T"+p2(h)+":"+p2(mi));
  }
  return null;
}
function texteRectifBoamp(d){
  if(!d) return {texte:"",date:null};
  const f=d.FNSimple||d.MAPA||d.FNS||Object.values(d)[0]||{};
  const r=f.rectificatif||premier(d,"rectificatif");
  const info=r&&(r.infosRectif!=null?r.infosRectif:premier(r,"infosRectif"));
  if(info){
    let date=null;
    const parties=(Array.isArray(info)?info:[info]).map(x=>{
      if(typeof x==="string") return x;
      if(x&&x.lireDate&&/reception|offre|candidature|pli/i.test(x.rubDelais||"ReceptionOffres")){ date=date||parisVersIso(String(x.lireDate).slice(0,16)); return "Date limite : au lieu du "+fmtDate(parisVersIso(String(x.auLieuDeDate||"").slice(0,16)),true)+", lire "+fmtDate(parisVersIso(String(x.lireDate).slice(0,16)),true); }
      return Object.entries(x||{}).map(([k,v])=>(k==="rubrique"?"Rubrique : ":/^auLieuDe/i.test(k)?"Au lieu de : ":/^lire/i.test(k)?"Lire : ":/apres/i.test(k)?"Ajouter : ":/supprim/i.test(k)?"Supprimer : ":"")+txt(v)).join(" · ");
    });
    return {texte:parties.join(" | "),date};
  }
  const raison=premier(d,"efbc:ReasonDescription")||premier(d,"efbc:ChangeDescription");
  return {texte:raison?txt(raison):"",date:null};
}
async function rectifsBoamp(ms){
  const ids=ms.map(m=>m.idweb).filter(id=>/^\d{2}-\d{4,7}$/.test(id));
  let n=0;
  for(let i=0;i<ids.length;i+=20){
    const lot=ids.slice(i,i+20);
    const where="("+lot.map(id=>"annonce_lie="+q(id)).join(" or ")+") and nature!=\"ATTRIBUTION\"";
    const url=API+"?"+new URLSearchParams({where,select:"idweb,nature,nature_libelle,annonce_lie,dateparution,datelimitereponse,url_avis,donnees",order_by:"dateparution asc",limit:"100"});
    const rep=await fetch(url,{signal:AbortSignal.timeout(30000)}); if(!rep.ok) throw new Error("BOAMP indisponible ("+rep.status+")");
    const j=await rep.json();
    for(const r of j.results||[]){
      for(const id of liste(r.annonce_lie).filter(x=>lot.includes(x))){
        const m=ms.find(x=>x.idweb===id); if(!m) continue;
        let d=null; try{ d=typeof r.donnees==="string"?JSON.parse(r.donnees):r.donnees; }catch(e){}
        const tr=texteRectifBoamp(d), texte=tr.texte;
        const annul=r.nature==="ANNULATION";
        // date structurée du rectificatif, sinon la phrase, sinon la date limite de l'avis modifié (eForms)
        const nl=annul?null:(tr.date||nouvelleDateDansTexte(texte,m.limite)||(r.nature!=="RECTIFICATIF"?r.datelimitereponse:null));
        const cle="boamp:"+r.idweb;
        if(changementsDe(m.idweb).some(x=>x.cle===cle)) continue;
        const date=changerLimite(m,nl,"avis BOAMP n° "+r.idweb);
        if(ajouterChangement(m,{cle,type:annul?"Annulation":r.nature==="RECTIFICATIF"?"Rectificatif BOAMP":"Avis modifié (BOAMP)",texte:[date,texte||(annul?"La consultation est annulée.":"L'avis a été modifié.")].filter(Boolean).join(" · ").slice(0,600),lien:r.url_avis||"https://www.boamp.fr/pages/avis/?q=idweb:"+r.idweb,date:r.dateparution?new Date(r.dateparution).toISOString():null})) n++;
      }
    }
  }
  return n;
}
async function pageConsultation(m){
  const r=rectif.par[m.idweb]||{};
  if(r.url) return r.url;
  const atx=atxDe(m);
  let url=null;
  if(atx&&!atx.recherche) url=atx.consultation;
  else if(atx&&atx.recherche){ // annonce qui ne donne que l'accueil de PLACE : le serveur retrouve la consultation (une seule fois)
    if(r.introuvable===dateIso(new Date())) return null;
    const l=await lienDirectDce(m,atx).catch(()=>null);
    if(l&&l.consultation&&!/[?&]quoi=/.test(l.consultation)) url=l.consultation;
    else if(l&&l.lien){ const a2=atexoLiens(l.lien); if(a2) url=a2.consultation; }
    if(!url){ (rectif.par[m.idweb]=rectif.par[m.idweb]||{changements:[]}).introuvable=dateIso(new Date()); return null; }
  }else{
    const u=m.lienSaisi||m.urlDocs||"";
    url=u&&!/boamp\.fr/i.test(u)&&!estAccueil(u)?u:null;
  }
  if(url) (rectif.par[m.idweb]=rectif.par[m.idweb]||{changements:[]}).url=url;
  return url;
}
async function rectifsPages(ms){
  let n=0, lues=0;
  for(const m of ms){
    const url=await pageConsultation(m); if(!url) continue;
    if(++lues>12) break; // le serveur limite le nombre de lectures
    let r; try{ r=await ficheParServeur(url); }catch(e){ continue; }
    if(!r||!r.ok||!r.fiche) continue;
    const f=r.fiche, ref=rectif.par[m.idweb]=rectif.par[m.idweb]||{changements:[]};
    const docs=(f.docs||[]).join(" | ");
    const textes=[];
    if(ref.page){
      if(f.limite&&ref.page.limite&&Math.abs(new Date(f.limite)-new Date(ref.page.limite))>=6e4){
        textes.push(changerLimite(m,f.limite,"page de la consultation")||"Date limite modifiée sur la plateforme : "+fmtDate(f.limite,true));
      }
      if(docs&&ref.page.docs&&docs!==ref.page.docs) textes.push("Pièces de la consultation modifiées : « "+ref.page.docs+" » devient « "+docs+" ». Téléchargez à nouveau le DCE.");
    }
    ref.page={limite:f.limite||(ref.page&&ref.page.limite)||null,docs:docs||(ref.page&&ref.page.docs)||"",lu:new Date().toISOString()};
    if(textes.length&&ajouterChangement(m,{cle:"page:"+dateIso(new Date())+":"+textes.join("|").length,type:/DCE|Pièces/.test(textes.join(" "))?"DCE modifié":"Date limite modifiée",texte:textes.join(" · "),lien:url})) n++;
  }
  return n;
}
// messages des plateformes (questions-réponses, rectificatifs…) rattachés aux marchés suivis
function traiterMessagesSuivi(messages){
  if(!messages||!messages.length) return 0;
  const ms=marchesSuivisOuverts(); let n=0;
  const cles=m=>{ const k=new Set(); for(const u of [m.lienSaisi,m.urlDocs,m.urlDepot,...(m.urls||[]),(atxDe(m)||{}).consultation]){ try{ const c=u&&pfDeLien(new URL(u)); if(c) k.add(c.cle); }catch(e){} } const a=atxDe(m); if(a){ const x=/consultation\/(\d+)/.exec(a.consultation||""); if(x) k.add("id:"+x[1]); } return k; };
  for(const msg of messages){
    const t=sansAccent((msg.sujet||"")+" "+(msg.texte||""));
    const kMsg=new Set(); for(const l of msg.liens||[]){ try{ const u=deballerLien(l); const c=u&&pfDeLien(u); if(c) kMsg.add(c.cle); const x=/consultation\/(\d+)|[?&](?:id|refConsultation)=(\d{5,})/.exec(u?u.href:l); if(x) kMsg.add("id:"+(x[1]||x[2])); }catch(e){} }
    for(const m of ms){
      const ref=(m.refAcheteur||"").trim();
      const parLien=[...cles(m)].some(k=>kMsg.has(k));
      const parRef=ref.length>=5&&t.includes(sansAccent(ref));
      const mots=sansAccent(m.objet||"").split(/[^a-z0-9]+/).filter(w=>w.length>=5);
      const parObjet=mots.length>=3&&mots.filter(w=>t.includes(w)).length>=Math.max(3,Math.ceil(mots.length*.8));
      if(!parLien&&!parRef&&!parObjet) continue;
      const type=/question|r[ée]ponse/i.test(msg.sujet)?"Question-réponse":/annul/i.test(msg.sujet)?"Annulation":/rectifi|modifi|report|prolong|mise [àa] jour|version|dce|document/i.test(msg.sujet)?"Rectificatif":"Message de la plateforme";
      const nl=nouvelleDateDansTexte(msg.texte,m.limite);
      const date=changerLimite(m,nl,"mail du "+(msg.date?new Date(msg.date).toLocaleDateString("fr-FR"):"jour"));
      if(ajouterChangement(m,{cle:"mail:"+(msg.id||msg.sujet+msg.date),type,texte:[date,"« "+msg.sujet+" »",(msg.texte||"").slice(0,280)].filter(Boolean).join(" · "),lien:(msg.liens||[]).find(l=>/consultation|refConsultation|id=/i.test(l))||lienMarche(m),date:msg.date||null})) n++;
    }
  }
  if(n){ sauverRectif(); afficherModifs(); notifierModifs(); rafraichirApresModifs(); }
  return n;
}
function rafraichirApresModifs(){
  document.querySelectorAll(".carte[data-id]").forEach(c=>{ const id=c.dataset.id; const m=manuels[id]||(statuts[id]&&statuts[id].m); if(m&&rectif.par[id]) c.replaceWith(carte(m)); });
  afficherRappels();
}
function notifierModifs(){
  const nonNotifies=[];
  for(const [id,r] of Object.entries(rectif.par)) for(const c of r.changements||[]) if(!c.lu&&!c.notifie){ c.notifie=true; nonNotifies.push(c); }
  if(!nonNotifies.length) return;
  sauverRectif();
  notifier("Vigie · "+(nonNotifies.length>1?nonNotifies.length+" modifications":nonNotifies[0].type)+" sur vos marchés",nonNotifies.slice(0,3).map(c=>c.objet+" : "+c.type).join("\n"),"vigie-modifs");
}
function afficherModifs(){
  const zone=$("#annModifs"); if(!zone) return;
  const tous=[]; for(const [id,r] of Object.entries(rectif.par)) for(const c of r.changements||[]) if(!c.lu) tous.push({id,c});
  zone.innerHTML=""; zone.className="annonce";
  if(!tous.length){ zone.hidden=true; return; }
  zone.hidden=false;
  tous.sort((a,b)=>(b.c.date||"").localeCompare(a.c.date||""));
  const toutVu=el("button",{class:"mini",type:"button",text:"Tout marquer comme vu"});
  toutVu.onclick=()=>{ tous.forEach(x=>x.c.lu=true); sauverRectif(); afficherModifs(); rafraichirApresModifs(); };
  zone.append(el("h2",{},"⚠ Modifications sur vos marchés suivis ("+tous.length+")",toutVu),
    el("ul",{},tous.map(({id,c})=>{
      const m=manuels[id]||(statuts[id]&&statuts[id].m)||{idweb:id,objet:c.objet};
      const vu=el("button",{class:"mini",type:"button",text:"Vu"}); vu.onclick=()=>{ c.lu=true; sauverRectif(); afficherModifs(); rafraichirApresModifs(); };
      return el("li",{},
        el("span",{class:"quoi",text:c.type}),
        el("button",{class:"lien",type:"button",onclick:()=>montrerCarte(m),text:m.objet||c.objet}),
        el("span",{class:"s",text:c.date?new Date(c.date).toLocaleDateString("fr-FR"):""}),
        c.lien?el("a",{href:c.lien,target:"_blank",rel:"noopener",class:"s",text:"voir"}):null,
        /Date limite/.test(c.texte)&&m.limite?menuAgenda(m,true):null, vu,
        el("p",{class:"detail",text:c.texte}));
    })));
}
async function verifierModifications(force){
  const auj=dateIso(new Date());
  if(!force&&rectif.dernier===auj) return;
  const ms=marchesSuivisOuverts(); if(!ms.length) return;
  rectif.dernier=auj; sauverRectif();
  let n=0;
  try{ n+=await rectifsBoamp(ms); }catch(e){ console.warn("Rectificatifs BOAMP :",e.message); }
  try{ n+=await rectifsPages(ms); }catch(e){ console.warn("Pages des consultations :",e.message); }
  sauverRectif();
  if(n){ afficherModifs(); notifierModifs(); rafraichirApresModifs(); if(!$("#vue-suivi").hidden) afficherSuivi(); }
}
function initModifs(){
  afficherModifs();
  setTimeout(()=>verifierModifications(false),4000);
  setInterval(()=>verifierModifications(false),60*6e4);
  const b=$("#btnModifs"); if(b) b.onclick=async()=>{ b.disabled=true; const t=b.textContent; b.textContent="⏳ Vérification…"; try{ await verifierModifications(true); toast("Vérification terminée"); }finally{ b.disabled=false; b.textContent=t; } };
}
