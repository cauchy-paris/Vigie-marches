/* Vigie Marchés : Affichage des encarts, corps d'état, analyse du RC. */
"use strict";
/* ====================================================================
   Affichage des encarts
   ==================================================================== */
function fmtDate(iso,heure){
  if(!iso) return "";
  const d=new Date(iso); if(isNaN(d)) return iso;
  const opt={day:"2-digit",month:"2-digit",year:"numeric"};
  if(heure&&/T\d\d:\d\d/.test(iso)&&!/T00:00(:00)?/.test(iso)) Object.assign(opt,{hour:"2-digit",minute:"2-digit"});
  return d.toLocaleString("fr-FR",opt).replace(",", " à");
}
function joursRestants(iso){
  if(!iso) return null;
  const d=new Date(iso); if(isNaN(d)) return null;
  const auj=new Date(); auj.setHours(0,0,0,0);
  const c=new Date(d); c.setHours(0,0,0,0);
  return Math.round((c-auj)/86400000);
}
function metiersCpv(cpv){
  const r=new Set();
  for(const c of cpv) for(const m of METIERS) if(m.cpv.some(p=>c.startsWith(p))) r.add(m.nom.split(",")[0]);
  return [...r];
}
function el(tag,attrs={},...enfants){
  const e=document.createElement(tag);
  for(const [k,v] of Object.entries(attrs)){
    if(v==null||v===false) continue;
    if(k==="class") e.className=v; else if(k==="text") e.textContent=v; else if(k.startsWith("on")) e[k]=v; else e.setAttribute(k,v===true?"":v);
  }
  for(const c of enfants.flat()) if(c!=null&&c!==false) e.append(c.nodeType?c:document.createTextNode(String(c)));
  return e;
}

