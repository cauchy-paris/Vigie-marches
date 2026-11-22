/* Vigie Marchés : Constantes, métiers, départements, plateformes, stockage local. */
"use strict";
/* ====================================================================
   Vigie Marchés : veille BOAMP (API Opendatasoft de la DILA)
   ==================================================================== */
const API = "https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records";
const PAR_PAGE = 20;
const CHAMPS = "idweb,objet,nomacheteur,dateparution,datelimitereponse,type_marche,code_departement,descripteur_libelle,procedure_libelle,famille_libelle,nature_libelle,url_avis,donnees";

/* ---------- Métiers : descripteurs BOAMP + préfixes CPV ---------- */
const METIERS = [
  {id:"plomberie",  nom:"Plomberie, sanitaire",            termes:["plomberie","sanitaire"],                         cpv:["45330","45332","44115","44411"]},
  {id:"cvc",        nom:"Chauffage, ventilation, clim (CVC)", termes:["chauffage","ventilation","climatisation"],   cpv:["45331","39715","42500","50720","50730"]},
  {id:"electricite",nom:"Électricité, courants faibles",   termes:["électricité","courants faibles","éclairage"],    cpv:["4531","31","50711","34993"]},
  {id:"grosoeuvre", nom:"Gros œuvre, maçonnerie",          termes:["maçonnerie","gros œuvre","béton"],               cpv:["45262","45223","4521"]},
  {id:"menuiserie", nom:"Menuiserie",                      termes:["menuiserie"],                                    cpv:["45421","44221"]},
  {id:"peinture",   nom:"Peinture, revêtements",           termes:["peinture","revêtements"],                         cpv:["45442","45432","45431"]},
  {id:"platrerie",  nom:"Plâtrerie, cloisons, plafonds",   termes:["plâtrerie","cloisons","plafonds"],               cpv:["45410","454211"]},
  {id:"couverture", nom:"Couverture, charpente, étanchéité",termes:["couverture","charpente","étanchéité"],         cpv:["45261"]},
  {id:"serrurerie", nom:"Serrurerie, métallerie",          termes:["serrurerie","métallerie"],                       cpv:["45421","44316","44212"]},
  {id:"vrd",        nom:"VRD, voirie, terrassement",       termes:["voirie","terrassement","assainissement","réseaux divers"], cpv:["45233","45232","45112","45111"]},
  {id:"espacesverts",nom:"Espaces verts, paysage",         termes:["espaces verts","paysager"],                      cpv:["77310","77311","77314","45112710"]},
  {id:"demolition", nom:"Démolition, désamiantage",        termes:["démolition","désamiantage","amiante"],           cpv:["45111","45262660"]},
  {id:"nettoyage",  nom:"Nettoyage, propreté",             termes:["nettoyage"],                                     cpv:["9091","9092"]},
  {id:"maintenance",nom:"Maintenance multitechnique",      termes:["maintenance"],                                   cpv:["507","5070","5071"]},
  {id:"ascenseurs", nom:"Ascenseurs",                      termes:["ascenseur"],                                     cpv:["42416","50750"]},
  {id:"incendie",   nom:"Sécurité incendie, sûreté",       termes:["incendie","sécurité"],                           cpv:["31625","35111","45343","79710"]},
  {id:"informatique",nom:"Informatique, logiciels",        termes:["informatique","logiciel"],                       cpv:["48","72","302"]},
  {id:"moe",        nom:"Maîtrise d'œuvre, études",        termes:["maîtrise d'œuvre","études","architecture"],      cpv:["71"]},
];

/* ---------- Descripteurs BOAMP par type de marché ----------
   Liste de base, complétée au chargement par la liste réelle tirée du BOAMP
   (tous les descripteurs utilisés sur 2 ans, avec leur nombre d'annonces). */
