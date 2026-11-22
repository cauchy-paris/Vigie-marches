/* Vigie Marchés : Import des alertes mail des plateformes. */
"use strict";
/* ====================================================================
   Import des alertes mail des plateformes
   - Outlook / Microsoft 365 : lecture de la boîte via Microsoft Graph (droit Mail.Read),
     directement depuis le navigateur : les mails ne passent pas par le serveur Vigie.
   - Toute autre messagerie (Gmail…) : copier-coller du mail ou dépôt du fichier .eml.
   Seuls les liens des consultations retenus sont ensuite lus (BOAMP, puis serveur Vigie).
   ==================================================================== */
const CLE_MAIL="vigie.mail.v1";
const MAIL_SCOPES=["Mail.Read"];
// expéditeurs connus des alertes (domaine de l'adresse)
const EXPEDITEURS_ALERTES=/(^|[@.])(boamp\.fr|dila\.gouv\.fr|marches-publics\.gouv\.fr|maximilien\.fr|aws-france\.com|aws-achat\.com|marches-publics\.info|achatsolutions\.fr|achatpublic\.com|achatpublic\.info|e-marchespublics\.com|marchesonline\.com|francemarches\.com|klekoon\.com|marches-securises\.fr|megalis\.bretagne\.bzh|local-trust\.com|atexo\.com|ted\.europa\.eu)$/i;
// échanges sur une consultation (pas des alertes) : questions, compléments, rejets…
// messages des plateformes sur une consultation suivie (questions-réponses, rectificatifs, report de date) : même règle que server/mail.js
const SUJETS_MODIF=/question|r[ée]ponse|rectifi|modifi|report|prolong|compl[ée]ment d.information|information compl|mise [àa] jour|nouvelle version|nouveau document|dce|avis d.annulation|annul|message|courrier|correspondance/i;
const SUJETS_HORS_MODIF=/non retenu|rejet|attribution|notification du march|accus[ée] de r[ée]ception|d[ée]p[ôo]t (de|du|d.une)|mot de passe|identifiant|confirmation d.inscription|n[ée]gociation|invitation/i;
const SUJETS_ALERTE=/alerte|veille|nouvelle?s? (?:consultation|annonce|avis)|avis (?:de march[ée]|d.appel)|appels? d.offres/i;
function estMessageSuivi(adr,sujet){ return EXPEDITEURS_ALERTES.test(String(adr||"").toLowerCase().split("@")[1]||"")&&SUJETS_MODIF.test(sujet||"")&&!SUJETS_HORS_MODIF.test(sujet||"")&&!SUJETS_ALERTE.test(sujet||""); }
const SUJETS_ECHANGES=/non retenu|compl[ée]ment|notification|courrier aws|question|r[ée]ponse [àa]|rejet|attribution|n[ée]gociation|invitation|accus[ée] de r[ée]ception|d[ée]p[ôo]t|mot de passe|identifiant|compte|confirmation d.inscription/i;
const LIBELLES_GENERIQUES=/^(voir|consulter|acc[ée]der|cliquez|ici|d[ée]tails?|en savoir plus|lien|t[ée]l[ée]charger|dce|r[èe]glement|voir l.avis|voir la consultation|plus d.informations?|https?:)/i;

