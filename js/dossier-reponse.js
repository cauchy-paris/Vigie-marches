/* Vigie Marchés : Dossier de réponse (OneDrive / dossier du PC). */
"use strict";
/* ====================================================================
   Dossier de réponse dans OneDrive (dossier synchronisé du PC)
   ==================================================================== */
const FS_OK = typeof window.showDirectoryPicker==="function";
function idb(){ return new Promise((ok,ko)=>{ const r=indexedDB.open("vigie",1); r.onupgradeneeded=()=>r.result.createObjectStore("kv"); r.onsuccess=()=>ok(r.result); r.onerror=()=>ko(r.error); }); }
async function idbGet(k){ try{ const db=await idb(); return await new Promise(ok=>{ const r=db.transaction("kv").objectStore("kv").get(k); r.onsuccess=()=>ok(r.result); r.onerror=()=>ok(null); }); }catch(e){ return null; } }
async function idbSet(k,v){ try{ const db=await idb(); await new Promise(ok=>{ const t=db.transaction("kv","readwrite"); t.objectStore("kv").put(v,k); t.oncomplete=ok; t.onerror=ok; }); }catch(e){} }
async function dossierRacine(choisir){
  let h=choisir?null:await idbGet("racine");
  if(h){
    if(await h.queryPermission({mode:"readwrite"})==="granted") return h;
    if(await h.requestPermission({mode:"readwrite"})==="granted") return h;
  }
  h=await window.showDirectoryPicker({id:"vigie-reponses",mode:"readwrite",startIn:"documents"});
  await idbSet("racine",h); majRacine();
  return h;
}
async function majRacine(){
  const e=$("#racineNom"); if(!e) return;
  if(!FS_OK){ e.textContent="non disponible dans ce navigateur (utilisez Chrome ou Edge sur PC)"; return; }
  const h=await idbGet("racine"); e.textContent=h?"« "+h.name+" »":"pas encore choisi";
  majBoutonOd();
}
const propre=t=>(t||"").normalize("NFC").replace(/[<>:"\/\\|?*\x00-\x1f]/g," ").replace(/\s+/g," ").trim().replace(/[. ]+$/,"");
const MOTS_VIDES_NOM=new Set("de des du la le les l d et a au aux en pour sur dans un une par avec relatif relatifs relative relatives concernant marche marches accord cadre prestations prestation travaux services fournitures objet lot lots".split(" "));
function designation(objet){
  const mots=(objet||"").replace(/[’']/g," ").split(/[^\p{L}\p{N}-]+/u).filter(w=>w.length>1&&!MOTS_VIDES_NOM.has(w.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"")));
  let r=""; for(const w of mots){ if((r+" "+w).length>40) break; r+=(r?" ":"")+w; }
  return r||"Consultation";
}
function nomDossier(m){
  let d="";
  if(m.limite){ const p=Object.fromEntries(new Intl.DateTimeFormat("fr-FR",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"}).formatToParts(new Date(m.limite)).map(x=>[x.type,x.value])); d=p.year+p.month+p.day+p.hour; }
  else d=new Date().toLocaleDateString("sv-SE").replace(/-/g,"")+"00";
  const texte=[m.objet,m.description,m.procedure].join(" ");
  const ac=m.accordCadre||/accord[- ]?cadre/i.test(texte);
  const type=ac?"AC":/appel d.offres/i.test(m.procedure||"")?"AO":"MAPA";
  const ce=corpsEtat(m);
  const sujet=ac&&ce.length?ce.slice(0,2).join("-"):designation(m.objet);
  const ville=m.villeAcheteur||(m.lieu||"").replace(/^\d{5}\s*/,"")||(m.deps[0]?NOM_DEP[m.deps[0]]||m.deps[0]:"");
  return propre([d,type,sujet,ville].filter(Boolean).join("_")).slice(0,120);
}
// Noms de fichiers des ZIP : UTF-8 si possible, sinon page de code DOS 850 (archives Windows)
const CP850="ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ";
function nomZip(octets){
  try{ return new TextDecoder("utf-8",{fatal:true}).decode(octets); }catch(e){}
  let r=""; for(const b of octets) r+=b<128?String.fromCharCode(b):CP850[b-128]; return r;
}
let journalEl=null;
function journal(titre){
  if(journalEl) journalEl.remove();
  const lignes=el("ol",{class:"journal-lignes"});
  const fermer=el("button",{class:"btn",type:"button",onclick:()=>{ journalEl.remove(); journalEl=null; }},"Fermer");
  journalEl=el("div",{class:"journal",role:"status"},el("h3",{text:titre}),lignes,fermer);
  document.body.append(journalEl);
  return { ligne:(t,cls)=>{ const li=el("li",{class:cls||"",text:t}); lignes.append(li); return li; } };
}