const PRESTATIONS_BASE={
  TRAVAUX:["Ascenseur","Assainissement","Bâtiment","Carrelage","Charpente","Chauffage","Climatisation","Clôture","Cloisons","Construction","Couverture","Démolition","Désamiantage","Eclairage public","Electricité","Equipements sportifs","Espaces verts","Etanchéité","Faux plafonds","Façades","Génie civil","Gros œuvre","Isolation","Maçonnerie","Menuiserie","Métallerie","Mobilier urbain","Ouvrages d'art","Peinture","Plâtrerie","Plomberie","Ravalement","Réhabilitation","Réseaux","Revêtements de sols","Rénovation","Second œuvre","Serrurerie","Signalisation","Sanitaire","Terrassement","Travaux maritimes","Ventilation","Vitrerie","Voirie","VRD"],
  SERVICES:["Assistance à maîtrise d'ouvrage","Assurance","Audit","Communication","Conseil","Contrôle technique","Coordination SPS","Déchets","Déménagement","Diagnostic","Entretien","Etudes","Evénementiel","Formation","Gardiennage","Géomètre","Hébergement","Impression","Informatique","Ingénierie","Juridique","Location","Maintenance","Maîtrise d'œuvre","Nettoyage","Prestations intellectuelles","Propreté","Restauration collective","Sécurité","Services sociaux","Surveillance","Télécommunications","Transport","Transport scolaire","Travail temporaire"],
  FOURNITURES:["Alimentation","Carburant","Consommables","Denrées alimentaires","Electricité (énergie)","Equipement","Fournitures de bureau","Fournitures scolaires","Gaz","Habillement","Livres","Logiciels","Matériel informatique","Matériel médical","Mobilier","Médicaments","Papier","Produits d'entretien","Véhicules","Vêtements de travail"],
};
const TYPES_LIB={TRAVAUX:"Travaux",SERVICES:"Services",FOURNITURES:"Fournitures"};
let PRESTATIONS={TRAVAUX:PRESTATIONS_BASE.TRAVAUX.map(n=>({nom:n,n:null})),SERVICES:PRESTATIONS_BASE.SERVICES.map(n=>({nom:n,n:null})),FOURNITURES:PRESTATIONS_BASE.FOURNITURES.map(n=>({nom:n,n:null}))};
let prestationsReelles=false;
const CLE_DESC="vigie.descripteurs.v1";
async function chargerDescripteurs(){
  const cache=lire(CLE_DESC,null);
  if(cache&&cache.date&&(Date.now()-new Date(cache.date))<7*86400000&&cache.liste){ PRESTATIONS=cache.liste; prestationsReelles=true; return true; }
  const depuis=new Date(); depuis.setFullYear(depuis.getFullYear()-2);
  const res={};
  for(const t of Object.keys(TYPES_LIB)){
    const params=new URLSearchParams({select:"descripteur_libelle, count(*) as n",group_by:"descripteur_libelle",where:'type_marche="'+t+'" AND dateparution>=date\''+dateIso(depuis)+'\''});
    const rep=await fetch(API.replace(/records$/,"exports/json")+"?"+params);
    if(!rep.ok) throw new Error("HTTP "+rep.status);
    const lignes=await rep.json();
    const cpt=new Map();
    lignes.forEach(l=>liste(l.descripteur_libelle).forEach(nom=>{ if(nom) cpt.set(nom,(cpt.get(nom)||0)+(l.n||0)); }));
    if(!cpt.size) throw new Error("liste vide");
    res[t]=[...cpt].map(([nom,n])=>({nom,n})).sort((a,b)=>a.nom.localeCompare(b.nom,"fr"));
  }
  PRESTATIONS=res; prestationsReelles=true;
  ecrire(CLE_DESC,{date:new Date().toISOString(),liste:res});
  return true;
}
function optionsPrestations(){
  const opts=METIERS.map(m=>["m:"+m.id,m.nom,"Regroupements par métier"]);
  const types=etat.type?[etat.type]:Object.keys(TYPES_LIB);
  types.forEach(t=>(PRESTATIONS[t]||[]).forEach(p=>opts.push(["d:"+p.nom,p.nom+(p.n?"  ("+p.n.toLocaleString("fr-FR")+")":""),TYPES_LIB[t]+" · toutes les prestations BOAMP"])));
  // garder visibles les choix déjà faits même s'ils ne sont plus dans la liste
  etat.metiers.forEach(v=>{ if(!opts.some(o=>o[0]===v)) opts.push([v,libChoix(v),"Déjà sélectionnés"]); });
  return opts;
}
function libChoix(v){ if(v.startsWith("d:")) return v.slice(2); const id=v.replace(/^m:/,""); const m=METIERS.find(x=>x.id===id); return m?m.nom:v; }

