// Lecture automatique : règlement de consultation, fiche d'une plateforme, alertes mail, noms de fichiers.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { analyserTexte } = require("../regles");
const { extraireFiche, lireDate } = require("../fiche");
const { estAlerte, estMessageSuivi } = require("../mail");
const { propre } = require("../onedrive");

const RC = `REGLEMENT DE LA CONSULTATION
Objet : Travaux de rénovation des réseaux CVC
Procédure adaptée en application des articles L.2123-1 et R.2123-1 du code de la commande publique.
Le marché est un accord-cadre à bons de commande, montant maximum de 850 000 € HT.
Durée du marché : 24 mois à compter de la notification.
Lot 1 : Chauffage ventilation
Lot 2 : Plomberie
Critères de jugement des offres :
Prix : 60 %
Valeur technique : 40 %
Une visite des lieux est obligatoire.
Qualification Qualibat 5312 ou équivalent.
Date limite de réception des offres : 15/12/2026 à 12h00`;

test("analyse du RC par règles", () => {
  const r = analyserTexte(RC);
  assert.match(r.type_marche, /^Travaux/);
  assert.match(r.type_marche, /Accord-cadre/);
  assert.match(r.procedure, /adaptée/);
  assert.deepEqual(r.lots.map(l => l.intitule), ["Chauffage ventilation", "Plomberie"]);
  assert.deepEqual(r.criteres.map(c => [c.critere, c.ponderation]), [["Prix", "60 %"], ["Valeur technique", "40 %"]]);
  assert.equal(r.montant_max, "850 000 € HT");
  assert.match(r.duree, /24 mois/);
  assert.equal(r.visite_type, "obligatoire");
  assert.ok(r.qualifications.some(q => /Qualibat 5312/.test(q)));
  assert.ok(r.corps_etat.includes("Plomberie") && r.corps_etat.includes("Chauffage"));
  assert.match(r.date_limite, /15\/12\/2026/);
  assert.match(r.synthese, /2 lots/);
});

test("lecture des dates (heure de Paris)", () => {
  assert.equal(lireDate("15/12/2026 à 12h00"), "2026-12-15T11:00:00.000Z");
  assert.equal(lireDate("3 janvier 2027"), "2027-01-02T23:00:00.000Z");
  assert.equal(lireDate("pas de date"), "");
});

test("fiche d'une consultation lue sur la page de la plateforme", () => {
  const r = extraireFiche(`<html><head><title>Détail</title></head><body><h1>Travaux de peinture du gymnase municipal</h1>
    <p>Organisme : Ville de Lyon</p><p>Date limite de remise des plis : 10/01/2027 16:00</p><p>Référence : 2026-PEINT-04</p></body></html>`, "https://www.e-marchespublics.com/x");
  assert.equal(r.objet, "Travaux de peinture du gymnase municipal");
  assert.equal(r.acheteur, "Ville de Lyon");
  assert.equal(r.limite, "2027-01-10T15:00:00.000Z");
  assert.equal(r.reference, "2026-PEINT-04");
});

test("tri des mails : alertes et messages sur une consultation suivie", () => {
  assert.equal(estAlerte("alerte@boamp.fr", "Votre alerte BOAMP"), true);
  assert.equal(estAlerte("ami@gmail.com", "Salut"), false);
  assert.equal(estAlerte("noreply@marches-publics.gouv.fr", "Votre mot de passe"), false);
  assert.equal(estMessageSuivi("noreply@marches-publics.gouv.fr", "Nouvelle question sur la consultation"), true);
  assert.equal(estMessageSuivi("ami@gmail.com", "Nouvelle question"), false);
});

test("noms de dossiers et de fichiers acceptés par OneDrive", () => {
  assert.equal(propre("  Lot 1 : CVC / Plomberie?  "), "Lot 1 CVC Plomberie");
  assert.equal(propre(""), "fichier");
  assert.ok(propre("x".repeat(300)).length <= 200);
});
