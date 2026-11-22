/* Vigie Marchés : Requête ODSQL et recherche BOAMP. */
"use strict";
/* ====================================================================
   Construction de la requête ODSQL
   ==================================================================== */
const etat = { type:"", metiers:[], regions:[], deps:[], page:0 };
function q(s){ return '"'+String(s).replace(/\\/g,"\\\\").replace(/"/g,'\\"')+'"'; }
function dateIso(d){ return d.toISOString().slice(0,10); }
function construireWhere(){
  const w=[];
  const nature=$("#fNature").value; if(nature) w.push("nature="+q(nature));
  if(etat.type) w.push("type_marche="+q(etat.type));
  const cibles=depsCibles(etat.regions,etat.deps);
  if(cibles.length) w.push("("+cibles.map(d=>"code_departement="+q(d)).join(" OR ")+")");
  if(etat.metiers.length){
    const conds=[];
    etat.metiers.forEach(v=>{
      if(v.startsWith("d:")) conds.push(prestationsReelles?"descripteur_libelle="+q(v.slice(2)):"search(descripteur_libelle,"+q(v.slice(2))+")");
      else (METIERS.find(m=>m.id===v.replace(/^m:/,""))||{termes:[]}).termes.forEach(t=>conds.push("search(descripteur_libelle,"+q(t)+")"));
    });
    if(conds.length) w.push("("+conds.join(" OR ")+")");
  }
  const ach=$("#fAcheteur").value.trim(); if(ach) w.push("search(nomacheteur,"+q(ach)+")");
  const mots=$("#fMots").value.trim();
  if(mots){
    if($("#fTexteComplet").checked) w.push("search("+q(mots)+")");
    else w.push("(search(objet,"+q(mots)+") OR search(descripteur_libelle,"+q(mots)+"))");
  }
  if($("#fEnCours").checked) w.push("datelimitereponse>=date'"+dateIso(new Date())+"'");
  const pub=$("#fPublie").value;
  if(pub){ const d=new Date(); d.setDate(d.getDate()-Number(pub)); w.push("dateparution>=date'"+dateIso(d)+"'"); }
  return w.join(" AND ");
}

let requeteEnCours=0;
async function rechercher(page=0){
  etat.page=page;
  sauverFiltres();
  afficherManuels();
  const id=++requeteEnCours;
  const where=construireWhere();
  const tri=$("#fTri").value, parPert=tri==="pertinence", nP=parPage();
  const params=new URLSearchParams({select:CHAMPS,limit:String(nP),offset:String(page*nP),order_by:parPert?"datelimitereponse asc":tri});
  if(where) params.set("where",where);
  const url=API+"?"+params.toString();
  $("#txtRes").innerHTML='marchés trouvés<small>Recherche en cours…</small>';
  $("#liste").innerHTML='<div class="etat">Chargement des annonces BOAMP…</div>';
  $("#pagination").innerHTML="";
  try{
    const rep=await fetch(url,{headers:{Accept:"application/json"}});
    const corps=await rep.json().catch(()=>null);
    if(id!==requeteEnCours) return;
    if(!rep.ok){ throw new Error((corps&&(corps.message||corps.error_code))||("Erreur HTTP "+rep.status)); }
    const total=corps.total_count||0;
    const items=(corps.results||[]).map(normaliser);
    if(parPert) items.sort((a,b)=>notePertinence(b).score-notePertinence(a).score);
    afficherCompteur(total);
    afficherListe($("#liste"),items,"Aucun marché ne correspond à ces filtres. Essayez d'élargir la recherche (moins de départements, sans mots-clés, ou en décochant « encore ouverts »).");
    afficherPagination(total);
    majSnapshots(items);
  }catch(e){
    if(id!==requeteEnCours) return;
    $("#nbRes").textContent="!";
    $("#txtRes").innerHTML='Recherche impossible<small>Voir le détail ci-dessous</small>';
    $("#liste").innerHTML='';
    const div=document.createElement("div"); div.className="etat erreur";
    div.innerHTML='<strong>Le BOAMP n\'a pas pu être interrogé.</strong><br>Vérifiez la connexion internet, puis relancez. Si le problème persiste, le message technique ci-dessous m\'aidera à corriger :<br><code></code>';
    div.querySelector("code").textContent=e.message+"  |  where = "+where;
    $("#liste").appendChild(div);
  }
}
function afficherCompteur(total){
  $("#nbRes").textContent=total.toLocaleString("fr-FR");
  const nP=parPage(), debut=etat.page*nP+1, fin=Math.min(total,(etat.page+1)*nP);
  const s=total>1?"s":"";
  $("#txtRes").innerHTML=(total>1?"marchés trouvés":"marché trouvé")+'<small>'+(total?("Affichage "+debut+" à "+fin+(nP>PAR_PAGE?" classés par pertinence":"")+" · source BOAMP, mise à jour quotidienne"):"Aucun résultat")+'</small>';
}
function afficherPagination(total){
  const nP=parPage(), nbPages=Math.min(Math.ceil(total/nP),Math.floor(10000/nP));
  const p=$("#pagination"); p.innerHTML="";
  if(nbPages<=1) return;
  const b=(lib,page,dis)=>{ const x=document.createElement("button"); x.type="button"; x.className="btn"; x.textContent=lib; if(dis) x.setAttribute("aria-disabled","true"); x.onclick=()=>{ rechercher(page); window.scrollTo({top:0,behavior:"smooth"}); }; return x; };
  p.append(b("‹ Précédent",etat.page-1,etat.page===0));
  const s=document.createElement("span"); s.textContent="Page "+(etat.page+1)+" / "+nbPages; p.append(s);
  p.append(b("Suivant ›",etat.page+1,etat.page>=nbPages-1));
}