function carte(m){
  const st=statuts[m.idweb]&&statuts[m.idweb].statut;
  const c=el("article",{class:"carte"+(st?" statut-"+st:""),"data-id":m.idweb});
  c._m=m;

  // Badges
  const badges=el("div",{class:"badges"});
  if(m.manuel) badges.append(m.viaMail?el("span",{class:"badge manuel",title:"Ajouté depuis l'alerte « "+(m.viaMail.sujet||"")+" »",text:"Alerte mail"}):el("span",{class:"badge manuel",title:"Ajouté à la main à partir du lien de la consultation",text:"Ajouté par lien"}));
  if(visitePrecedente&&m.parution&&new Date(m.parution)>new Date(visitePrecedente)) badges.append(el("span",{class:"badge nouveau",text:"Nouveau"}));
  { const ch=changementsDe(m.idweb); if(ch.length) badges.append(el("span",{class:"badge modifie",title:ch.map(x=>"• "+x.type+" ("+new Date(x.date).toLocaleDateString("fr-FR")+") : "+x.texte).join("\n"),text:"⚠ "+(ch.some(x=>!x.lu)?"Modifié":"Modifié (vu)")})); }
  m.types.forEach(t=>badges.append(el("span",{class:"badge "+t.toLowerCase(),text:t.charAt(0)+t.slice(1).toLowerCase()})));
  if(m.nature&&m.nature!=="Avis de marché") badges.append(el("span",{class:"badge",text:m.nature}));
  const plat=plateformeDe(m.urlDocs||m.urlDepot||m.urlProfil);
  if(plat) badges.append(el("span",{class:"badge plateforme",title:plat.compte||"",text:"DCE sur "+plat.nom}));
  { const be=badgeEquipe(m); if(be) badges.prepend(be); }
  const pert=notePertinence(m);

  // Échéance
  const j=joursRestants(m.limite);
  const ech=el("div",{class:"echeance"+(j!=null&&j<0?" passe":j!=null&&j<=7?" urgent":"")});
  if(m.limite){
    ech.append(el("div",{class:"j",text:j<0?"Clos":j===0?"Aujourd'hui":"J-"+j}));
    ech.append(el("div",{class:"d",text:"Remise des offres : "+fmtDate(m.limite,true)}));
  }else ech.append(el("div",{class:"d",text:"Date limite non précisée"}));

  c.append(el("div",{class:"carte-tete"},
    el("div",{class:"gauche"},badges,el("h3",{text:m.objet}),el("div",{class:"acheteur",text:m.acheteur})),
    ech));
  { const det=detailPertinence(pert); badges.prepend(badgePertinence(pert,det)); c.append(det); }

  // Infos essentielles
  const infos=el("dl",{class:"infos"});
  const ajout=(lib,val)=>{ if(val) infos.append(el("div",{},el("dt",{text:lib}),el("dd",{text:val}))); };
  ajout("Département",m.deps.map(d=>d+(NOM_DEP[d]?" · "+NOM_DEP[d]:"")).join(", "));
  ajout("Lieu d'exécution",m.lieu);
  ajout("Montant estimé",m.montant);
  ajout("Durée",m.duree);
  ajout("Procédure",m.procedure||m.famille);
  ajout("Lots",m.lots.length?m.lots.length+" lots":"");
  ajout("Publié le",fmtDate(m.parution));
  ajout("Prestations",m.descripteurs.join(", "));
  const ce=corpsEtat(m);
  if(ce.length) infos.append(el("div",{class:"large"},el("dt",{text:"Corps d'état"}),el("dd",{},ce.map(x=>el("span",{class:"metier",text:x})))));
  c.append(infos);

  // Résumé
  if(m.description&&m.description!==m.objet){
    const p=el("p",{class:"resume coupe",text:m.description});
    c.append(p);
    if(m.description.length>260){
      const b=el("button",{class:"lien-plus",type:"button",text:"Lire tout le résumé"});
      b.onclick=()=>{ const ouvert=p.classList.toggle("coupe"); b.textContent=ouvert?"Lire tout le résumé":"Réduire"; };
      c.append(b);
    }
  }
  if(m.lots.length){
    const det=el("details",{},el("summary",{text:"Voir les "+m.lots.length+" lots"}),el("ol",{class:"lots"},m.lots.map(l=>el("li",{text:l}))));
    c.append(det);
  }
  if(m.cpv.length){
    c.append(el("div",{class:"cpv"},el("span",{text:"CPV :"}),m.cpv.slice(0,6).map(x=>el("code",{text:x})),m.cpv.length>6?el("span",{text:"+"+(m.cpv.length-6)}):null));
  }

  // Boutons RC / DCE / statuts
  const cible=m.urlDocs||m.urlDepot||m.urlProfil;
  const direct=u=>u&&/\.(pdf|zip|docx?|rar|7z)(\?|$)/i.test(u);
  let atx=null; for(const u of [cible,...(m.urls||[])]){ atx=atexoLiens(u); if(atx) break; }
  if(!atx) atx=atexoParRecherche(m);
  const lienRC=atx?atx.rc:(cible||m.urlAvis), lienDCE=atx?atx.dceAuto:(cible||m.urlAvis);
  const titreRC=atx?"Téléchargement direct du règlement de consultation, sans compte":cible?(direct(cible)?"Téléchargement direct":"Ouvre la consultation sur "+(plat?plat.nom:"la plateforme")+" : le RC s'y télécharge, seul ou dans le DCE. "+(plat&&plat.compte?plat.compte+".":"")):"Pas de lien de consultation dans l'annonce : ouvre l'avis BOAMP";
  const docs=el("div",{class:"docs"},
    el("a",{class:"btn btn-plein",href:lienRC,target:"_blank",rel:"noopener",title:titreRC},atx?"⬇ Télécharger le RC":"⬇ RC"),
    el("a",{class:"btn btn-rouge",href:lienDCE,target:"_blank",rel:"noopener",onclick:ev=>boutonDce(ev,m,atx,lienDCE),title:atx?"Téléchargement direct du DCE complet (retrait anonyme). Le premier téléchargement de la journée peut prendre jusqu'à une minute.":titreRC.replace("le RC s'y télécharge, seul ou dans le DCE","le DCE s'y télécharge")},atx?"⬇ Télécharger le DCE":"⬇ DCE"),
    atx?el("a",{class:"btn",href:atx.consultation,target:"_blank",rel:"noopener"},"Consultation"):null,
    (m.manuel&&atx&&m.urlAvis===m.urlDocs)?null:el("a",{class:"btn",href:m.urlAvis,target:"_blank",rel:"noopener"},/boamp\.fr/i.test(m.urlAvis||"")?"Avis BOAMP":"Page de la consultation"),
    el("button",{class:"btn",type:"button",title:"Marchés déjà attribués par cet acheteur (DECP)",onclick:()=>historiqueAcheteur(m)},"Historique acheteur"));
  const sts=el("div",{class:"statuts",role:"group","aria-label":"Statut de suivi"});
  for(const [k,lib] of Object.entries(LIB_STATUT)){
    const b=el("button",{type:"button",class:"statut","data-s":k,"aria-pressed":String(st===k),text:lib});
    b.onclick=()=>changerStatut(m,k);
    sts.append(b);
  }
  if(m.manuel){
    docs.append(el("button",{class:"btn",type:"button",title:"Corriger ou compléter les informations de ce marché",onclick:()=>ouvrirAjout(manuels[m.idweb]||m)},"✎ Modifier"));
    if(manuels[m.idweb]) docs.append(el("button",{class:"btn btn-rouge",type:"button",title:"Retirer ce marché de la recherche",onclick:()=>retirerManuel(manuels[m.idweb])},"Retirer"));
  }
  if(st==="reponse") docs.append(boutonDossier(m),boutonOffreDeposee(m));
  { const at=attributionEquipe(m); if(at) docs.append(at); }
  if(st==="reponse") deposeSurCarte(c,m);
  if(m.limite&&joursRestants(m.limite)>=0) docs.append(menuAgenda(m));
  c.append(el("div",{class:"pied"},docs,sts));
  if(st==="reponse"||resultats[m.idweb]) c.append(ligneSuiviOffre(m));
  const panneau=el("div",{class:"ia",hidden:true});
  const bIA=el("button",{class:"plus-ia",type:"button","aria-expanded":"false"},el("span",{class:"fleche",text:"▾"}),"En savoir plus : analyse du règlement de consultation");
  bIA.onclick=()=>{
    const ouvrir=panneau.hidden;
    panneau.hidden=!ouvrir; bIA.setAttribute("aria-expanded",String(ouvrir));
    if(ouvrir&&!panneau.dataset.charge) lancerAnalyse(m,atx,panneau,false);
  };
  c.append(bIA,panneau);
  { const pH=el("div",{class:"ia",hidden:true});
    const bH=el("button",{class:"plus-ia hist",type:"button","aria-expanded":"false"},el("span",{class:"fleche",text:"▾"}),"Qui gagne chez cet acheteur ? Attributions passées et prix pratiqués");
    bH.onclick=()=>{ const o=pH.hidden; pH.hidden=!o; bH.setAttribute("aria-expanded",String(o)); if(o&&!pH.dataset.charge){ pH.dataset.charge="1"; panneauAttributions(m,pH); } };
    c.append(bH,pH); }
  const note = atx
    ? (plat?plat.nom:"Plateforme")+" · RC et DCE en téléchargement direct, sans compte. Le premier DCE de la journée peut mettre jusqu'à une minute à démarrer."
    : cible
    ? (plat? (plat.nom+" · "+(plat.compte||"accès selon la plateforme")) : "Lien de consultation indiqué par l'acheteur")
    : m.manuel ? "Marché ajouté sans lien de consultation."
    : "Aucun lien vers le dossier dans l'annonce : les boutons ouvrent l'avis BOAMP, qui donne le contact de l'acheteur.";
  c.append(el("p",{class:"note-docs"},note+"  ·  ",el("span",{class:"ref",text:(m.manuel&&/^MAN-/.test(m.idweb)?(m.viaMail?"Alerte mail":"Ajouté par lien"):(m.manuel?(m.viaMail?"Alerte mail · ":"Ajouté par lien · "):"")+"Avis n° "+m.idweb)+(m.refAcheteur?" · Réf. "+m.refAcheteur:"")})));
  return c;
}

