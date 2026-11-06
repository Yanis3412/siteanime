# Coloriseur

Petit programme à faire tourner sur un PC Windows. Il colorise les chapitres demandés sur le site
(bouton **Coloriser les non lus** sur la page d'un manga, ou **Coloriser** dans le menu d'un chapitre)
avec l'IA de colorisation de [manga-image-translator](https://github.com/zyddnys/manga-image-translator).

Avec une carte graphique **NVIDIA**, il s'en sert ; avec une autre carte (AMD, Intel), il tourne sur le
**processeur** : plus lent, mais le résultat est le même.

Tant qu'il n'est pas lancé, les demandes restent en attente sur le site.

## Avant de commencer

- Le **code du profil administrateur** du site.
- Environ **15 Go** d'espace disque libre (Python, PyTorch, modèle de colorisation).
- Avec une carte NVIDIA seulement : un pilote récent (version 560 ou plus).

## Installation

1. Télécharge le site : https://github.com/Yanis3412/siteanime/archive/refs/heads/main.zip et décompresse-le.
2. Ouvre le dossier `traducteur` et double-clique sur **`installer.bat`**.
   - Si Windows affiche « Windows a protégé votre ordinateur » : *Informations complémentaires* → *Exécuter quand même*.
   - L'installation ajoute si besoin Python 3.12, Git et les outils de compilation C++ de Microsoft
     (une fenêtre administrateur peut s'ouvrir), puis PyTorch et manga-image-translator. Compte 20 à 40 minutes.
3. À la fin, il demande le code administrateur (il ne s'affiche pas pendant la saisie).

On peut relancer `installer.bat` à tout moment : il saute ce qui est déjà fait et met à jour l'outil.

## Utilisation

Double-clique sur **`lancer.bat`** et laisse la fenêtre ouverte. Le coloriseur prend les chapitres un par un ;
le site affiche « Coloriseur en ligne » et l'avancement page par page. Dans la liseuse, un sélecteur
permet de passer de la version originale (VO) à la version **Couleur**.

Le **premier chapitre** est plus long : le modèle de colorisation se télécharge une seule fois.
Ensuite, compte quelques secondes par page avec une carte NVIDIA, et environ une minute par page
sur le processeur. Le PC reste utilisable, mais il est plus lent pendant le travail.

`Ctrl+C` arrête le coloriseur ; le chapitre en cours est remis en attente.

## En cas de problème

- Tout est noté dans `traducteur.log`, dans ce dossier.
- Se reconnecter (après un changement du code admin) : double-clique sur **`configurer.bat`**.
- « Mémoire GPU insuffisante » (CUDA out of memory, carte NVIDIA) : ferme les jeux et autres programmes qui utilisent la carte.
- Sur le processeur, il faut au moins 8 Go de mémoire vive ; ferme les gros programmes si le PC rame trop.
- Une page que l'outil n'arrive pas à traiter reste en version originale dans le chapitre colorisé.

## Réactiver la traduction (optionnel)

Le code de traduction anglais → français avec DeepL est toujours là mais désactivé. Pour le remettre :
ajouter `fr` et `fr-color` dans `ENABLED_KINDS` (`api/jobs.js`) et `OFFERED`
(`src/components/ChaptersSection.jsx`), puis ajouter `"deepl_key": "…"` dans `config.json` sur le PC.
