# Liste — mangas et animes

Site de suivi de mangas et d'animes entre potes : chaque profil a sa liste, protégée par un code.
Les infos (couvertures, nombre de chapitres/épisodes, saisons, sorties) viennent d'AniList, avec MyAnimeList en secours.

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
  App.jsx             Routes (/mangas, /animes, /watchlist, /recommandations, /sites, /oeuvre/:id,
                      /oeuvre/:id/chapitre/:num pour la liseuse)
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
  chapters.js         Chapitres importés : liste, envoi, lecture, suppression
  jobs.js             File de colorisation traitée par le programme du PC
  admin.js            Réimport des données de l'ancienne version (admin)
  _lib/               Stockage, sécurité, modèle de données (non exposé)
scripts/dev-seed.mjs  Fausses données pour tester en local
traducteur/           Programme Windows qui colorise les chapitres (voir son README)
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

## Chapitres de manga (Cloudflare R2)

Sur la page d'un manga, la section **Chapitres** permet d'importer ses propres fichiers
(CBZ, ZIP, PDF, dossiers d'images ; les CBR/RAR ne sont pas pris en charge) et de les lire dans la liseuse :
page par page ou en défilement, sens japonais ou occidental, plein écran, reprise à la dernière page.
Finir un chapitre met à jour la progression du titre. Les chapitres de chaque profil sont privés.

Les images sont envoyées directement du navigateur vers R2 grâce à des liens signés valables quelques minutes
(Vercel ne sert que de guichet). Les pages PNG trop lourdes sont converties en WebP avant l'envoi.
Le site refuse les imports au-delà de 9,5 Go au total, pour rester dans l'offre gratuite de R2 (10 Go).

**Captures de page entière** (GoFullPage, etc.) : le PDF ou l'image très haute est reconnu à l'import et
le bouton **Découper par planche** ouvre un éditeur (`src/lib/strip.js`, `src/components/StripEditor.jsx`).
Les morceaux sont recollés, la colonne du manga est repérée, l'en-tête et le bas du site sont écartés et des
coupures sont proposées ; on les ajoute, déplace ou retire avant d'importer.

**Nettoyage** : la date d'import de chaque chapitre est enregistrée (affichée dans la liste). L'administrateur
peut supprimer d'un coup, sur tous les profils, les chapitres importés il y a plus de 2 mois
(menu du profil → *Supprimer les chapitres de plus de 2 mois*, `api/admin.js`).

### Mise en place

1. Créer un compte Cloudflare et activer R2.
2. Créer un bucket, par exemple `liste-chapitres`.
3. Dans les réglages du bucket, ajouter cette règle CORS :

   ```json
   [
     {
       "AllowedOrigins": ["https://liste-blue.vercel.app", "https://liste-git-refonte-aohacs-projects.vercel.app", "http://localhost:5173"],
       "AllowedMethods": ["GET", "PUT", "HEAD"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

4. Créer un jeton d'API R2 avec les droits « lecture et écriture d'objets », limité à ce bucket.
   Noter l'Access Key ID, la Secret Access Key et l'Account ID.
5. Ajouter dans Vercel (Production et Preview) :

   | Variable | Valeur |
   | --- | --- |
   | `R2_ACCOUNT_ID` | Account ID Cloudflare |
   | `R2_ACCESS_KEY_ID` | Access Key ID du jeton |
   | `R2_SECRET_ACCESS_KEY` | Secret Access Key du jeton |
   | `R2_BUCKET` | Nom du bucket |
   | `R2_MAX_BYTES` | Optionnel : limite totale en octets (9,5 Go par défaut) |

6. Redéployer. Tant que ces variables manquent, la section Chapitres l'indique simplement.

## Colorisation

Sur la page d'un manga, **Coloriser les non lus** (ou **Coloriser** dans le menu d'un chapitre) demande
une version en couleur. Les demandes passent par une file d'attente (`api/jobs.js`) traitée par le
programme du dossier [`traducteur/`](traducteur/README.md), à lancer sur un PC Windows
(manga-image-translator ; carte NVIDIA si présente, sinon processeur). Les pages produites sont rangées
dans R2 à côté de l'original, et la liseuse propose VO / Couleur. La traduction DeepL existe dans le code
mais est désactivée (voir le README du dossier `traducteur/`).

## Fiches des œuvres

Les infos (titres, couvertures, chapitres, saisons, prochains épisodes) viennent d'**AniList**,
avec **Jikan (MyAnimeList)** en secours si AniList ne répond pas (`src/lib/meta.js`).

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

Sans variables Upstash, les fonctions `/api` utilisent un faux stockage dans `.dev-kv.json`,
et sans variables R2 les pages de chapitres sont rangées dans `.dev-blobs/`.

## Licence

MIT
