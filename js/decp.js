/* Vigie Marchés : Onglet « Marchés attribués » (API DECP). */
"use strict";
/* ====================================================================
   Marchés attribués : API DECP (data.economie.gouv.fr, Opendatasoft)
   ==================================================================== */
const API_DECP="https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/decp-v3-marches-valides/records";
const DECP_CHAMPS="id,objet,montant,codecpv,procedure,nature,datenotification,dureemois,acheteur_id,acheteur_nom,titulaire_id_1,titulaire_denominationsociale_1,lieuexecution_code,lieuexecution_nom,offresrecues";
const dEtat={metiers:[],regions:[],deps:[],page:0};
let dMsMetiers,dMsDeps,dMsRegions;
function decpWhere(){
  const w=[];
  const cpv=[];
  dEtat.metiers.forEach(id=>{ const m=METIERS.find(x=>x.id===id); if(m) cpv.push(...m.cpv); });
  const libre=$("#dCpv").value.replace(/\D/g,""); if(libre) cpv.push(libre);
  if(cpv.length) w.push("("+cpv.map(c=>"startswith(codecpv,"+q(c)+")").join(" OR ")+")");
  const dCibles=depsCibles(dEtat.regions,dEtat.deps);
  if(dCibles.length) w.push("("+dCibles.map(d=>"startswith(lieuexecution_code,"+q(d)+")").join(" OR ")+")");
  const a=$("#dAcheteur").value.trim(); if(a) w.push("search(acheteur_nom,"+q(a)+")");
  const t=$("#dTitulaire").value.trim(); if(t) w.push("search(titulaire_denominationsociale_1,"+q(t)+")");
  const m=$("#dMots").value.trim(); if(m) w.push("search(objet,"+q(m)+")");
  const p=$("#dPeriode").value; if(p){ const d=new Date(); d.setDate(d.getDate()-Number(p)); w.push("datenotification>=date'"+dateIso(d)+"'"); }
  return w.join(" AND ");
}
async function odsGet(base,params){
  const rep=await fetch(base+"?"+new URLSearchParams(params).toString(),{headers:{Accept:"application/json"}});
  const corps=await rep.json().catch(()=>null);
  if(!rep.ok) throw new Error((corps&&(corps.message||corps.error_code))||("Erreur HTTP "+rep.status));
  return corps;
}
let dReq=0;
async function rechercherDecp(page=0){
  dEtat.page=page;
  const id=++dReq, where=decpWhere();
  const base={};
  if(where) base.where=where;
  $("#dTxt").innerHTML="marchés attribués<small>Recherche en cours…</small>";
  $("#dListe").innerHTML='<div class="etat">Chargement des marchés attribués…</div>';
  $("#dSynthese").innerHTML=""; $("#dPagination").innerHTML="";
  try{
    const [liste,top,stats]=await Promise.all([
      odsGet(API_DECP,{...base,select:DECP_CHAMPS,order_by:"datenotification desc",limit:String(PAR_PAGE),offset:String(page*PAR_PAGE)}),
      page===0?odsGet(API_DECP,{...base,select:"titulaire_denominationsociale_1 as nom, count(*) as n, sum(montant) as total",group_by:"titulaire_denominationsociale_1",order_by:"n desc",limit:"8"}).catch(()=>null):null,
      page===0?odsGet(API_DECP,{...base,select:"avg(montant) as moyenne, median(montant) as mediane, avg(offresrecues) as offres"}).catch(()=>odsGet(API_DECP,{...base,select:"avg(montant) as moyenne"}).catch(()=>null)):null,
    ]);
    if(id!==dReq) return;
    const total=liste.total_count||0;
    $("#dNb").textContent=total.toLocaleString("fr-FR");
    $("#dTxt").innerHTML=(total>1?"marchés attribués":"marché attribué")+"<small>"+(total?"Les plus récents d'abord · source DECP":"Aucun résultat")+"</small>";
    if(page===0) afficherSynthese(top,stats);
    const cont=$("#dListe"); cont.innerHTML="";
    if(!total){ cont.append(el("div",{class:"etat",text:"Aucun marché attribué ne correspond. Élargissez la période ou retirez un filtre. Tous les acheteurs ne publient pas encore leurs données essentielles."})); return; }
    (liste.results||[]).forEach(r=>cont.append(carteAttrib(r)));
    paginer($("#dPagination"),total,dEtat.page,rechercherDecp);
  }catch(e){
    if(id!==dReq) return;
    $("#dNb").textContent="!";
    $("#dTxt").innerHTML="Recherche impossible<small>Voir le détail ci-dessous</small>";
    const div=el("div",{class:"etat erreur"},el("strong",{text:"Les données des marchés attribués n'ont pas pu être interrogées."}),el("br"),"Relancez dans un instant. Si le problème persiste, copiez-moi ce message : ",el("code",{text:e.message+"  |  where = "+where}));
    $("#dListe").innerHTML=""; $("#dListe").append(div);
  }
}
function euros(n){ const x=Number(n); return isFinite(x)&&x>0?x.toLocaleString("fr-FR",{maximumFractionDigits:0})+" €":"–"; }
function afficherSynthese(top,stats){
  const c=$("#dSynthese"); c.innerHTML="";
  const g=el("div",{class:"synthese"});
  const s=stats&&stats.results&&stats.results[0];
  if(s){
    const b=el("div",{class:"encadre"},el("h2",{text:"Montants"}));
    if(s.mediane!=null) b.append(el("div",{class:"chiffre",text:euros(s.mediane)}),el("div",{class:"note-docs",text:"montant médian"}));
    if(s.moyenne!=null) b.append(el("div",{style:"margin-top:8px;font-weight:600",text:euros(s.moyenne)+" en moyenne"}));
    if(s.offres!=null&&isFinite(s.offres)) b.append(el("div",{class:"note-docs",style:"margin-top:4px",text:(Math.round(s.offres*10)/10).toLocaleString("fr-FR")+" offres reçues en moyenne"}));
    g.append(b);
  }
  const rows=(top&&top.results||[]).filter(r=>r.nom);
  if(rows.length){
    g.append(el("div",{class:"encadre"},el("h2",{text:"Entreprises qui gagnent le plus"}),
      el("ol",{class:"top"},rows.map(r=>el("li",{},el("span",{text:r.nom}),el("span",{text:r.n+" marché"+(r.n>1?"s":"")+(r.total?" · "+euros(r.total):"")}))))));
  }
  if(g.children.length) c.append(g);
}
function carteAttrib(r){
  const cpv=String(r.codecpv||"").slice(0,8);
  const met=cpv?metiersCpv([cpv]):[];
  const meta=[r.acheteur_nom, r.lieuexecution_nom||r.lieuexecution_code, r.procedure, r.dureemois?r.dureemois+" mois":"", r.offresrecues?r.offresrecues+" offre"+(r.offresrecues>1?"s":"")+" reçue"+(r.offresrecues>1?"s":""):""].filter(Boolean).join(" · ");
  return el("article",{class:"attrib"},
    el("h3",{text:r.objet||"(sans objet)"}),
    el("div",{class:"montant"},euros(r.montant),el("small",{text:r.datenotification?"notifié le "+fmtDate(r.datenotification):""})),
    el("div",{class:"meta"},el("span",{class:"gagnant",text:"Titulaire : "+(r.titulaire_denominationsociale_1||"non précisé")})," · ",meta),
    cpv?el("div",{class:"cpv",style:"grid-column:1"},el("code",{text:r.codecpv}),met.map(x=>el("span",{class:"metier",text:x}))):null);
}
function paginer(p,total,page,fn){
  const nbPages=Math.min(Math.ceil(total/PAR_PAGE),Math.floor(10000/PAR_PAGE));
  p.innerHTML=""; if(nbPages<=1) return;
  const b=(lib,pg,dis)=>{ const x=el("button",{type:"button",class:"btn",text:lib}); if(dis) x.setAttribute("aria-disabled","true"); x.onclick=()=>{ fn(pg); window.scrollTo({top:0,behavior:"smooth"}); }; return x; };
  p.append(b("‹ Précédent",page-1,page===0),el("span",{text:"Page "+(page+1)+" / "+nbPages}),b("Suivant ›",page+1,page>=nbPages-1));
}
function historiqueAcheteur(m){
  $("#formDecp").reset(); $("#dPeriode").value="1095";
  dEtat.deps.length=0; dEtat.regions.length=0; dMsRegions.rafraichir(); dEtat.metiers.splice(0,dEtat.metiers.length,...etat.metiers.filter(v=>v.startsWith("m:")).map(v=>v.slice(2)));
  $("#dAcheteur").value=m.acheteur;
  dMsMetiers.rafraichir(); dMsDeps.rafraichir();
  dLance=true; changerVue("attribues"); window.scrollTo({top:0});
  rechercherDecp(0);
  if(dEtat.metiers.length) toast("Historique de l'acheteur, filtré sur vos types de prestation");
}
let dLance=false;
function initDecp(){
  dMsMetiers=multiSelecteur($("#dMetiers"),METIERS.map(m=>[m.id,m.nom]),dEtat.metiers,"Toutes les prestations",()=>{});
  dMsRegions=multiSelecteur($("#dRegions"),REGIONS.map(r=>[r[0],r[1]]),dEtat.regions,"Toutes les régions",()=>{});
  dMsDeps=multiSelecteur($("#dDeps"),DEPS.map(([c,n])=>[c,c+" · "+n]),dEtat.deps,"Toute la France",()=>{});
  $("#formDecp").addEventListener("submit",e=>{ e.preventDefault(); rechercherDecp(0); });
  $("#dRaz").onclick=()=>{ $("#formDecp").reset(); dEtat.metiers.length=0; dEtat.deps.length=0; dEtat.regions.length=0; dMsMetiers.rafraichir(); dMsDeps.rafraichir(); dMsRegions.rafraichir(); };
  document.querySelector('.onglet[data-vue="attribues"]').addEventListener("click",()=>{ if(!dLance){ dLance=true; rechercherDecp(0); } });
}
