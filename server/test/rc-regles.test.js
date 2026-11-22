// Lecture du règlement de consultation par règles, sur des extraits au format des RC réels (PLACE, Maximilien, AWS).
const test = require("node:test");
const assert = require("node:assert/strict");
const { analyserTexte } = require("../regles");

const RC = `REGLEMENT DE LA CONSULTATION
SOMMAIRE
Article 1 - Objet de la consultation ........................ 3
Article 2 - Conditions de la consultation .................... 4

Article 1 - Objet de la consultation
La présente consultation concerne les travaux de réfection des menuiseries extérieures et de ravalement du groupe scolaire Jean Jaurès.

Article 2 - Conditions de la consultation
2.1 Procédure
La consultation est passée selon la procédure adaptée ouverte en application des articles L.2123-1 et R.2123-1 du Code de la commande publique.
2.2 Durée du marché
Le délai d'exécution est de 6 mois à compter de la date fixée par l'ordre de service.
2.3 Variantes
Les variantes sont interdites.
2.4 Prestations supplémentaires éventuelles
Sans objet.
2.5 Visite des lieux
Une visite sur site est obligatoire. Elle aura lieu le 08/12/2026 à 10h00.
2.6 Délai de validité des offres
Le délai de validité des offres est fixé à 120 jours à compter de la date limite de réception des offres.

Article 3 - Contenu du dossier de réponse
3.1 Pièces de la candidature
- Le formulaire DC1 ou DUME
- Le formulaire DC2
- Les certificats de qualification professionnelle (Qualibat)
- Une attestation d'assurance responsabilité civile et décennale
3.2 Pièces de l'offre
- L'acte d'engagement (AE) complété
- Le bordereau des prix unitaires (BPU) et le détail quantitatif estimatif (DQE)
- Un mémoire technique

Article 4 - Jugement des offres
Les offres seront jugées selon les critères suivants avec leur pondération :
Critère n°1 : Prix des prestations : 60 points
Critère n°2 : Valeur technique : 40 points
  - Méthodologie et organisation du chantier : 25 points
  - Moyens humains et matériels affectés : 15 points
Le pouvoir adjudicateur se réserve la possibilité de négocier avec les candidats.

Article 5 - Conditions d'envoi des offres
Les offres devront être remises avant le 15/12/2026 à 12h00.
`;

test("RC au format réel : critères imbriqués, pièces, options et dates", () => {
  const r = analyserTexte(RC);
  assert.match(r.objet || "", /menuiseries extérieures/);
  assert.match(r.procedure || "", /adaptée/i);
  assert.equal(r.date_limite, "15/12/2026 à 12h00");
  assert.match(r.duree || "", /6 mois/);
  assert.match(r.validite_offres || "", /120 jours/);
  assert.equal(r.variantes, "Variantes interdites");
  assert.match(r.pse || "", /aucune/i);
  assert.equal(r.visite_type, "obligatoire");
  assert.equal(r.visite_date, "08/12/2026");
  assert.ok(r.negociation, "négociation lue");
  const noms = r.criteres.map(c => c.critere + " " + c.ponderation).join(" | ");
  assert.equal(r.criteres.length, 2, noms);
  assert.match(r.criteres[0].critere, /Prix/);
  assert.match(r.criteres[1].critere, /Valeur technique/);
  assert.equal(r.criteres[1].sous_criteres.length, 2);
  assert.equal(r.criteres_total, 100);
  assert.ok(r.candidature.some(p => /DC1|DUME/.test(p)), r.candidature.join(" | "));
  assert.ok(r.offre.some(p => /acte d'engagement/i.test(p)), r.offre.join(" | "));
  assert.ok(r.offre.some(p => /mémoire technique/i.test(p)), r.offre.join(" | "));
  // Le sommaire (lignes à points de suite) n'est pas pris pour l'objet.
  assert.doesNotMatch(r.objet, /\.{4}/);
});
