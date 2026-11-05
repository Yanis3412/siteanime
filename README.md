# Liste — mangas et animes

Site de suivi de mangas et d'animes entre potes : chaque profil a sa liste, protégée par un code.
Les infos (couvertures, nombre de chapitres/épisodes, saisons, sorties) viennent de MyAnimeList via l'API Jikan.

## Fonctionnalités

- Profils protégés par un code de 4 à 6 chiffres, mode lecture seule pour consulter la liste d'un autre
- Mangas, animes (avec détection des saisons), watchlist, recommandations entre profils, liens vers les sites
- Progression rapide depuis la grille ou depuis la page de chaque titre, note perso, lien officiel de lecture
- « Nouveautés » : nouveaux chapitres/épisodes et prochaines sorties estimées
- « Tout mettre à jour », export/import de sa liste en JSON (compatible avec les exports de l'ancienne version)
- Thème sombre ou clair, version mobile

## Structure

```
index.html            Point d'entrée Vite
src/
  App.jsx             Routes (/mangas, /animes, /watchlist, /recommandations, /sites, /oeuvre/:id)
  state/              État global (profils, session, enregistrement automatique), toasts et thème
  pages/              Écrans
  components/         Barre du haut, cartes, dialogues…
  lib/                API du site, Jikan, calculs de progression, export/import
  styles/             Design tokens et styles
api/                  Fonctions serverless Vercel
  profiles.js         Liste et création des profils
  profile.js          Renommer, changer le code, supprimer
  session.js          Connexion / déconnexion
  library.js          Lecture et enregistrement d'une liste
  admin.js            Réimport des données de l'ancienne version (admin)
  _lib/               Stockage, sécurité, modèle de données (non exposé)
scripts/dev-seed.mjs  Fausses données pour tester en local
```

## Données et sécurité

Les données sont dans Upstash Redis :

- `v2:profile:<id>` : nom, rôle, code **haché** (scrypt). Le code n'est jamais renvoyé par l'API.
- `v2:library:<id>` : la liste du profil, avec un numéro de version pour éviter qu'un appareil écrase les changements d'un autre.
- `v2:session:<jeton>` : sessions (60 jours). Changer son code déconnecte les autres appareils.
- Après 8 codes faux, le profil est bloqué 15 minutes.
- `anime-profiles` : les données de l'ancienne version. Elles ne sont **jamais modifiées** et servent de sauvegarde.

Au premier chargement, la nouvelle version importe automatiquement les profils et listes de l'ancienne version.
Chacun garde son code.

## Variables d'environnement (Vercel)

| Variable | Rôle |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` | URL REST de la base Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | Jeton de la base Upstash |

Elles doivent être actives pour **Production** et **Preview** (Settings → Environment Variables).

## Mise en ligne de la refonte

1. Tester l'URL de preview de la branche `refonte`.
2. Fusionner la branche dans `main` : Vercel déploie la nouvelle version.
3. Se connecter avec le profil administrateur, puis menu du profil → **Réimporter l'ancienne version**,
   pour récupérer les changements faits sur l'ancien site pendant les tests.
4. Changer le code administrateur : l'ancien était écrit dans le code public du site.

## Développement local

```bash
npm install
npm run seed:dev   # fausses données (codes : Admin 1111, Sam 2222)
npm run dev        # http://localhost:5173
```

Sans variables Upstash, les fonctions `/api` utilisent un faux stockage dans `.dev-kv.json`.

## Licence

MIT