/* ---------- Départements ---------- */
const DEPS = [["01","Ain"],["02","Aisne"],["03","Allier"],["04","Alpes-de-Haute-Provence"],["05","Hautes-Alpes"],["06","Alpes-Maritimes"],["07","Ardèche"],["08","Ardennes"],["09","Ariège"],["10","Aube"],["11","Aude"],["12","Aveyron"],["13","Bouches-du-Rhône"],["14","Calvados"],["15","Cantal"],["16","Charente"],["17","Charente-Maritime"],["18","Cher"],["19","Corrèze"],["2A","Corse-du-Sud"],["2B","Haute-Corse"],["21","Côte-d'Or"],["22","Côtes-d'Armor"],["23","Creuse"],["24","Dordogne"],["25","Doubs"],["26","Drôme"],["27","Eure"],["28","Eure-et-Loir"],["29","Finistère"],["30","Gard"],["31","Haute-Garonne"],["32","Gers"],["33","Gironde"],["34","Hérault"],["35","Ille-et-Vilaine"],["36","Indre"],["37","Indre-et-Loire"],["38","Isère"],["39","Jura"],["40","Landes"],["41","Loir-et-Cher"],["42","Loire"],["43","Haute-Loire"],["44","Loire-Atlantique"],["45","Loiret"],["46","Lot"],["47","Lot-et-Garonne"],["48","Lozère"],["49","Maine-et-Loire"],["50","Manche"],["51","Marne"],["52","Haute-Marne"],["53","Mayenne"],["54","Meurthe-et-Moselle"],["55","Meuse"],["56","Morbihan"],["57","Moselle"],["58","Nièvre"],["59","Nord"],["60","Oise"],["61","Orne"],["62","Pas-de-Calais"],["63","Puy-de-Dôme"],["64","Pyrénées-Atlantiques"],["65","Hautes-Pyrénées"],["66","Pyrénées-Orientales"],["67","Bas-Rhin"],["68","Haut-Rhin"],["69","Rhône"],["70","Haute-Saône"],["71","Saône-et-Loire"],["72","Sarthe"],["73","Savoie"],["74","Haute-Savoie"],["75","Paris"],["76","Seine-Maritime"],["77","Seine-et-Marne"],["78","Yvelines"],["79","Deux-Sèvres"],["80","Somme"],["81","Tarn"],["82","Tarn-et-Garonne"],["83","Var"],["84","Vaucluse"],["85","Vendée"],["86","Vienne"],["87","Haute-Vienne"],["88","Vosges"],["89","Yonne"],["90","Territoire de Belfort"],["91","Essonne"],["92","Hauts-de-Seine"],["93","Seine-Saint-Denis"],["94","Val-de-Marne"],["95","Val-d'Oise"],["971","Guadeloupe"],["972","Martinique"],["973","Guyane"],["974","La Réunion"],["976","Mayotte"]];
const REGIONS=[
  ["ARA","Auvergne-Rhône-Alpes",["01","03","07","15","26","38","42","43","63","69","73","74"]],
  ["BFC","Bourgogne-Franche-Comté",["21","25","39","58","70","71","89","90"]],
  ["BRE","Bretagne",["22","29","35","56"]],
  ["CVL","Centre-Val de Loire",["18","28","36","37","41","45"]],
  ["COR","Corse",["2A","2B"]],
  ["GES","Grand Est",["08","10","51","52","54","55","57","67","68","88"]],
  ["HDF","Hauts-de-France",["02","59","60","62","80"]],
  ["IDF","Île-de-France",["75","77","78","91","92","93","94","95"]],
  ["NOR","Normandie",["14","27","50","61","76"]],
  ["NAQ","Nouvelle-Aquitaine",["16","17","19","23","24","33","40","47","64","79","86","87"]],
  ["OCC","Occitanie",["09","11","12","30","31","32","34","46","48","65","66","81","82"]],
  ["PDL","Pays de la Loire",["44","49","53","72","85"]],
  ["PAC","Provence-Alpes-Côte d'Azur",["04","05","06","13","83","84"]],
  ["OM","Outre-mer",["971","972","973","974","976"]],
];
function depsCibles(regions,deps){ const r=new Set(deps); regions.forEach(id=>{ const g=REGIONS.find(x=>x[0]===id); if(g) g[2].forEach(d=>r.add(d)); }); return [...r]; }
const NOM_DEP = Object.fromEntries(DEPS);