/* ---------- Corps d'état ---------- */
const sansAccent=t=>(t||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
function corpsEtat(m){
  const r=new Set(metiersCpv(m.cpv||[]));
  const t=" "+sansAccent([m.objet,(m.lots||[]).join(" "),m.description].join(" "))+" ";
  for(const x of METIERS) if(x.termes.some(w=>t.includes(sansAccent(w)))) r.add(x.nom.split(",")[0]);
  return [...r].slice(0,10);
}

/* ---------- Analyse du RC par l'IA (serveur) ---------- */
const CLE_ANALYSES="vigie.analyses.v2";
function avisTexte(m){
  const l=[];
  const a=(k,v)=>{ if(v&&(!Array.isArray(v)||v.length)) l.push(k+" : "+(Array.isArray(v)?v.join(" ; "):v)); };
  a("Objet",m.objet); a("Acheteur",m.acheteur); a("Type de marché",m.types); a("Procédure",m.procedure||m.famille);
  a("Département",m.deps); a("Lieu d'exécution",m.lieu); a("Montant estimé",m.montant); a("Durée",m.duree);
  a("Date limite",m.limite?fmtDate(m.limite,true):""); a("Prestations",m.descripteurs); a("CPV",m.cpv); a("Lots",m.lots);
  a("Description",m.description);
  if(m.brut){
    let d; try{ d=typeof m.brut==="string"?JSON.parse(m.brut):m.brut; }catch(e){}
    if(d){
      const vus=new Set(), f=[];
      parcourir(d,(k,v,ch)=>{ if(v==null||typeof v==="object") return; const t=String(v).trim(); if(t.length<2||/^https?:/.test(t)||vus.has(t)) return; vus.add(t); f.push((ch||k).replace(/\b(cac|cbc|efac|efbc|efext|ext):/g,"").slice(-90)+" = "+t.slice(0,1500)); });
      l.push("\nDonnées détaillées de l'avis :\n"+f.join("\n"));
    }
  }
  return l.join("\n").slice(0,45000);
}
// Appel au serveur (lecture du RC) et mise en cache dans le navigateur
async function obtenirAnalyse(m,atx,forcer,mode){
  const ia=mode==="ia", cleC=(ia?"ia:":"")+m.idweb;
  let q="";
  if(atx&&atx.dceAuto){ try{ q=new URL(atx.dceAuto).search.replace(/^\?/,""); }catch(e){} }
  const rep=await fetch(SERVEUR_DCE+"/analyse?"+(ia?"mode=ia&":"")+q,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({cle:forcer?"":m.idweb,avis:avisTexte(m)})});
  const r=await rep.json().catch(()=>({message:"Réponse illisible du serveur ("+rep.status+")"}));
  if(!rep.ok||!r.ok) throw Object.assign(new Error(r.message||"Erreur "+rep.status),{code:r.erreur});
  const c2=lire(CLE_ANALYSES,{}); delete c2[cleC]; c2[cleC]=r;
  const cles=Object.keys(c2); if(cles.length>150) cles.slice(0,cles.length-150).forEach(k=>delete c2[k]);
  ecrire(CLE_ANALYSES,c2);
  return r;
}
async function lancerAnalyse(m,atx,panneau,forcer,mode){
  const ia=mode==="ia", cleC=(ia?"ia:":"")+m.idweb;
  const cache=lire(CLE_ANALYSES,{});
  if(!forcer&&cache[cleC]){ afficherAnalyse(m,atx,panneau,cache[cleC]); return; }
  panneau.dataset.charge="1";
  panneau.innerHTML="";
  panneau.append(el("div",{class:"ia-attente"},el("span",{class:"rond"}),el("div",{},el("strong",{text:atx?"Téléchargement et lecture du règlement de consultation…":"Lecture de l'avis…"}),el("div",{text:ia?"L'analyse par l'IA prend en général 30 secondes à 2 minutes.":"Quelques secondes, jusqu'à une minute si le serveur était en veille."}))));
  try{
    afficherAnalyse(m,atx,panneau,await obtenirAnalyse(m,atx,forcer,mode));
  }catch(e){
    delete panneau.dataset.charge;
    panneau.innerHTML="";
    const msg=e.code==="cle"?"L'analyse IA n'est pas activée : il faut ajouter la clé ANTHROPIC_API_KEY sur le service vigie-marches-dce dans Render (Environment)."
      :e instanceof TypeError?"Le serveur d'analyse ne répond pas. Réessayez dans une minute (il se réveille après une période d'inactivité).":e.message;
    panneau.append(el("div",{class:"ia-erreur"},el("p",{text:msg}),el("button",{class:"btn",type:"button",onclick:()=>lancerAnalyse(m,atx,panneau,false,mode)},"Réessayer"),ia?el("button",{class:"lien-plus",type:"button",onclick:()=>lancerAnalyse(m,atx,panneau,false)},"Revenir à l'analyse sans IA"):null));
  }
}
function afficherAnalyse(m,atx,panneau,r){
  panneau.dataset.charge="1";
  const s=r.synthese||{};
  panneau.innerHTML="";
  const bloc=(titre,...contenu)=>el("section",{class:"ia-bloc"},el("h4",{text:titre}),...contenu);
  const ul=(l,cls)=>el("ul",{class:cls||""},l.map(x=>el("li",{text:x})));
  if(s.synthese) panneau.append(el("p",{class:"ia-synthese",text:s.synthese}));
  const fiche=el("dl",{class:"ia-fiche"});
  const f=(lib,v,cls)=>{ if(v) fiche.append(el("div",{class:cls||""},el("dt",{text:lib}),el("dd",{text:v}))); };
  f("Type de marché",s.type_marche); f("Procédure",s.procedure);
  f("Montant minimum",s.montant_min,"montant"); f("Montant maximum",s.montant_max,"montant"); f("Montant estimé",s.montant_estime,"montant");
  f("Durée / délais",s.duree); f("Visite",s.visite); f("Date limite",s.date_limite);
  if(fiche.children.length) panneau.append(fiche);
  if((s.criteres||[]).length){
    panneau.append(bloc("Critères de notation",el("table",{class:"ia-criteres"},el("tbody",{},s.criteres.map(c=>el("tr",{},
      el("td",{},el("strong",{text:c.critere}),(c.sous_criteres||[]).length?ul(c.sous_criteres,"sous"):null),
      el("td",{class:"poids",text:c.ponderation||"–"})))))));
  }
  if((s.qualifications||[]).length) panneau.append(bloc("Qualifications demandées",el("div",{class:"ia-qualifs"},s.qualifications.map(x=>el("span",{text:x})))));
  if((s.capacites||[]).length) panneau.append(bloc("Autres conditions de participation",ul(s.capacites)));
  if((s.attendus||[]).length) panneau.append(bloc("Ce qui est attendu",ul(s.attendus)));
  const lots=(s.lots||[]).filter(l=>l.intitule);
  if(lots.length) panneau.append(bloc("Lots",el("ol",{class:"lots"},lots.map(l=>el("li",{},(l.numero?l.numero+" · ":"")+l.intitule,l.montant?el("span",{class:"lot-mt",text:" · "+l.montant}):null)))));
  if((s.corps_etat||[]).length) panneau.append(bloc("Corps d'état",el("div",{},s.corps_etat.map(x=>el("span",{class:"metier",text:x})))));
  if((s.points_attention||[]).length) panneau.append(bloc("Points d'attention",ul(s.points_attention,"attention")));
  const ia=r.mode==="ia";
  if(!ia){
    const manque=[];
    if(!(s.criteres||[]).length) manque.push("critères de notation");
    if(!s.montant_min&&!s.montant_max&&!s.montant_estime) manque.push("montants");
    if(!(s.qualifications||[]).length) manque.push("qualifications");
    if(manque.length) panneau.append(el("p",{class:"ia-source",text:"Non trouvé automatiquement : "+manque.join(", ")+". Consultez le RC pour ces points."}));
  }
  const src=r.source==="rc"?(ia?"Analyse par l'IA du règlement de consultation":"Lecture automatique du règlement de consultation")+(r.fichier?" « "+r.fichier+" »":""):(ia?"Analyse par l'IA de l'avis BOAMP seul":"Lecture automatique de l'avis BOAMP seul")+(r.raisonSansRc?" (RC non lu : "+r.raisonSansRc+")":"");
  let quand=""; try{ quand=" · "+new Date(r.date).toLocaleDateString("fr-FR"); }catch(e){}
  panneau.append(el("p",{class:"ia-source"},(ia?"🤖 ":"⚙ ")+src+quand+". "+(ia?"Synthèse générée par IA":"Extraction par mots-clés")+", à vérifier avant de répondre.  ",
    r.lienRc?el("a",{href:r.lienRc,target:"_blank",rel:"noopener"},"Ouvrir le RC"):null, r.lienRc?" · ":null,
    el("button",{class:"lien-plus",type:"button",onclick:()=>lancerAnalyse(m,atx,panneau,true,r.mode)},"Relancer"),
    !ia&&r.ia?" · ":null, !ia&&r.ia?el("button",{class:"lien-plus",type:"button",onclick:()=>lancerAnalyse(m,atx,panneau,false,"ia")},"Approfondir avec l'IA"):null,
    ia?" · ":null, ia?el("button",{class:"lien-plus",type:"button",onclick:()=>lancerAnalyse(m,atx,panneau,false)},"Voir la lecture sans IA"):null));
}
