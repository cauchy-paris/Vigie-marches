/* Vigie Marchés : Rappels J-7 / J-2 et agenda. */
"use strict";
/* ====================================================================
   Rappels J-7 / J-2 et agenda (Outlook, Google, fichier .ics)
   - les marchés « En réflexion » et « J'y réponds » dont la remise des offres approche
     s'affichent en haut de la page, et donnent une notification du navigateur si elle est permise ;
   - « 📅 Agenda » ajoute la date limite au calendrier. Le .ics porte les alertes J-7, J-2 et H-2,
     donc l'agenda prévient même quand Vigie est fermé.
   ==================================================================== */
const CLE_RAPPELS="vigie.rappels.v1";
const STATUTS_RAPPEL=["reflexion","reponse"];
const SEUILS_RAPPEL=[7,2,0];
function suivisARappeler(){
  return Object.values(statuts).filter(s=>STATUTS_RAPPEL.includes(s.statut)&&s.m&&s.m.limite)
    .map(s=>({m:manuels[s.m.idweb]||s.m,statut:s.statut,j:joursRestants((manuels[s.m.idweb]||s.m).limite)}))
    .filter(x=>x.j!=null&&x.j>=0&&x.j<=7).sort((a,b)=>a.m.limite.localeCompare(b.m.limite));
}
function libJ(j){ return j===0?"Aujourd'hui":j===1?"Demain":"J-"+j; }
function sansHeure(iso){ return !/T\d\d:\d\d/.test(iso||"")||/T00:00(:00)?(\.000)?(Z|[+-]00:?00)?$/.test(iso); }
function montrerCarte(m){
  // ouvre l'onglet Mes marchés si le marché y est, et met l'encart en évidence
  const viser=()=>document.querySelector('#'+(statuts[m.idweb]?"listeSuivi":"liste")+' .carte[data-id="'+CSS.escape(m.idweb)+'"]')||document.querySelector('.carte[data-id="'+CSS.escape(m.idweb)+'"]');
  if(statuts[m.idweb]){ filtreSuivi=""; changerVue("suivi"); afficherSuivi(); }
  const c=viser(); if(!c){ toast("Marché introuvable dans la liste affichée"); return; }
  c.scrollIntoView({behavior:"smooth",block:"center"}); c.classList.add("eclaire"); setTimeout(()=>c.classList.remove("eclaire"),2500);
}
function afficherRappels(){
  const zone=$("#annRappels"); if(!zone) return;
  const memo=lire(CLE_RAPPELS,{ferme:null,envoyes:{}});
  const liste=suivisARappeler();
  zone.innerHTML=""; zone.className="annonce";
  if(!liste.length||memo.ferme===dateIso(new Date())){ zone.hidden=true; return; }
  zone.hidden=false;
  const fermer=el("button",{class:"fermer",type:"button",title:"Masquer jusqu'à demain","aria-label":"Masquer jusqu'à demain",text:"×"});
  fermer.onclick=()=>{ const x=lire(CLE_RAPPELS,{envoyes:{}}); x.ferme=dateIso(new Date()); ecrire(CLE_RAPPELS,x); zone.hidden=true; };
  zone.append(el("h2",{},"⏰ Remise des offres dans moins de 8 jours ("+liste.length+")",fermer),
    el("ul",{},liste.map(({m,statut,j})=>el("li",{},
      el("span",{class:"jj"+(j<=2?" vite":""),text:libJ(j)}),
      el("button",{class:"lien",type:"button",onclick:()=>montrerCarte(m),text:m.objet}),
      el("span",{class:"s",text:[m.acheteur,LIB_STATUT[statut],"remise "+fmtDate(m.limite,true)].filter(Boolean).join(" · ")}),
      menuAgenda(m,true)))));
}
function notifier(titre,corps,tag,surClic){
  try{
    if(!("Notification" in window)||Notification.permission!=="granted") return false;
    const n=new Notification(titre,{body:corps,tag,icon:"extension/icone128.png"});
    n.onclick=()=>{ window.focus(); if(surClic) surClic(); n.close(); };
    return true;
  }catch(e){ return false; }
}
function verifierRappels(){
  afficherRappels();
  const memo=lire(CLE_RAPPELS,{ferme:null,envoyes:{}}); memo.envoyes=memo.envoyes||{};
  let chg=false;
  for(const {m,j} of suivisARappeler()){
    const seuil=SEUILS_RAPPEL.find(x=>j<=x&&(SEUILS_RAPPEL[SEUILS_RAPPEL.indexOf(x)+1]??-1)<j); // 7 (J-7..J-3), 2 (J-2, J-1), 0 (jour J)
    const cle=m.idweb+"|"+m.limite+"|"+seuil;
    if(memo.envoyes[cle]) continue;
    if(notifier("Vigie · "+libJ(j)+" : remise des offres",m.objet+"\n"+(m.acheteur||"")+" · "+fmtDate(m.limite,true),"vigie-"+m.idweb,()=>montrerCarte(m))){ memo.envoyes[cle]=dateIso(new Date()); chg=true; }
  }
  // ménage : on oublie les rappels de plus de 60 jours
  const limiteMenage=dateIso(new Date(Date.now()-60*864e5));
  for(const [k,d] of Object.entries(memo.envoyes)) if(d<limiteMenage){ delete memo.envoyes[k]; chg=true; }
  if(chg) ecrire(CLE_RAPPELS,memo);
}
function majNotif(){
  const b=$("#btnNotif"), e=$("#notifEtat"); if(!b) return;
  if(!("Notification" in window)){ b.disabled=true; e.textContent="Ce navigateur ne gère pas les notifications : fiez-vous aux alertes de l'agenda."; return; }
  const p=Notification.permission;
  b.disabled=p!=="default";
  b.textContent=p==="granted"?"🔔 Notifications activées":"🔔 Activer les notifications";
  e.textContent=p==="granted"?"Vous recevrez une notification à J-7, J-2 et le jour J, à l'ouverture de Vigie (gardez un onglet Vigie ouvert pour les recevoir dans la journée).":p==="denied"?"Notifications bloquées par le navigateur : autorisez-les dans le cadenas à gauche de l'adresse du site.":"";
}
/* --- agenda --- */
function icsDate(d){ return d.toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,""); }
function icsJour(d){ return dateIso(d).replace(/-/g,""); }
function icsTexte(t){ return String(t||"").replace(/\\/g,"\\\\").replace(/;/g,"\;").replace(/,/g,"\\,").replace(/\r?\n/g,"\\n"); }
function icsPlier(l){ // lignes de 75 octets au plus (RFC 5545)
  const o=[]; let cur="", n=0;
  for(const ch of l){ const b=new TextEncoder().encode(ch).length; if(n+b>(o.length?74:75)){ o.push(cur); cur=""; n=0; } cur+=ch; n+=b; }
  o.push(cur); return o.join("\r\n ");
}
function lienMarche(m){ return m.lienSaisi||m.urlDocs||m.urlDepot||m.urlAvis||m.urlProfil||""; }
function infosEvenement(m){
  const d=new Date(m.limite), jour=sansHeure(m.limite);
  const debut=jour?d:new Date(d.getTime()-36e5), fin=jour?new Date(d.getTime()+864e5):d;
  const titre="Remise des offres : "+m.objet;
  const details=[m.acheteur&&"Acheteur : "+m.acheteur, "Date limite : "+fmtDate(m.limite,true), m.refAcheteur&&"Référence : "+m.refAcheteur, lienMarche(m)&&"Consultation : "+lienMarche(m), "Ajouté depuis Vigie Marchés : "+location.origin+location.pathname].filter(Boolean).join("\n");
  return {debut,fin,jour,titre,details,lieu:m.lieu||m.villeAcheteur||""};
}
function evenementIcs(m){
  const e=infosEvenement(m);
  const l=["BEGIN:VEVENT","UID:vigie-"+String(m.idweb).replace(/[^\w.-]/g,"")+"@vigie-marches","DTSTAMP:"+icsDate(new Date()),
    "SEQUENCE:"+Math.floor(Date.now()/6e4%2e9), // toujours croissant : réimporter met l'événement à jour
    e.jour?"DTSTART;VALUE=DATE:"+icsJour(e.debut):"DTSTART:"+icsDate(e.debut),
    e.jour?"DTEND;VALUE=DATE:"+icsJour(e.fin):"DTEND:"+icsDate(e.fin),
    "SUMMARY:"+icsTexte(e.titre),"DESCRIPTION:"+icsTexte(e.details)];
  if(e.lieu) l.push("LOCATION:"+icsTexte(e.lieu));
  if(lienMarche(m)) l.push("URL:"+lienMarche(m));
  l.push("TRANSP:TRANSPARENT","CATEGORIES:Appels d'offres");
  for(const [avant,lib] of [["-P7D","J-7"],["-P2D","J-2"],[e.jour?"-PT0M":"-PT2H",e.jour?"jour J":"dans 2 heures"]])
    l.push("BEGIN:VALARM","ACTION:DISPLAY","TRIGGER:"+avant,"DESCRIPTION:"+icsTexte(lib+" : remise des offres « "+m.objet+" »"),"END:VALARM");
  l.push("END:VEVENT");
  return l;
}
function fichierIcs(marches,nom){
  const l=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Vigie Marches//Rappels//FR","CALSCALE:GREGORIAN","METHOD:PUBLISH","X-WR-CALNAME:Appels d'offres (Vigie)"];
  marches.forEach(m=>l.push(...evenementIcs(m)));
  l.push("END:VCALENDAR");
  const blob=new Blob([l.map(icsPlier).join("\r\n")+"\r\n"],{type:"text/calendar;charset=utf-8"});
  const a=el("a",{href:URL.createObjectURL(blob),download:nom}); document.body.append(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),5000);
}
function nomIcs(m){ return ("remise-offres-"+designation(m.objet||"marche")).normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^\w-]+/g,"-").replace(/-+/g,"-").slice(0,60)+".ics"; }
function lienGoogle(m){
  const e=infosEvenement(m);
  const dates=e.jour?icsJour(e.debut)+"/"+icsJour(e.fin):icsDate(e.debut)+"/"+icsDate(e.fin);
  return "https://calendar.google.com/calendar/render?"+new URLSearchParams({action:"TEMPLATE",text:e.titre,dates,details:e.details,location:e.lieu,ctz:"Europe/Paris"});
}
function lienOutlook(m,perso){
  const e=infosEvenement(m);
  const p={path:"/calendar/action/compose",rru:"addevent",subject:e.titre,body:e.details.replace(/\n/g,"<br>"),location:e.lieu,startdt:e.jour?dateIso(e.debut):e.debut.toISOString(),enddt:e.jour?dateIso(e.fin):e.fin.toISOString()};
  if(e.jour) p.allday="true";
  return "https://outlook."+(perso?"live.com":"office.com")+"/calendar/0/deeplink/compose?"+new URLSearchParams(p);
}
function menuAgenda(m,petit){
  const d=el("details",{class:"menu-agenda"});
  const ic=el("button",{type:"button",onclick:()=>{ fichierIcs([m],nomIcs(m)); d.open=false; toast("Ouvrez le fichier .ics téléchargé pour l'ajouter à l'agenda"); }},"Fichier .ics (Outlook, Apple, autres)",el("small",{text:"avec alertes J-7, J-2 et 2 h avant"}));
  const lien=(href,lib,aide)=>el("a",{href,target:"_blank",rel:"noopener",onclick:()=>{ d.open=false; }},lib,aide?el("small",{text:aide}):null);
  d.append(el("summary",{class:"btn",style:petit?"padding:2px 8px;font-size:12px":"",title:"Ajouter la date limite à votre agenda"},"📅 Agenda"),
    el("div",{class:"pop"},
      ic,
      lien(lienOutlook(m,false),"Outlook (Microsoft 365, pro)","ajoutez vous-même le rappel"),
      lien(lienOutlook(m,true),"Outlook.com / Hotmail (perso)"),
      lien(lienGoogle(m),"Google Agenda","ajoutez vous-même le rappel")));
  d.addEventListener("toggle",()=>{ if(d.open) document.querySelectorAll(".menu-agenda[open]").forEach(x=>{ if(x!==d) x.open=false; }); });
  return d;
}
document.addEventListener("click",e=>{ if(!e.target.closest(".menu-agenda")) document.querySelectorAll(".menu-agenda[open]").forEach(x=>x.open=false); });
function icsTousMesMarches(){
  const ms=Object.values(statuts).filter(s=>STATUTS_RAPPEL.includes(s.statut)&&s.m&&s.m.limite&&joursRestants(s.m.limite)>=0).map(s=>manuels[s.m.idweb]||s.m);
  if(!ms.length){ toast("Aucun marché « En réflexion » ou « J'y réponds » avec une date limite à venir"); return; }
  fichierIcs(ms,"vigie-mes-marches-"+dateIso(new Date())+".ics");
  toast(ms.length+" marché"+(ms.length>1?"s":"")+" : ouvrez le fichier .ics pour les ajouter à l'agenda");
}
function initRappels(){
  const bn=$("#btnNotif"); if(bn) bn.onclick=async()=>{ try{ await Notification.requestPermission(); }catch(e){} majNotif(); verifierRappels(); };
  const bi=$("#btnIcsTous"); if(bi) bi.onclick=icsTousMesMarches;
  majNotif(); verifierRappels();
  setInterval(verifierRappels,36e5); // un onglet resté ouvert prévient aussi dans la journée
}