/* ---------- Plateformes de dématérialisation ---------- */
const PLATEFORMES = [
  {re:/marches-publics\.gouv\.fr/i, nom:"PLACE", compte:"DCE téléchargeable sans compte (identification facultative)"},
  {re:/maximilien\.fr/i, nom:"Maximilien", compte:"DCE téléchargeable sans compte (identification facultative)"},
  {re:/marches-publics\.info|aws-achat|aws-france/i, nom:"AWS-Achat", compte:"Compte gratuit souvent demandé pour le DCE"},
  {re:/achatpublic\.com/i, nom:"achatpublic", compte:"Compte gratuit demandé pour le DCE"},
  {re:/e-marchespublics\.com/i, nom:"e-marchespublics", compte:"Compte gratuit demandé pour le DCE"},
  {re:/marches-securises\.fr/i, nom:"Marchés sécurisés", compte:"Compte gratuit demandé pour le DCE"},
  {re:/megalis/i, nom:"Mégalis Bretagne", compte:"DCE souvent sans compte"},
  {re:/klekoon/i, nom:"Klekoon", compte:"Compte gratuit demandé pour le DCE"},
  {re:/local-trust/i, nom:"Local Trust", compte:"Compte gratuit demandé pour le DCE"},
  {re:/synapse-entreprises/i, nom:"Synapse", compte:""},
  {re:/ternum-bfc/i, nom:"Ternum BFC", compte:""},
  {re:/alsacemarchespublics/i, nom:"Alsace Marchés Publics", compte:""},
  {re:/marchespublics\.grandest|grandest\.fr/i, nom:"Grand Est", compte:""},
  {re:/projets-achats\.marches-publics/i, nom:"PLACE", compte:""},
  {re:/demat-ampa|ampmetropole/i, nom:"AMP Métropole", compte:""},
  {re:/atexo/i, nom:"Plateforme Atexo", compte:"DCE généralement sans compte"},
  {re:/boamp\.fr/i, nom:"BOAMP", compte:""},
];
/* Plateformes Atexo (PLACE, Maximilien, nombreuses plateformes régionales) :
   à partir du lien de consultation, on construit le lien direct du RC
   (téléchargeable sans compte) et celui de la page de retrait du DCE. */
