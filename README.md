# Vigie Marchés

Veille des appels d'offres publics à partir de l'API open data du BOAMP.

- `index.html` : l'application (un seul fichier, aucune compilation).
- `render.yaml` : déploiement en site statique sur Render (Blueprint).

Les statuts de suivi (Lecture, En réflexion, J'y réponds) sont enregistrés dans le navigateur de chaque utilisateur.
- `server/` : serveur Render `vigie-marches-dce` (retrait anonyme du DCE, CAPTCHA image relayé à l'utilisateur, analyse du RC, dépôt OneDrive).
- `extension/` : extension Chrome/Edge « Vigie Marchés » qui télécharge le DCE avec les sessions déjà ouvertes de l'utilisateur sur les plateformes et les garde actives. Installation : `extension/LISEZMOI.html` (le zip se télécharge depuis l'onglet Mes marchés).
