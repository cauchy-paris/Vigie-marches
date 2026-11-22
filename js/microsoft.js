/* Vigie Marchés : Connexion Microsoft (OneDrive en ligne, Outlook). */
"use strict";
/* ---------- Connexion Microsoft (OneDrive en ligne) ----------
   Application déclarée dans Microsoft Entra (tenant Cauchy Paris ; identifiants publics, pas de secret).
   MS_MULTI=true quand l'application accepte tous les comptes Microsoft (« Comptes dans un annuaire
   organisationnel et comptes Microsoft personnels ») : chaque client se connecte alors avec le sien. */
const MS_CLIENT_ID="6b6c5506-bb5e-48d4-a594-eca34bf48837", MS_TENANT="c8e0a9bc-18bd-46ef-9666-4108eeb221c1", MS_MULTI=true;
const MS_SCOPES=["Files.ReadWrite","User.Read"];
const CLE_OD="vigie.onedrive.v1";
let msApp=null, msPret=null;
function msConfigure(){ return !!(MS_CLIENT_ID&&MS_TENANT); }
function chargerScript(src){ return new Promise((ok,ko)=>{ const e=document.createElement("script"); e.src=src; e.onload=ok; e.onerror=()=>ko(new Error("Impossible de charger la connexion Microsoft")); document.head.append(e); }); }
function msInit(){
  if(!msConfigure()) return Promise.resolve(null);
  if(!msPret) msPret=(async()=>{
    if(!window.msal) await chargerScript("https://cdn.jsdelivr.net/npm/@azure/msal-browser@3.28.1/lib/msal-browser.min.js");
    msApp=new msal.PublicClientApplication({auth:{clientId:MS_CLIENT_ID,authority:"https://login.microsoftonline.com/"+(MS_MULTI?"common":MS_TENANT),redirectUri:location.origin+location.pathname},cache:{cacheLocation:"localStorage"}});
    await msApp.initialize();
    const r=await msApp.handleRedirectPromise().catch(()=>null);
    if(r&&r.account) msApp.setActiveAccount(r.account);
    if(!msApp.getActiveAccount()&&msApp.getAllAccounts()[0]) msApp.setActiveAccount(msApp.getAllAccounts()[0]);
    majMs();
    return msApp;
  })();
  return msPret;
}
function msCompte(){ return msApp&&msApp.getActiveAccount(); }
async function msConnecter(scopes=MS_SCOPES){
  const app=await msInit(); if(!app) return null;
  try{ const r=await app.loginPopup({scopes,prompt:"select_account"}); app.setActiveAccount(r.account); majMs(); return r.account; }
  catch(e){
    if(/popup|block/i.test((e.errorCode||"")+e.message)){ await app.loginRedirect({scopes}); return null; }
    if(!/user_cancelled/i.test(e.errorCode||"")) toast("Connexion Microsoft impossible : "+(e.errorMessage||e.message));
    return null;
  }
}
async function msJeton(interactif,scopes=MS_SCOPES){
  const app=await msInit(); if(!app) return null;
  const compte=app.getActiveAccount(); if(!compte) return null;
  try{ return (await app.acquireTokenSilent({scopes,account:compte})).accessToken; }
  catch(e){
    if(!interactif) return null;
    try{ return (await app.acquireTokenPopup({scopes,account:compte})).accessToken; }
    catch(e2){
      if(/popup|block/i.test((e2.errorCode||"")+e2.message)){ await app.acquireTokenRedirect({scopes,account:compte}); return null; }
      if(!/user_cancelled/i.test(e2.errorCode||"")) toast("Autorisation Microsoft refusée : "+(e2.errorMessage||e2.message));
      return null;
    }
  }
}
async function majMs(){
  const b=$("#blocMs"); if(!b) return;
  b.hidden=!msConfigure(); if(b.hidden) return;
  const c=msCompte();
  $("#msEtat").textContent=c?"connecté ("+(c.username||c.name)+")":"non connecté";
  $("#btnMs").textContent=c?"Changer de compte":"Se connecter à Microsoft";
  const od=lire(CLE_OD,null);
  $("#odEtat").textContent=od?"Dossier enregistré : « "+od.nom+" »":"Aucun dossier enregistré pour l'instant.";
  if(od&&!$("#lienOd").value) $("#lienOd").value=od.lien||"";
  majBoutonOd();
}
// Lien de partage OneDrive -> identifiants du dossier (API Graph « shares »)
// Dossier d'un site SharePoint (…sharepoint.com/:f:/s/… ou /sites/…) : il faut l'autorisation « Files.ReadWrite.All »
// (fichiers auxquels l'utilisateur a accès), « Files.ReadWrite » ne couvrant que son propre OneDrive.
const MS_SCOPES_SITES=["Files.ReadWrite.All","User.Read"];
function scopesDossier(od){ od=od===undefined?lire(CLE_OD,null):od; return od&&od.sites?MS_SCOPES_SITES:MS_SCOPES; }
function lienDeSite(lien){ return /^https:\/\/[^/]*\.sharepoint\.com\//i.test(lien)&&!/^https:\/\/[^/]*-my\.sharepoint\.com\//i.test(lien); }
// Renvoie true si le dossier est enregistré ; sinon lève une erreur dont le message dit pourquoi.
async function enregistrerLienOd(lienDonne){
  const lien=(lienDonne!=null?lienDonne:$("#lienOd").value).trim();
  if(!lien) throw new Error("Collez d'abord le lien de partage du dossier.");
  if(!/^https:\/\/[^/]*(sharepoint\.com|onedrive\.live\.com|1drv\.ms)\//i.test(lien)) throw new Error("Ce lien n'est pas un lien OneDrive ou SharePoint (il doit commencer par https:// et contenir sharepoint.com, onedrive.live.com ou 1drv.ms).");
  if(!msCompte()&&!await msConnecter()) throw new Error("Connectez d'abord votre compte Microsoft.");
  const id="u!"+btoa(unescape(encodeURIComponent(lien))).replace(/=+$/,"").replace(/\//g,"_").replace(/\+/g,"-");
  const essai=async scopes=>{
    const jeton=await msJeton(true,scopes);
    if(!jeton) throw new Error("Microsoft n'a pas donné l'autorisation d'accéder aux fichiers"+(scopes===MS_SCOPES_SITES?" des sites SharePoint":"")+". Si une fenêtre Microsoft s'est ouverte, acceptez-la puis cliquez de nouveau « Enregistrer ce dossier ».");
    const rep=await fetch("https://graph.microsoft.com/v1.0/shares/"+id+"/driveItem?$select=id,name,folder,parentReference,webUrl",{headers:{Authorization:"Bearer "+jeton,Prefer:"redeemSharingLinkIfNecessary"}});
    return { rep, j:await rep.json().catch(()=>({})) };
  };
  let sites=lienDeSite(lien), r=await essai(sites?MS_SCOPES_SITES:MS_SCOPES);
  // lien d'un dossier partagé par quelqu'un d'autre : on retente avec l'accès aux fichiers partagés
  if(!r.rep.ok&&!sites&&[401,403,404].includes(r.rep.status)){ sites=true; r=await essai(MS_SCOPES_SITES); }
  const {rep,j}=r;
  if(!rep.ok){
    const code=(j.error&&j.error.code)||"", detail=(j.error&&j.error.message)||"";
    const c=msCompte(), qui=c?(c.username||c.name):"le compte connecté";
    if(rep.status===403||/accessDenied/i.test(code)) throw new Error("Accès refusé : "+qui+" n'a pas accès à ce dossier. Vérifiez que le lien est partagé avec ce compte (ou « personnes de votre organisation »)."+(detail?" ("+detail+")":""));
    if(rep.status===404||/itemNotFound/i.test(code)) throw new Error("Dossier introuvable avec ce lien. Recopiez le lien depuis SharePoint ou OneDrive (Partager › Copier le lien) et vérifiez qu'il n'a pas expiré.");
    if(rep.status===401) throw new Error("Connexion Microsoft expirée : cliquez « Se déconnecter de Microsoft », reconnectez-vous puis réessayez.");
    throw new Error("Microsoft a refusé ce lien ("+rep.status+(detail?" : "+detail:"")+").");
  }
  if(!j.folder) throw new Error("Ce lien pointe vers un fichier, pas vers un dossier. Partagez le dossier lui-même.");
  ecrire(CLE_OD,{lien,driveId:j.parentReference.driveId,id:j.id,nom:j.name,webUrl:j.webUrl,sites:sites||undefined});
  if($("#lienOd")) $("#lienOd").value=lien;
  majMs(); toast("Dossier « "+j.name+" » enregistré"); return j.name;
}