const SERVEUR_DCE="https://vigie-marches-dce.onrender.com";
// Plateformes Atexo prises en charge par le serveur (doit suivre la liste du serveur)
const HOTES_ATEXO=/(^|\.)(marches-publics\.gouv\.fr|maximilien\.fr|e-megalisbretagne\.org|alsacemarchespublics\.eu|marchespublics\.grandest\.fr|marchespublics\.auvergnerhonealpes\.eu|marches-publics\.hautsdefrance\.fr|marchespublics\.nouvelle-aquitaine\.fr|marches\.ampmetropole\.fr|ternum-bfc\.fr|marches\.paysdelaloire\.fr)$/i;
/* Quand l'avis ne donne que l'accueil de la plateforme : le serveur retrouve la consultation par sa référence. */
function atexoParRecherche(m){
  for(const u of [m.urlDocs,m.urlDepot,m.urlProfil,...(m.urls||[])]){
    let x; try{ x=new URL(u); }catch(e){ continue; }
    if(!HOTES_ATEXO.test(x.hostname)) continue;
    const refs=[m.refDocs,m.refAcheteur].filter(r=>r&&r.length>=3&&r.length<=60&&!/^(LOT|ORG|PAR|RES|TPO)-\d+$/i.test(r)&&!/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(r)&&!/^(sans objet|n[ée]ant|n\/?a|non communiqu[ée])$/i.test(r.trim()));
    let lim=""; try{ if(m.limite) lim=new Date(m.limite).toLocaleDateString("sv-SE",{timeZone:"Europe/Paris"}); }catch(e){}
    const q="origine="+encodeURIComponent(x.origin)+(refs[0]?"&reference="+encodeURIComponent(refs[0]):"")+"&objet="+encodeURIComponent((m.objet||"").slice(0,200))+(lim?"&limite="+lim:"")+(m.acheteur?"&acheteur="+encodeURIComponent(m.acheteur.slice(0,120)):"");
    return {rc:SERVEUR_DCE+"/dce?quoi=rc&"+q, dceAuto:SERVEUR_DCE+"/dce?"+q, consultation:SERVEUR_DCE+"/dce?quoi=consultation&"+q, recherche:true};
  }
  return null;
}
function atexoLiens(url){
  if(!url) return null;
  let u; try{ u=new URL(url); }catch(e){ return null; }
  const p=u.searchParams;
  const org=p.get("orgAcronyme")||p.get("orgacronyme");
  if(!org) return null;
  let id=null, m=u.pathname.match(/\/consultation\/(\d+)/);
  if(m) id=m[1];
  else if(/^Entreprise\./.test(p.get("page")||"")){
    id=p.get("refConsultation")||p.get("id");
    if(id&&!/^\d+$/.test(id)){ try{ const d=atob(id); if(/^\d+$/.test(d)) id=d; else id=null; }catch(e){ id=null; } }
  }
  if(!id) return null;
  const base=u.origin+"/index.php?page=Entreprise.";
  return {
    rc: base+"EntrepriseDownloadReglement&id="+encodeURIComponent(btoa(id))+"&orgAcronyme="+encodeURIComponent(org),
    dce: base+"EntrepriseDemandeTelechargementDce&id="+id+"&orgAcronyme="+encodeURIComponent(org),
    consultation: u.origin+"/entreprise/consultation/"+id+"?orgAcronyme="+encodeURIComponent(org),
    dceAuto: SERVEUR_DCE+"/dce?origine="+encodeURIComponent(u.origin)+"&id="+id+"&org="+encodeURIComponent(org),
  };
}
function plateformeDe(url){
  if(!url) return null;
  for(const p of PLATEFORMES) if(p.re.test(url)) return p;
  try{ return {nom:new URL(url).hostname.replace(/^www\./,""), compte:""}; }catch(e){ return null; }
}

/* ---------- Stockage local ---------- */
const CLE_STATUTS="vigie.statuts.v1", CLE_FILTRES="vigie.filtres.v1", CLE_VISITE="vigie.visite.v1";
function lire(cle,defaut){ try{ const v=localStorage.getItem(cle); return v?JSON.parse(v):defaut; }catch(e){ return defaut; } }
function ecrire(cle,val){ try{ localStorage.setItem(cle,JSON.stringify(val)); return true; }catch(e){ return false; } }
let statuts = lire(CLE_STATUTS,{});
const visitePrecedente = lire(CLE_VISITE,null);
ecrire(CLE_VISITE,new Date().toISOString());

const LIB_STATUT = {lecture:"Lecture", reflexion:"En réflexion", reponse:"J'y réponds"};
