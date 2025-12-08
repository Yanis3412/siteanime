# Liste Manga/Anime

Une application web pour tracker votre progression dans les mangas et animes avec persistance des données via une API serverless.

## Fonctionnalités

- ✨ Tracker votre progression pour les mangas et animes
- 🎯 Ajouter des favoris
- 📊 Afficher la progression globale
- 🔄 Récupération automatique des informations depuis MyAnimeList
- 💾 Sauvegarde persistante des données dans un fichier JSON
- 🎨 Interface moderne et responsive

## Structure

```
siteanime/
├── index.html          # Structure HTML
├── styles.css          # Styles CSS
├── script.js           # Logique JavaScript
├── data.json           # Fichier de données (créé automatiquement)
├── api/
│   └── data.js         # API serverless pour Vercel
├── vercel.json         # Configuration Vercel
├── package.json        # Configuration Node.js
└── README.md           # Ce fichier
```

## Déploiement sur Vercel

### Préalables
- Compte GitHub
- Compte Vercel (gratuit sur https://vercel.com)

### Étapes de déploiement

1. **Initialiser un dépôt Git**
   ```bash
   cd siteanime
   git init
   git add .
   git commit -m "Initial commit"
   ```

2. **Pousser sur GitHub**
   - Créez un dépôt sur GitHub
   - Poussez votre code :
   ```bash
   git remote add origin https://github.com/votre-username/siteanime.git
   git branch -M main
   git push -u origin main
   ```

3. **Déployer sur Vercel**
   - Allez sur https://vercel.com/import
   - Sélectionnez votre dépôt GitHub
   - Cliquez sur "Deploy"

4. **Configuration (optionnel)**
   - Les fichiers `vercel.json` et l'API `/api/data.js` sont configurés automatiquement
   - Les données seront sauvegardées dans le dossier `public/`

## Développement local

### Avec Python
```bash
python -m http.server 8000
# Ouvrez http://localhost:8000
```

### Avec Node.js (via http-server)
```bash
npx http-server
# Ouvrez http://localhost:8080
```

## Notes

- Les données sont sauvegardées automatiquement chaque fois que vous modifiez votre liste
- En cas d'erreur réseau, l'application bascule vers le localStorage local
- L'API MyAnimeList (Jikan) est utilisée pour récupérer les informations des animes/mangas

## Utilisation

1. Entrez le titre d'un anime ou manga
2. Sélectionnez le type (Anime ou Manga)
3. Cliquez sur "Ajouter"
4. Utilisez les boutons + et - pour tracker votre progression
5. Cliquez sur l'étoile pour ajouter aux favoris
6. Les changements sont sauvegardés automatiquement

## API

L'API serverless expose un endpoint :

**GET /api/data** - Récupère les données actuelles
**POST /api/data** - Sauvegarde les données

Format des données :
```json
{
  "library": [],
  "imageCache": {},
  "malInfoCache": {},
  "lastUpdateCheck": 0
}
```

## License

MIT
