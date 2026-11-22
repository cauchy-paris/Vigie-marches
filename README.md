# Vigie Marchés

Veille des appels d'offres publics à partir de l'API open data du BOAMP.

- `index.html` : l'application (un seul fichier, aucune compilation).
- `render.yaml` : déploiement en site statique sur Render (Blueprint).

Les statuts de suivi (Lecture, En réflexion, J'y réponds) et les marchés ajoutés par lien (bouton « Ajouter un marché par son lien » : avis BOAMP retrouvé par le lien, sinon lecture de la page par `server/fiche.js`) sont enregistrés dans le navigateur de chaque utilisateur.
- `server/` : serveur Render `vigie-marches-dce` (retrait anonyme du DCE, CAPTCHA image relayé à l'utilisateur, analyse du RC, dépôt OneDrive).
- `extension/` : extension Chrome/Edge « Vigie Marchés » qui télécharge le DCE avec les sessions déjà ouvertes de l'utilisateur sur les plateformes et les garde actives. Installation : `extension/LISEZMOI.html` (le zip se télécharge depuis l'onglet Mes marchés).
- Boutons du bandeau « Connecter mon drive » (OneDrive/SharePoint en ligne, ou dossier synchronisé du PC : Google Drive, Dropbox, iCloud…) et « Importer les alertes mail » (Outlook via Microsoft Graph dans le navigateur ; Gmail et autres boîtes IMAP via `server/mail.js`, route `/mail/imap`, sans rien stocker ; copier-coller ou fichiers .eml). Chaque utilisateur connecte ses propres comptes, gardés dans son navigateur. Procédure pas à pas : `aide/connexions.html`.
- Comptes et mot de passe : `comptes.js` (écran de connexion, menu du compte, gestion des comptes par l'administrateur) et `server/comptes.js` (routes `/compte/...`). Le serveur DCE refuse toute demande sans jeton de session (en-tête `X-Vigie`, ou `?acces=` sur les liens) et toute origine autre que le site Vigie. Comptes gardés dans la variable Render `VIGIE_COMPTES` (scrypt), mise à jour automatique avec `RENDER_API_KEY`. Procédure : `aide/comptes.html`.
- Synchronisation entre appareils : `synchro.js` copie les clés `vigie.*` (statuts, marchés manuels, filtres, dossier OneDrive, réglages mail, rappels…) dans le OneDrive de l'utilisateur (`/me/drive/special/approot`, un fichier par compte Vigie), fusion clé par clé (la plus récente gagne). Mot de passe IMAP chiffré par le serveur (`/compte/chiffrer`, AES-GCM, clé propre au compte) et relu seulement par `/mail/imap`.
- Mot de passe oublié : `/compte/oubli` envoie un lien signé (`#reinit=`, 1 h, usage unique) par l'API gratuite Brevo (`server/envoi.js`, variables `BREVO_API_KEY` et `MAIL_EXPEDITEUR` ; Render gratuit bloque les ports SMTP) ; `/compte/reinitialisation` enregistre le nouveau mot de passe.
