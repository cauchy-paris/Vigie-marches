# Vigie Marchés

Veille des appels d'offres publics à partir de l'API open data du BOAMP.

- `index.html` : la page de l'application (aucune compilation). Le style est dans `css/vigie.css` et le code dans `js/`, un fichier par fonction, chargés dans cet ordre par `index.html` :
  `referentiels` (métiers, départements, plateformes, stockage local), `avis-boamp` (lecture des avis), `recherche`, `encarts`, `dossier-reponse`, `microsoft`, `dce`, `tableau-excel`, `ajout-lien`, `interface` (statuts, filtres), `drive`, `alertes-mail`, `rappels`, `import-auto`, `rectificatifs`, `pertinence`, `historique-acheteur`, `suivi-offres`, `decp`, puis `demarrage` (toujours en dernier). Les fichiers partagent leurs fonctions comme s'ils n'en faisaient qu'un. Après une modification, changer le numéro `?v=` des balises `<script>` et `<link>` pour que les navigateurs prennent la nouvelle version.
- `render.yaml` : déploiement en site statique sur Render (Blueprint).

Les statuts de suivi (Lecture, En réflexion, J'y réponds) et les marchés ajoutés par lien (bouton « Ajouter un marché par son lien » : avis BOAMP retrouvé par le lien, sinon lecture de la page par `server/fiche.js`) sont enregistrés dans le navigateur de chaque utilisateur.
- `server/` : serveur Render `vigie-marches-dce` (retrait anonyme du DCE, CAPTCHA image relayé à l'utilisateur, analyse du RC, dépôt OneDrive).
- `extension/` : extension Chrome/Edge « Vigie Marchés » qui télécharge le DCE avec les sessions déjà ouvertes de l'utilisateur sur les plateformes et les garde actives. Installation : `extension/LISEZMOI.html` (le zip se télécharge depuis l'onglet Mes marchés).
- Boutons du bandeau « Connecter mon drive » (OneDrive/SharePoint en ligne, ou dossier synchronisé du PC : Google Drive, Dropbox, iCloud…) et « Importer les alertes mail » (Outlook via Microsoft Graph dans le navigateur ; Gmail et autres boîtes IMAP via `server/mail.js`, route `/mail/imap`, sans rien stocker ; copier-coller ou fichiers .eml). Chaque utilisateur connecte ses propres comptes, gardés dans son navigateur. Procédure pas à pas : `aide/connexions.html`.
- Comptes et mot de passe : `comptes.js` (écran de connexion, menu du compte, gestion des comptes par l'administrateur) et `server/comptes.js` (routes `/compte/...`). Le serveur DCE refuse toute demande sans jeton de session (en-tête `X-Vigie`, ou `?acces=` sur les liens) et toute origine autre que le site Vigie. Comptes et sociétés clientes (rôles : administrateur Vigie, administrateur de la société, utilisateur ; nombre de comptes par société ; accès suspendu) gardés dans une base Postgres si `DATABASE_URL` est renseignée (`server/stockage.js`, tables `vigie_societes`, `vigie_comptes`, copie quotidienne dans `vigie_sauvegardes`, 30 jours), sinon dans la variable Render `VIGIE_COMPTES` comme avant. Au premier démarrage sur une base vide, `VIGIE_COMPTES` y est recopiée (c'est aussi la façon de restaurer une sauvegarde). Mots de passe hachés avec scrypt. Procédure : `aide/comptes.html`.
- Travail d'équipe dans une société (`js/equipe.js`, `server/equipe.js`, table `vigie_equipe`) : « J'y réponds » prend le marché pour un seul collaborateur (les autres voient « 👤 Léa » et ne peuvent pas le prendre), l'administrateur de la société l'attribue à un collaborateur depuis l'encart ou le tableau de bord, bouton « Offre déposée », étape de l'offre partagée, bloc « Équipe : qui travaille sur quoi » (taux de réussite par collaborateur, récapitulatif Excel), colonne « Collaborateur désigné » dans `00_Suivi des marchés.xlsx`. Société d'une seule personne : rien ne change à l'écran, sauf le bouton « Offre déposée ».
- Synchronisation entre appareils : `synchro.js` copie les clés `vigie.*` (statuts, marchés manuels, filtres, dossier OneDrive, réglages mail, rappels…) dans le OneDrive de l'utilisateur (`/me/drive/special/approot`, un fichier par compte Vigie), fusion clé par clé (la plus récente gagne). Mot de passe IMAP chiffré par le serveur (`/compte/chiffrer`, AES-GCM, clé propre au compte) et relu seulement par `/mail/imap`.
- Mot de passe oublié : `/compte/oubli` envoie un lien signé (`#reinit=`, 1 h, usage unique) par l'API gratuite Brevo (`server/envoi.js`, variables `BREVO_API_KEY` et `MAIL_EXPEDITEUR` ; Render gratuit bloque les ports SMTP) ; `/compte/reinitialisation` enregistre le nouveau mot de passe.

## Tests automatiques

Lancés par GitHub à chaque push et sur chaque PR (`.github/workflows/tests.yml`). En local :

```
cd server && npm ci && cd ..
npm ci && npx playwright install chromium
npm test
```

- `server/test/` : comptes et sociétés, en mode variable et en mode base Postgres si `TEST_DATABASE_URL` pointe vers un serveur Postgres de test (installation, connexion, sessions, droits, blocage après trop d'essais), sécurité du serveur (origine, session obligatoire), lecture du RC, des fiches de plateformes et des alertes mail. Le serveur est lancé sur un port libre, sans aucun appel extérieur.
- `tests/site/` : la page dans Chromium, avec le BOAMP et le serveur simulés (`tests/site/donnees/boamp.json`) : ouverture sans erreur, écran « Gérer les comptes » avec le vrai serveur, encarts, statuts, onglets et fenêtres, lecture des avis (MAPA, FNSimple, eForms), requête envoyée au BOAMP, plateformes reconnues, alertes mail, nom du dossier de réponse, note de pertinence.
