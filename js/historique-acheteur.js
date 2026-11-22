/* Vigie Marchés : Historique des attributions de l'acheteur (DECP). */
"use strict";
/* ====================================================================
   Historique des attributions de l'acheteur (DECP), dans l'encart
   ==================================================================== */
const cacheAttrib=new Map();
function filtreAcheteur(m){
  const s=(m.siretAcheteur||"").replace(/\D/g,"");
  if(s.length>=9) return {w:"startswith(acheteur_id,"+q(s.slice(0,9))+")",par:"SIREN "+s.slice(0,9)};
  return {w:"search(acheteur_nom,"+q(m.acheteur)+")",par:"nom"};
}
function prefixesCpv(m){
  const p=new Set((m.cpv||[]).map(c=>String(c).replace(/\D/g,"").slice(0,4)).filter(c=>c.length===4));
  if(!p.size) metiersCpvIds(m).forEach(id=>{ const x=METIERS.find(y=>y.id===id); if(x) x.cpv.forEach(c=>p.add(c.slice(0,4))); });
  return [...p].slice(0,8);
}
function metiersCpvIds(m){ const ce=corpsEtat(m); return METIERS.filter(x=>ce.includes(x.nom.split(",")[0])).map(x=>x.id); }
async function donneesAttributions(m){
  if(cacheAttrib.has(m.idweb)) return cacheAttrib.get(m.idweb);
  const fa=filtreAcheteur(m), d=new Date(); d.setFullYear(d.getFullYear()-5);
  const periode="datenotification>=date'"+dateIso(d)+"'";
  const ach=fa.w+" AND "+periode;
  const pref=prefixesCpv(m), wCpv=pref.length?"("+pref.map(c=>"startswith(codecpv,"+q(c)+")").join(" OR ")+")":"";
  const dep=(m.deps||[])[0];
  const stat=w=>odsGet(API_DECP,{where:w,select:"count(*) as n, median(montant) as mediane, avg(montant) as moyenne, avg(offresrecues) as offres"}).catch(()=>odsGet(API_DECP,{where:w,select:"count(*) as n, avg(montant) as moyenne, avg(offresrecues) as offres"}));
  const p=Promise.all([
    stat(ach),
    odsGet(API_DECP,{where:ach,select:"titulaire_denominationsociale_1 as nom, count(*) as n, sum(montant) as total",group_by:"titulaire_denominationsociale_1",order_by:"n desc",limit:"5"}).catch(()=>null),
    wCpv?odsGet(API_DECP,{where:ach+" AND "+wCpv,select:DECP_CHAMPS,order_by:"datenotification desc",limit:"6"}).catch(()=>null):null,
    odsGet(API_DECP,{where:ach,select:DECP_CHAMPS,order_by:"datenotification desc",limit:"6"}).catch(()=>null),
    wCpv&&dep?stat(wCpv+" AND startswith(lieuexecution_code,"+q(dep)+") AND "+periode).catch(()=>null):null,
  ]).then(([s,top,sim,dern,ref])=>({fa,pref,dep,s:s&&s.results&&s.results[0],top:(top&&top.results||[]).filter(r=>r.nom),sim:sim&&sim.results||[],dern:dern&&dern.results||[],ref:ref&&ref.results&&ref.results[0]}));
  cacheAttrib.set(m.idweb,p); p.catch(()=>cacheAttrib.delete(m.idweb));
  return p;
}
async function panneauAttributions(m,pan){
  pan.innerHTML=""; pan.append(el("div",{class:"ia-attente"},el("span",{class:"rond"}),"Recherche des marchés déjà attribués par cet acheteur (DECP)…"));
  try{
    const D=await donneesAttributions(m);
    pan.innerHTML="";
    const n=D.s?Number(D.s.n)||0:0;
    if(!n){
      pan.append(el("p",{class:"ia-synthese",text:"Aucun marché attribué par « "+m.acheteur+" » dans les données publiques des 5 dernières années. Tous les acheteurs ne publient pas encore leurs données essentielles, ou le nom diffère : essayez l'onglet « Marchés attribués »."}));
    }else{
      const offres=D.s.offres!=null&&isFinite(D.s.offres)?Math.round(D.s.offres*10)/10:null;
      const lead=D.top[0];
      pan.append(el("p",{class:"ia-synthese",text:n+" marché"+(n>1?"s":"")+" attribué"+(n>1?"s":"")+" en 5 ans"+(D.s.mediane!=null?", montant médian "+euros(D.s.mediane):"")+(offres!=null?", "+offres.toLocaleString("fr-FR")+" offres reçues en moyenne":"")+"."+(lead&&lead.n>1?" L'entreprise qui gagne le plus souvent : "+lead.nom+" ("+lead.n+" marchés).":"")}));
      const fiche=el("dl",{class:"ia-fiche"});
      const f=(lib,v,cl)=>{ if(v) fiche.append(el("div",{class:cl||null},el("dt",{text:lib}),el("dd",{text:v}))); };
      f("Marchés attribués (5 ans)",String(n));
      f("Montant médian",D.s.mediane!=null?euros(D.s.mediane):"","montant");
      f("Montant moyen",D.s.moyenne!=null?euros(D.s.moyenne):"","montant");
      f("Concurrence",offres!=null?offres.toLocaleString("fr-FR")+" offres en moyenne":"");
      if(D.ref&&Number(D.ref.n)) f("Prix constatés, même prestation dans le "+D.dep,(D.ref.mediane!=null?euros(D.ref.mediane)+" médian":euros(D.ref.moyenne)+" en moyenne")+" sur "+D.ref.n+" marchés"+(D.ref.offres!=null&&isFinite(D.ref.offres)?", "+(Math.round(D.ref.offres*10)/10).toLocaleString("fr-FR")+" offres":""),"montant");
      pan.append(fiche);
      if(D.top.length) pan.append(el("div",{class:"ia-bloc"},el("h4",{text:"Entreprises qui gagnent chez cet acheteur"}),
        el("ol",{class:"top"},D.top.map(r=>el("li",{},el("span",{text:r.nom}),el("span",{text:r.n+" marché"+(r.n>1?"s":"")+(r.total?" · "+euros(r.total):"")}))))));
      const lignes=D.sim.length?D.sim:D.dern;
      if(lignes.length) pan.append(el("div",{class:"ia-bloc"},el("h4",{text:D.sim.length?"Derniers marchés similaires de cet acheteur":"Derniers marchés de cet acheteur"}),
        el("div",{class:"table-defil"},el("table",{class:"ia-criteres"},
          el("thead",{},el("tr",{},["Notifié","Objet","Titulaire","Montant","Offres"].map(t=>el("th",{text:t})))),
          el("tbody",{},lignes.map(r=>el("tr",{},el("td",{text:r.datenotification?fmtDate(r.datenotification):"–"}),el("td",{text:r.objet||"–"}),el("td",{class:"gagnant",text:r.titulaire_denominationsociale_1||"non précisé"}),el("td",{class:"nombre",text:euros(r.montant)}),el("td",{class:"nombre",text:r.offresrecues!=null?String(r.offresrecues):"–"}))))))));
    }
    pan.append(el("div",{class:"docs"},el("button",{type:"button",class:"btn",onclick:()=>historiqueAcheteur(m)},"Tout l'historique de l'acheteur")),
      el("p",{class:"note-docs",text:"Source : données essentielles de la commande publique (DECP), recherche par "+(D.fa.par==="nom"?"nom de l'acheteur (peut mélanger des homonymes)":D.fa.par)+". Pour un accord-cadre, le montant publié est souvent le maximum."}));
  }catch(e){
    pan.innerHTML="";
    pan.append(el("div",{class:"ia-erreur"},el("p",{text:"Les marchés attribués n'ont pas pu être interrogés ("+(e.message||e)+")."}),el("button",{type:"button",class:"btn",onclick:()=>panneauAttributions(m,pan)},"Réessayer")));
  }
}