function pfDeLien(u){
  const h=u.hostname.replace(/^www\./i,"").toLowerCase(), chemin=u.pathname+u.search;
  if(/(^|\.)boamp\.fr$/.test(h)){ const id=(decodeURIComponent(chemin).match(/(?:^|[^\d])(\d{2}-\d{4,7})(?!\d)/)||[])[1]; return id?{pf:"BOAMP",cle:"boamp:"+id,url:"https://www.boamp.fr/pages/avis/?q=idweb:%22"+id+"%22"}:null; }
  const nom=/marches-publics\.gouv\.fr$/.test(h)?"PLACE":/maximilien\.fr$/.test(h)?"Maximilien":/marches-publics\.info$|aws-/.test(h)?"AWS-Achat":/achatpublic/.test(h)?"achatpublic":/e-marchespublics/.test(h)?"e-marchespublics":null;
  // Atexo (PLACE, Maximilien et plateformes régionales)
  let x=chemin.match(/\/(?:entreprise\/)?consultation\/(\d{4,})/i);
  if(x) return {pf:nom||"Atexo",cle:h+":"+x[1]+":"+(u.searchParams.get("orgAcronyme")||""),url:u.href};
  if(/EntrepriseDetailsConsultation|EntrepriseDetailConsultation/i.test(chemin)){
    const id=u.searchParams.get("refConsultation")||u.searchParams.get("id"); if(id) return {pf:nom||"Atexo",cle:h+":"+id+":"+(u.searchParams.get("orgAcronyme")||""),url:u.href};
  }
  // AWS-Achat
  x=chemin.match(/AAPC_(\d+)/i)||chemin.match(/[?&]IDM=(\d+)/i);
  if(x&&(nom==="AWS-Achat"||/AAPC_/i.test(chemin))) return {pf:"AWS-Achat",cle:"aws:"+x[1],url:u.href};
  // achatpublic
  x=chemin.match(/PCSLID=([\w-]+)/i);
  if(x) return {pf:"achatpublic",cle:"ap:"+x[1],url:u.href};
  // e-marchespublics
  if(nom==="e-marchespublics"){ x=u.pathname.match(/(\d{5,})/); if(x&&!/desinscri|unsubscribe/i.test(chemin)) return {pf:nom,cle:"emp:"+x[1],url:u.href}; }
  // autre plateforme connue : page avec un numéro distinctif
  if(nom&&/\d{5,}/.test(chemin)&&!/desinscri|unsubscribe|logo|image|compte|login|connexion|alerte/i.test(chemin)) return {pf:nom,cle:h+u.pathname+u.search,url:u.href};
  return null;
}
// liens de suivi (redirections) et liens « sécurisés » Outlook : on retrouve l'adresse d'origine
function deballerLien(href){
  let u; try{ u=new URL(href); }catch(e){ return null; }
  for(let i=0;i<3;i++){
    let suivant=null;
    u.searchParams.forEach(v=>{ if(!suivant&&/^https?:\/\//i.test(v)){ try{ suivant=new URL(v); }catch(e){} } });
    if(!suivant||(pfDeLien(u)&&!pfDeLien(suivant))) break; u=suivant;
  }
  return /^https?:$/.test(u.protocol)?u:null;
}
// texte d'un nœud avec ses retours à la ligne (le document lu n'est pas affiché : innerText n'en met pas)
const BLOCS_TEXTE=/^(P|DIV|TR|LI|TABLE|TBODY|H[1-6]|UL|OL|SECTION|ARTICLE|HEADER|FOOTER|BLOCKQUOTE|DD|DT|DL)$/;
function texteDe(n){
  if(!n) return "";
  let t="";
  (function parcourir(x){
    for(const c of x.childNodes){
      if(c.nodeType===3) t+=c.nodeValue.replace(/\s+/g," ");
      else if(c.nodeType===1){
        if(c.tagName==="BR"){ t+="\n"; continue; }
        if(/^(SCRIPT|STYLE|HEAD)$/.test(c.tagName)) continue;
        const bloc=BLOCS_TEXTE.test(c.tagName); if(bloc) t+="\n";
        parcourir(c);
        if(bloc) t+="\n"; else if(c.tagName==="TD"||c.tagName==="TH") t+=" ";
      }
    }
  })(n.nodeType===1&&!n.childNodes.length?{childNodes:[]}:n);
  return t.replace(/\u00a0/g," ").replace(/[ \t]+/g," ").replace(/ *\n */g,"\n").replace(/\n{2,}/g,"\n").trim();
}
function champMail(bloc,libs){
  const r=new RegExp("(?:^|\\n|\\s)(?:"+libs+")\\s*[:：]\\s*([^\\n]{3,250})","i").exec(bloc); return r?r[1].trim():"";
}
function dateMail(bloc){
  const r=/(?:date (?:et heure )?limite|remise des (?:offres|plis)|r[ée]ception des (?:offres|plis)|cl[ôo]ture|limite de r[ée]ponse)[^\n\d]{0,60}(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:[^\n\d]{0,12}(\d{1,2})\s*[h:]\s*(\d{2})?)?/i.exec(bloc);
  if(!r) return null;
  const an=r[3].length===2?"20"+r[3]:r[3];
  return parisVersIso(an+"-"+r[2].padStart(2,"0")+"-"+r[1].padStart(2,"0")+"T"+String(r[4]||"12").padStart(2,"0")+":"+(r[5]||"00"));
}
// Un mail (HTML ou texte) -> consultations trouvées
function consultationsDuMail(mail){
  const doc=mail.html?new DOMParser().parseFromString(mail.html,"text/html"):null;
  const res=new Map();
  const liens=[];
  if(doc){
    doc.querySelectorAll("script,style,head").forEach(n=>n.remove());
    doc.querySelectorAll("a[href]").forEach(a=>{ const u=deballerLien(a.getAttribute("href")); const c=u&&pfDeLien(u); if(c) liens.push({a,c}); });
  }else{
    (mail.texte||"").replace(/https?:\/\/[^\s<>"')\]]+/g,href=>{ const u=deballerLien(href.replace(/[.,;]+$/,"")); const c=u&&pfDeLien(u); if(c) liens.push({a:null,c,href}); return href; });
  }
  const tousTextes=doc?texteDe(doc.body):(mail.texte||"");
  const plusieurs=new Set(liens.map(l=>l.c.cle)).size>1;
  for(const {a,c} of liens){
    if(res.has(c.cle)){ const r=res.get(c.cle); if(a&&!r.titreLien){ const t=texteDe(a); if(t.length>=12&&!LIBELLES_GENERIQUES.test(t)) r.titre=r.titreLien=t; } continue; }
    let bloc="";
    if(a){
      // plus grand bloc qui ne contient que cette consultation
      let n=a;
      while(n.parentElement&&n!==doc.body){
        const p=n.parentElement;
        const autres=liens.some(l=>l.c.cle!==c.cle&&l.a&&p.contains(l.a));
        if(autres) break; n=p;
      }
      bloc=texteDe(n);
    }else bloc=tousTextes;
    if(bloc.length>3000) bloc=bloc.slice(0,3000);
    const tl=a?texteDe(a):"";
    let titre=tl.length>=12&&!LIBELLES_GENERIQUES.test(tl)?tl:"";
    titre=titre||champMail(bloc,"objet|intitul[ée]|objet du march[ée]|titre|libell[ée]");
    if(!titre&&!plusieurs) titre=(mail.sujet||"").replace(/^(tr|fw|fwd|re)\s*:\s*/i,"");
    if(!titre) titre=(bloc.split("\n").find(l=>l.length>=20&&!/^https?:/i.test(l))||"").slice(0,200);
    res.set(c.cle,{...c,titre:titre.slice(0,300),titreLien:titre===tl?tl:"",
      acheteur:champMail(bloc,"acheteur|organisme|entit[ée] (?:publique|adjudicatrice)|pouvoir adjudicateur|nom de l.acheteur|ma[îi]tre d.ouvrage|collectivit[ée]").slice(0,200),
      limite:dateMail(bloc),
      reference:champMail(bloc,"r[ée]f[ée]rence|r[ée]f\\.|n° de la consultation").slice(0,80),
      mail:{id:mail.id||"",sujet:mail.sujet||"",de:mail.de||"",nomDe:mail.nomDe||"",date:mail.date||""}});
  }
  // BOAMP : numéros d'avis cités sans lien (« Avis n° 26-123456 »)
  if(/boamp|dila/i.test(mail.de||"")||/boamp/i.test(tousTextes.slice(0,500))){
    for(const x of tousTextes.matchAll(/avis\s*(?:n°|no|num[ée]ro)?\s*:?\s*(\d{2}-\d{4,7})(?!\d)/gi)){
      const cle="boamp:"+x[1]; if(res.has(cle)) continue;
      res.set(cle,{pf:"BOAMP",cle,url:"https://www.boamp.fr/pages/avis/?q=idweb:%22"+x[1]+"%22",titre:"",acheteur:"",limite:null,reference:"",mail:{id:mail.id||"",sujet:mail.sujet||"",de:mail.de||"",nomDe:mail.nomDe||"",date:mail.date||""}});
    }
  }
  return [...res.values()];
}

/* --- lecture d'un fichier .eml (MIME) --- */
function decoderMot(s){
  return (s||"").replace(/\?=\s+=\?/g,"?==?").replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,(_,cs,enc,t)=>{
    try{
      const oct=enc.toLowerCase()==="b"?Uint8Array.from(atob(t),c=>c.charCodeAt(0)):Uint8Array.from(t.replace(/_/g," ").replace(/=([0-9a-f]{2})/gi,(m,h)=>String.fromCharCode(parseInt(h,16))),c=>c.charCodeAt(0));
      return new TextDecoder(cs).decode(oct);
    }catch(e){ return t; }
  });
}
function lireEml(brut){
  const parties={html:"",texte:""};
  const entetes=t=>{ const o={}; t.replace(/\r?\n[ \t]+/g," ").split(/\r?\n/).forEach(l=>{ const i=l.indexOf(":"); if(i>0) o[l.slice(0,i).trim().toLowerCase()]=l.slice(i+1).trim(); }); return o; };
  function partie(t){
    const i=t.search(/\r?\n\r?\n/); if(i<0) return {h:{},corps:t};
    return {h:entetes(t.slice(0,i)),corps:t.slice(i).replace(/^\r?\n\r?\n/,"")};
  }
  function corpsDecode(h,corps){
    const enc=(h["content-transfer-encoding"]||"").toLowerCase(), cs=((h["content-type"]||"").match(/charset="?([^";]+)/i)||[])[1]||"utf-8";
    let oct;
    if(enc==="base64"){ try{ oct=Uint8Array.from(atob(corps.replace(/\s+/g,"")),c=>c.charCodeAt(0)); }catch(e){ return ""; } }
    else if(enc==="quoted-printable"){ const s=corps.replace(/=\r?\n/g,"").replace(/=([0-9A-F]{2})/gi,(m,x)=>String.fromCharCode(parseInt(x,16))); oct=Uint8Array.from(s,c=>c.charCodeAt(0)&255); }
    else oct=Uint8Array.from(corps,c=>c.charCodeAt(0)&255);
    try{ return new TextDecoder(cs).decode(oct); }catch(e){ return new TextDecoder("utf-8").decode(oct); }
  }
  function parcourir(t,prof){
    const {h,corps}=partie(t); const ct=(h["content-type"]||"text/plain").toLowerCase();
    if(ct.startsWith("multipart/")&&prof<6){
      const b=(h["content-type"].match(/boundary="?([^";]+)"?/i)||[])[1]; if(!b) return h;
      corps.split("--"+b).slice(1).forEach(p=>{ if(!/^--/.test(p)) parcourir(p.replace(/^\r?\n/,""),prof+1); });
    }else if(ct.startsWith("text/html")&&!parties.html) parties.html=corpsDecode(h,corps);
    else if(ct.startsWith("text/plain")&&!parties.texte) parties.texte=corpsDecode(h,corps);
    else if(ct.startsWith("message/rfc822")&&prof<6) parcourir(corps,prof+1);
    return h;
  }
  const h=parcourir(brut,0);
  const de=decoderMot(h.from||""), adr=(de.match(/<([^>]+)>/)||[,de])[1].trim();
  let date=""; try{ date=h.date?new Date(h.date).toISOString():""; }catch(e){}
  return {sujet:decoderMot(h.subject||""),de:adr,nomDe:de.replace(/<[^>]*>/,"").replace(/"/g,"").trim(),date,html:parties.html,texte:parties.texte};
}

/* --- Outlook / Microsoft 365 via Graph --- */
async function alertesOutlook(depuisIso,etat,silencieux){
  if(silencieux){ await msInit().catch(()=>null); if(!msCompte()) return null; }
  else if(!msCompte()&&!await msConnecter([...MS_SCOPES,...MAIL_SCOPES])) return null;
  const jeton=await msJeton(!silencieux,MAIL_SCOPES); if(!jeton) return null;
  const H={Authorization:"Bearer "+jeton};
  const G="https://graph.microsoft.com/v1.0/me/messages";
  let url=G+"?"+new URLSearchParams({"$filter":"receivedDateTime ge "+depuisIso,"$orderby":"receivedDateTime desc","$select":"id,subject,from,receivedDateTime","$top":"100"});
  const retenus=[], suivisMsg=[]; let lus=0, echanges=0;
  for(let page=0;url&&page<15;page++){
    const r=await fetch(url,{headers:H}); const j=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error("Lecture de la boîte impossible : "+((j.error&&j.error.message)||r.status));
    for(const m of j.value||[]){
      lus++;
      const adr=((m.from&&m.from.emailAddress&&m.from.emailAddress.address)||"").toLowerCase();
      if(estMessageSuivi(adr,m.subject)){ suivisMsg.push(m); continue; }
      const alerteParSujet=/alerte|veille|nouvelle?s? (?:consultation|annonce|avis)|avis (?:de march[ée]|d.appel)|appels? d.offres/i.test(m.subject||"");
      if(!EXPEDITEURS_ALERTES.test(adr.split("@")[1]||"")&&!alerteParSujet) continue;
      if(SUJETS_ECHANGES.test(m.subject||"")&&!/alerte|veille/i.test(m.subject||"")){ echanges++; continue; }
      retenus.push(m);
    }
    etat("⏳ "+lus+" mails parcourus, "+retenus.length+" alertes possibles…");
    url=j["@odata.nextLink"]||null;
  }
  const mails=[];
  for(const [i,m] of retenus.slice(0,200).entries()){
    etat("⏳ Lecture des alertes : "+(i+1)+" / "+Math.min(retenus.length,200)+"…");
    const r=await fetch(G+"/"+encodeURIComponent(m.id)+"?$select=id,subject,from,receivedDateTime,body",{headers:{...H,Prefer:'outlook.body-content-type="html"'}});
    if(!r.ok) continue;
    const j=await r.json().catch(()=>null); if(!j) continue;
    const ea=(j.from&&j.from.emailAddress)||{};
    mails.push({id:j.id,sujet:j.subject||"",de:ea.address||"",nomDe:ea.name||"",date:j.receivedDateTime||"",html:j.body&&j.body.contentType==="html"?j.body.content:"",texte:j.body&&j.body.contentType!=="html"?j.body.content:""});
  }
  const messages=[];
  for(const m of suivisMsg.slice(0,40)){
    const r=await fetch(G+"/"+encodeURIComponent(m.id)+"?$select=id,subject,from,receivedDateTime,body",{headers:{...H,Prefer:'outlook.body-content-type="html"'}});
    if(!r.ok) continue;
    const j=await r.json().catch(()=>null); if(!j) continue;
    const ea=(j.from&&j.from.emailAddress)||{};
    messages.push(messageSimple({id:j.id,sujet:j.subject||"",de:ea.address||"",nomDe:ea.name||"",date:j.receivedDateTime||"",html:j.body&&j.body.contentType==="html"?j.body.content:"",texte:j.body&&j.body.contentType!=="html"?j.body.content:""}));
  }
  return {mails,messages,lus,echanges};
}
function messageSimple(m){ // texte et liens d'un message de plateforme
  if(!m.html) return {...m,texte:String(m.texte||"").replace(/\s+/g," ").slice(0,4000),liens:[...(String(m.texte||"").match(/https?:\/\/[^\s<>"')\]]+/g)||[])].slice(0,30)};
  const doc=new DOMParser().parseFromString(m.html,"text/html"); doc.querySelectorAll("script,style,head").forEach(n=>n.remove());
  return {id:m.id,sujet:m.sujet,de:m.de,nomDe:m.nomDe,date:m.date,texte:texteDe(doc.body).replace(/\s+/g," ").slice(0,4000),liens:[...doc.querySelectorAll("a[href]")].map(a=>deballerLien(a.getAttribute("href"))).filter(Boolean).map(u=>String(u.href||u)).slice(0,30)};
}

/* --- autres messageries (IMAP) : Gmail, OVH, Orange, Free, Yahoo, iCloud… ---
   Lecture faite par le serveur Vigie, qui ne garde rien. Le mot de passe reste dans ce navigateur
   (seulement si « se souvenir » est coché). */
const CLE_IMAP="vigie.imap.v1";
const MESSAGERIES=[
  ["gmail","Gmail","imap.gmail.com",/@(gmail|googlemail)\.com$/i],
  ["yahoo","Yahoo","imap.mail.yahoo.com",/@yahoo\./i],
  ["icloud","iCloud","imap.mail.me.com",/@(icloud|me|mac)\.com$/i],
  ["orange","Orange / Wanadoo","imap.orange.fr",/@(orange|wanadoo)\.fr$/i],
  ["free","Free","imap.free.fr",/@free\.fr$/i],
  ["sfr","SFR","imap.sfr.fr",/@(sfr|neuf|cegetel)\.fr$/i],
  ["laposte","La Poste","imap.laposte.net",/@laposte\.net$/i],
  ["ovh","OVH (nom de domaine d'entreprise)","ssl0.ovh.net",null],
  ["ionos","IONOS / 1&1","imap.ionos.fr",null],
  ["autre","Autre (indiquer le serveur IMAP)","",null],
];
async function alertesImap(cfg,depuisIso){
  const rep=await fetch(SERVEUR_DCE+"/mail/imap",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({hote:cfg.hote,port:993,utilisateur:cfg.utilisateur,motdepasse:cfg.motdepasse,motdepasseChiffre:cfg.motdepasse?undefined:cfg.motdepasseChiffre,depuis:depuisIso,messages:true}),signal:AbortSignal.timeout(170000)});
  const j=await rep.json().catch(()=>({ok:false,message:"Réponse illisible du serveur ("+rep.status+")"}));
  if(!j.ok) throw new Error(j.message||"Lecture de la boîte impossible");
  return {mails:j.mails||[],messages:j.messages||[],lus:j.parcourus||0,echanges:j.echanges||0};
}

/* --- ajout automatique d'un marché trouvé dans une alerte --- */
function dejaDansVigie(c){
  const id=c.cle.startsWith("boamp:")?c.cle.slice(6):null;
  if(id&&(manuels[id]||statuts[id])) return true;
  return Object.values(manuels).some(m=>m.lienSaisi===c.url||(m.urls||[]).includes(c.url)||(m.cleMail&&m.cleMail===c.cle));
}
const NOMS_PLATEFORMES=/boamp|place|maximilien|aws|achatpublic|e-marchespublics|marches? ?publics|plateforme|ne ?pas ?r[ée]pondre|no-?reply|alerte|veille|dila/i;
async function ajouterDepuisAlerte(c){
  let base=null, fiche=null;
  const avis=await avisBoampParLien(c.url).catch(()=>null);
  if(avis){
    if(manuels[avis.idweb]||statuts[avis.idweb]) return {deja:true,texte:"Déjà dans Vigie (avis BOAMP n° "+avis.idweb+")"};
    base=avis;
  }else if(c.pf!=="BOAMP"){
    const r=await ficheParServeur(c.url).catch(e=>({ok:false,message:e.name==="TimeoutError"?"Le serveur Vigie ne répond pas.":e.message}));
    if(r.ok) fiche=r.fiche||{};
  }
  const m=base?{...base}:squeletteMarche();
  if(!base){
    const f=fiche||{};
    if(f.cpv) m.cpv=f.cpv;
    const nomExp=c.mail&&c.mail.nomDe&&!NOMS_PLATEFORMES.test(c.mail.nomDe)?c.mail.nomDe:"";
    const dep=String(f.departement||"").match(/^(\d{2,3}|2[ab])\b/i);
    Object.assign(m,{
      objet:f.objet||c.titre||"", acheteur:f.acheteur||c.acheteur||nomExp||"", limite:f.limite||c.limite||null,
      types:f.type?[f.type]:[], deps:dep?[dep[1].toUpperCase()]:[], procedure:normProcedure(f.procedure||""),
      villeAcheteur:f.villeAcheteur||"", lieu:f.lieu||"", refAcheteur:f.reference||c.reference||"", accordCadre:!!f.accordCadre,
      description:(f.description||"").slice(0,1500),
    });
  }
  if(m.limite&&new Date(m.limite)<new Date()) return {expire:true,texte:"Date limite passée ("+new Date(m.limite).toLocaleDateString("fr-FR")+") : non ajouté"};
  const manque=[!m.objet&&"l'intitulé",!m.acheteur&&"l'acheteur",!m.limite&&"la date limite"].filter(Boolean);
  if(!m.objet) m.objet="Consultation "+c.pf+(c.reference?" "+c.reference:"")+" (à compléter)";
  if(!m.acheteur) m.acheteur="Acheteur à compléter";
  Object.assign(m,{manuel:true,lienSaisi:c.url,ajoute:new Date().toISOString(),cleMail:c.cle,viaMail:c.mail?{sujet:c.mail.sujet,de:c.mail.de,date:c.mail.date}:null});
  if(!base&&fiche&&fiche.urlDocs) m.urls=[fiche.urlDocs];
  poserLien(m,c.pf==="BOAMP"&&base?(base.urlAvis||c.url):c.url,base);
  manuels[m.idweb]=m; sauverManuels();
  return {m,manque,source:base?"l'avis BOAMP n° "+base.idweb:fiche?"la page de la consultation":"le mail d'alerte"};
}

function ouvrirImportMail(){
  const memo=lire(CLE_MAIL,{dernier:null,ignores:{}});
  const fermer=()=>{ fond.remove(); document.removeEventListener("keydown",echap); };
  const echap=e=>{ if(e.key==="Escape"&&!occupe) fermer(); };
  let occupe=false, trouves=[];
  const etat=el("p",{class:"pn-etat"});
  const periode=el("select",{},
    memo.dernier?el("option",{value:"dernier",text:"Depuis le dernier import ("+new Date(memo.dernier).toLocaleDateString("fr-FR")+")"}):null,
    el("option",{value:"7",text:"7 derniers jours"}),el("option",{value:"14",text:"14 derniers jours"}),el("option",{value:"30",text:"30 derniers jours"}),el("option",{value:"90",text:"3 derniers mois"}));
  const bOutlook=el("button",{class:"btn btn-plein",type:"button"},"Se connecter et chercher dans Outlook");
  const imap=lire(CLE_IMAP,{type:"gmail",hote:"imap.gmail.com",utilisateur:"",motdepasse:"",souvenir:false});
  const iType=el("select",{},MESSAGERIES.map(([v,n])=>el("option",{value:v,text:n})));
  const iAdr=el("input",{type:"text",placeholder:"adresse mail (ex. prenom.nom@gmail.com)",autocomplete:"username"});
  const iHote=el("input",{type:"text",placeholder:"serveur IMAP (ex. imap.mondomaine.fr)"});
  const iMdp=el("input",{type:"password",placeholder:"mot de passe d'application",autocomplete:"current-password"});
  const iSouv=el("input",{type:"checkbox"});
  const cbAuto=el("input",{type:"checkbox"}); cbAuto.checked=!memo.auto||memo.auto.actif!==false;
  const noteAuto=()=>memo.auto&&memo.auto.actif?"Import automatique actif ("+(memo.auto.source==="outlook"?"Outlook":memo.auto.utilisateur||"IMAP")+")":"";
  const reglerAuto=(source,cfg)=>{ memo.auto=cbAuto.checked?{actif:true,source,utilisateur:cfg&&cfg.utilisateur||""}:{actif:false}; };
  const bImap=el("button",{class:"btn btn-plein",type:"button"},"Chercher dans cette boîte");
  iType.value=imap.type||"gmail"; iAdr.value=imap.utilisateur||""; iHote.value=imap.hote||""; iMdp.value=imap.motdepasse||""; iSouv.checked=!!imap.souvenir;
  // mot de passe enregistré (chiffré) dans le compte Vigie depuis un autre appareil
  const mdpCompte=()=>!iMdp.value&&imap.motdepasseChiffre&&iAdr.value.trim()===imap.utilisateur?imap.motdepasseChiffre:"";
  const majType=()=>{ const d=MESSAGERIES.find(x=>x[0]===iType.value); if(d&&d[2]) iHote.value=d[2]; iHote.hidden=iType.value!=="autre"&&iType.value!=="ovh"&&iType.value!=="ionos"; iMdp.placeholder=iType.value==="gmail"||iType.value==="yahoo"||iType.value==="icloud"?"mot de passe d'application (16 caractères)":"mot de passe de la boîte mail"; };
  iType.onchange=majType;
  iAdr.addEventListener("change",()=>{ const d=MESSAGERIES.find(x=>x[3]&&x[3].test(iAdr.value.trim())); if(d){ iType.value=d[0]; majType(); } });
  majType();
  if(!imap.motdepasse&&imap.motdepasseChiffre) iMdp.placeholder="mot de passe déjà enregistré dans votre compte";
  bImap.onclick=async()=>{
    if(occupe) return;
    const cfg={type:iType.value,hote:iHote.value.trim(),utilisateur:iAdr.value.trim(),motdepasse:iMdp.value,souvenir:iSouv.checked||!!mdpCompte()};
    if(mdpCompte()) cfg.motdepasseChiffre=mdpCompte();
    if(!cfg.utilisateur||(!cfg.motdepasse&&!cfg.motdepasseChiffre)||!cfg.hote){ dire("Indiquez l'adresse, le mot de passe"+(iHote.hidden?"":" et le serveur IMAP")+".","ko"); return; }
    if(cbAuto.checked&&!cfg.souvenir){ dire("Pour l'import automatique de chaque matin, cochez aussi « Se souvenir du mot de passe sur cet appareil » (ou décochez l'import automatique).","ko"); return; }
    ecrire(CLE_IMAP,{...cfg,motdepasse:cfg.souvenir?cfg.motdepasse:""});
    occupe=true; bImap.disabled=true;
    const jours=periode.value==="dernier"?null:+periode.value;
    const depuis=jours?new Date(Date.now()-jours*864e5):new Date(new Date(memo.dernier).getTime()-864e5);
    try{
      dire("⏳ Lecture de la boîte "+cfg.utilisateur+" (jusqu'à deux minutes si le serveur Vigie était en veille)…");
      const r=await alertesImap(cfg,depuis.toISOString());
      memo.dernier=new Date().toISOString(); reglerAuto("imap",cfg); ecrire(CLE_MAIL,memo);
      const nm=traiterMessagesSuivi(r.messages); if(nm) toast(nm+" modification"+(nm>1?"s":"")+" trouvée"+(nm>1?"s":"")+" sur vos marchés suivis");
      ingerer(r.mails,r.lus+" mails parcourus, "+r.mails.length+" alertes"+(r.echanges?", "+r.echanges+" échanges sur vos candidatures ignorés":""));
    }catch(e){ dire(e.name==="TimeoutError"?"La messagerie met trop de temps à répondre : réessayez avec une période plus courte.":e.message,"ko"); }
    finally{ occupe=false; bImap.disabled=false; }
  };
  const zone=el("div",{class:"zone-colle",tabindex:"0",contenteditable:"true",role:"textbox","aria-label":"Collez ici le mail d'alerte"},"Collez ici le mail d'alerte (dans le mail : Ctrl+A puis Ctrl+C), ou déposez des fichiers .eml");
  const fichiers=el("input",{type:"file",accept:".eml,message/rfc822",multiple:true,hidden:true});
  const bFichiers=el("button",{class:"btn",type:"button",onclick:()=>fichiers.click()},"Choisir des fichiers .eml");
  const liste=el("ul",{class:"trouves"});
  const cbTout=el("input",{type:"checkbox"});
  const bTout=el("label",{class:"tout-cocher",hidden:true},cbTout,"Tout sélectionner");
  const bAjout=el("button",{class:"btn btn-plein",type:"button",hidden:true},"Ajouter les marchés cochés");
  const bSuppr=el("button",{class:"btn btn-rouge",type:"button",hidden:true,title:"Retire de la liste les consultations cochées ; elles ne seront plus proposées"},"Supprimer les cochés");
  const dire=(t,cls)=>{ etat.className="pn-etat "+(cls||""); etat.textContent=t; };

  function afficher(){
    liste.innerHTML="";
    trouves.forEach(c=>{
      const deja=dejaDansVigie(c);
      c.coche=c.coche!=null?c.coche:!deja&&!memo.ignores[c.cle];
      const cb=el("input",{type:"checkbox","aria-label":"Ajouter ce marché"}); cb.checked=c.coche&&!deja; cb.disabled=deja; cb.onchange=()=>{ c.coche=cb.checked; compter(); };
      const md=c.mail&&c.mail.date?new Date(c.mail.date).toLocaleDateString("fr-FR"):"";
      const li=el("li",{class:deja?"deja":""},cb,
        el("span",{class:"t"},c.titre||"(intitulé lu sur la page à l'ajout)"),
        el("span",{class:"pf",text:c.pf}),
        el("span",{class:"s"},[c.acheteur,c.limite?"limite "+new Date(c.limite).toLocaleDateString("fr-FR"):"",c.mail&&c.mail.sujet?"mail « "+c.mail.sujet.slice(0,80)+" »"+(md?" du "+md:""):""].filter(Boolean).join(" · ")+" · ",el("a",{href:c.url,target:"_blank",rel:"noopener",text:"voir"})),
        deja?el("span",{class:"res",text:"Déjà dans Vigie"}):null);
      c.li=li; c.cb=cb; liste.append(li);
    });
    bTout.hidden=bAjout.hidden=bSuppr.hidden=!trouves.some(c=>!dejaDansVigie(c));
    compter();
  }
  function compter(){
    const libres=trouves.filter(c=>c.cb&&!c.cb.disabled), nc=libres.filter(c=>c.coche).length;
    cbTout.checked=!!libres.length&&nc===libres.length; cbTout.indeterminate=nc>0&&nc<libres.length;
    const n=trouves.filter(c=>c.coche&&!c.cb.disabled).length; bSuppr.disabled=!n; bSuppr.textContent=n?"Supprimer "+(n>1?"les "+n+" cochés":"le coché"):"Supprimer les cochés"; bAjout.textContent=n?"Ajouter "+n+" marché"+(n>1?"s":""):"Ajouter les marchés cochés"; bAjout.disabled=!n; }
  function ingerer(mails,info){
    const avant=trouves.length, cles=new Set(trouves.map(c=>c.cle));
    const maintenant=new Date(); let passees=0;
    let deja=0, suppr=0;
    for(const m of mails) for(const c of consultationsDuMail(m)) if(!cles.has(c.cle)){
      cles.add(c.cle);
      if(c.limite&&new Date(c.limite)<maintenant){ passees++; continue; }
      if(dejaDansVigie(c)){ deja++; continue; }
      if(memo.ignores[c.cle]){ suppr++; continue; } // supprimée lors d'un import précédent
      trouves.push(c);
    }
    if(deja) info=(info?info+", ":"")+deja+" déjà dans Vigie";
    if(suppr) info=(info?info+", ":"")+suppr+" supprimée"+(suppr>1?"s":"")+" lors d'un import précédent";
    if(passees) info=(info?info+", ":"")+passees+" écartée"+(passees>1?"s":"")+" car la date limite est passée";
    trouves.sort((a,b)=>(b.mail&&b.mail.date||"").localeCompare(a.mail&&a.mail.date||""));
    afficher();
    const n=trouves.length-avant;
    dire(n?"✓ "+n+" consultation"+(n>1?"s":"")+" trouvée"+(n>1?"s":"")+(info?" ("+info+")":"")+". Supprimez celles qui ne vous intéressent pas (cochez-les puis « Supprimer »), puis ajoutez les autres : elles s'afficheront dans la recherche."
      :"Aucune nouvelle consultation trouvée"+(info?" ("+info+")":"")+". Si une alerte n'est pas reconnue, collez-la ci-dessous ou ajoutez le marché par son lien.",n?"ok":"ko");
  }
  bOutlook.onclick=async()=>{
    if(occupe) return; occupe=true; bOutlook.disabled=true;
    const jours=periode.value==="dernier"?null:+periode.value;
    const depuis=jours?new Date(Date.now()-jours*864e5):new Date(new Date(memo.dernier).getTime()-864e5);
    try{
      dire("⏳ Connexion à Outlook…");
      const r=await alertesOutlook(depuis.toISOString(),t=>dire(t));
      if(!r){ dire("Connexion à Outlook annulée.","ko"); return; }
      memo.dernier=new Date().toISOString(); reglerAuto("outlook"); ecrire(CLE_MAIL,memo);
      const nm=traiterMessagesSuivi(r.messages); if(nm) toast(nm+" modification"+(nm>1?"s":"")+" trouvée"+(nm>1?"s":"")+" sur vos marchés suivis");
      ingerer(r.mails,r.lus+" mails parcourus, "+r.mails.length+" alertes"+(r.echanges?", "+r.echanges+" échanges sur vos candidatures ignorés":""));
    }catch(e){ dire(e.message+(/Mail\.Read|consent|AADSTS65001|Access is denied|403/i.test(e.message)?" — l'autorisation de lire les mails n'a pas été accordée.":""),"ko"); }
    finally{ occupe=false; bOutlook.disabled=false; }
  };
  zone.addEventListener("focus",()=>{ if(!zone.dataset.vide){ zone.dataset.vide="1"; zone.textContent=""; } });
  zone.addEventListener("paste",e=>{
    e.preventDefault();
    const html=e.clipboardData.getData("text/html"), texte=e.clipboardData.getData("text/plain");
    zone.textContent="Mail collé ✓ — vous pouvez en coller un autre.";  zone.blur(); delete zone.dataset.vide;
    ingerer([{html,texte:html?"":texte,sujet:"",de:"",date:new Date().toISOString()}],"mail collé");
  });
  zone.addEventListener("keydown",e=>{ if(!(e.ctrlKey||e.metaKey)&&e.key.length===1) e.preventDefault(); });
  zone.addEventListener("drop",async e=>{ e.preventDefault(); zone.classList.remove("survol"); await lireFichiers(e.dataTransfer.files); });
  zone.addEventListener("dragover",e=>{ e.preventDefault(); zone.classList.add("survol"); });
  zone.addEventListener("dragleave",()=>zone.classList.remove("survol"));
  fichiers.onchange=async()=>{ await lireFichiers(fichiers.files); fichiers.value=""; };
  async function lireFichiers(fl){
    const mails=[]; let msg=0;
    for(const f of fl){ if(/\.msg$/i.test(f.name)){ msg++; continue; } try{ mails.push(lireEml(await f.text())); }catch(e){} }
    if(msg&&!mails.length){ dire("Les fichiers .msg d'Outlook ne sont pas lisibles : utilisez « Chercher dans Outlook » ou copiez-collez le mail.","ko"); return; }
    ingerer(mails,mails.length+" fichier"+(mails.length>1?"s":""));
  }
  bSuppr.onclick=()=>{
    if(occupe) return;
    const k=trouves.filter(c=>c.coche&&!c.cb.disabled); if(!k.length) return;
    k.forEach(c=>memo.ignores[c.cle]=1); ecrire(CLE_MAIL,memo);
    trouves=trouves.filter(c=>!k.includes(c)); afficher();
    dire(k.length+" consultation"+(k.length>1?"s":"")+" supprimée"+(k.length>1?"s":"")+" de la liste : elle"+(k.length>1?"s ne seront":" ne sera")+" plus proposée"+(k.length>1?"s":"")+". Les autres restent à ajouter.","ok");
  };
  cbTout.onchange=()=>{ const v=cbTout.checked; trouves.filter(c=>!c.cb.disabled).forEach(c=>{ c.coche=v; c.cb.checked=v; }); compter(); };
  bAjout.onclick=async()=>{
    if(occupe) return; occupe=true; bAjout.disabled=bOutlook.disabled=true;
    const choix=trouves.filter(c=>c.coche&&!c.cb.disabled);
    trouves.filter(c=>!c.coche&&!c.cb.disabled).forEach(c=>memo.ignores[c.cle]=1);
    const cles=Object.keys(memo.ignores); if(cles.length>2000) cles.slice(0,cles.length-2000).forEach(k=>delete memo.ignores[k]);
    ecrire(CLE_MAIL,memo);
    let ok=0, acompleter=0, expirees=0, echecs=0;
    for(const [i,c] of choix.entries()){
      dire("⏳ Ajout "+(i+1)+" / "+choix.length+" : lecture de la consultation (jusqu'à une minute si le serveur Vigie était en veille)…");
      c.li.className="encours"; c.cb.disabled=true;
      const res=el("span",{class:"res",text:"⏳ en cours…"}); c.li.append(res);
      try{
        if(dejaDansVigie(c)){ c.li.className="deja"; res.textContent="Déjà dans Vigie"; continue; }
        const r=await ajouterDepuisAlerte(c);
        if(r.deja){ c.li.className="deja"; res.textContent=r.texte; continue; }
        if(r.expire){ expirees++; c.li.className="deja"; res.textContent=r.texte; continue; }
        ok++;
        if(r.manque.length){ acompleter++; c.li.className="ko"; res.className="res ko"; res.textContent="Ajouté (d'après "+r.source+") — à compléter : "+r.manque.join(", ")+" (bouton Modifier sur l'encart)"; }
        else{ c.li.className="ok"; res.className="res ok"; res.textContent="✓ Ajouté d'après "+r.source+" : « "+r.m.objet.slice(0,90)+" »"; }
        c.li.querySelector(".t").textContent=r.m.objet;
      }catch(e){ echecs++; c.li.className="ko"; res.className="res ko"; res.textContent="Échec : "+e.message; }
    }
    afficherManuels();
    if(!$("#vue-suivi").hidden) afficherSuivi();
    const bilan=(ok?ok+" marché"+(ok>1?"s":"")+" ajouté"+(ok>1?"s":"")+" à la recherche"+(acompleter?" (dont "+acompleter+" à compléter)":""):"Aucun marché ajouté")+(expirees?" · "+expirees+" écarté"+(expirees>1?"s":"")+" (date limite passée)":"");
    occupe=false; bOutlook.disabled=false; compter();
    if(echecs){ dire(bilan+" · "+echecs+" échec"+(echecs>1?"s":"")+" (voir la liste).","ko"); return; }
    // tout s'est bien passé : on ferme et on montre les marchés dans la page principale
    fermer(); toast(bilan);
    if(ok){ changerVue("recherche"); const lm=$("#listeManuels"); if(lm&&lm.firstChild) lm.scrollIntoView({behavior:"smooth",block:"start"}); }
  };
  const boite=el("div",{class:"captcha panneau",role:"dialog","aria-modal":"true","aria-label":"Importer les alertes mail"},
    el("h3",{text:"Importer les alertes mail des plateformes"}),
    el("p",{class:"note",text:"Vigie repère dans les alertes de BOAMP, PLACE, Maximilien, AWS-Achat, achatpublic, e-marchespublics… les liens des consultations, puis les ajoute comme « Ajouter un marché par son lien ». Avec Outlook, vos mails sont lus par votre navigateur ; avec Gmail et les autres messageries, le serveur Vigie les lit le temps de l'import, sans rien garder."}),
    el("div",{class:"ligne"},el("span",{class:"note",text:"Période :"}),periode,el("a",{href:"aide/connexions.html#mail",target:"_blank",rel:"noopener",class:"btn"},"Procédure pas à pas")),
    el("label",{class:"note",style:"display:flex;gap:6px;align-items:flex-start"},cbAuto,el("span",{},el("strong",{text:"Importer automatiquement chaque matin"})," : à la première ouverture de Vigie de la journée, la boîte est relue et les nouveaux marchés sont ajoutés, avec un résumé en haut de la page. "+noteAuto())),
    msConfigure()?el("div",{class:"bloc"},
      el("h4",{text:"Outlook, Hotmail, Microsoft 365"}),
      el("div",{class:"ligne"},bOutlook),
      el("p",{class:"note",text:"La première fois, Microsoft vous demande d'autoriser Vigie à lire vos mails (lecture seule)."})):null,
    el("div",{class:"bloc"},
      el("h4",{text:"Gmail et autres messageries (Orange, Free, OVH, Yahoo, iCloud…)"}),
      el("div",{class:"ligne"},iType,iAdr),
      el("div",{class:"ligne"},iHote,iMdp),
      el("label",{class:"note",style:"display:flex;gap:6px;align-items:center"},iSouv,"Se souvenir du mot de passe (gardé chiffré, retrouvé sur vos autres appareils connectés à Microsoft)"),
      el("div",{class:"ligne"},bImap,el("button",{class:"btn btn-rouge",type:"button",onclick:()=>{ if(!confirm("Effacer l'adresse et le mot de passe de messagerie enregistrés sur cet appareil ?")) return; localStorage.removeItem(CLE_IMAP); iAdr.value=""; iMdp.value=""; iSouv.checked=false; iType.value="gmail"; majType(); dire("Réglages de messagerie effacés.","ok"); }},"Effacer ces réglages")),
      el("p",{class:"note",text:"Gmail, Yahoo et iCloud demandent un « mot de passe d'application » (pas votre mot de passe habituel) : voir la procédure pas à pas. Le serveur Vigie lit la boîte en lecture seule et ne garde ni le mot de passe ni les mails."})),
    el("div",{class:"bloc"},
      el("h4",{text:"Ou : copier-coller d'un mail d'alerte"}),
      zone, el("div",{class:"ligne"},bFichiers,fichiers)),
    etat, bTout, liste,
    el("div",{class:"actions"},el("button",{class:"btn",type:"button",onclick:()=>{ if(!occupe) fermer(); }},"Fermer"),bSuppr,bAjout));
  const fond=el("div",{class:"captcha-fond"},boite);
  fond.addEventListener("click",e=>{ if(e.target===fond&&!occupe) fermer(); });
  document.addEventListener("keydown",echap);
  document.body.append(fond);
  if(msConfigure()) msInit().catch(()=>{});
}
