# Traducteur

Petit programme à faire tourner sur un PC Windows avec une carte graphique **NVIDIA**.
Il traite les demandes faites sur le site (bouton **Traduire** sur la page d'un manga) :
traduction anglais → français avec DeepL, colorisation, ou les deux.
Il s'appuie sur [manga-image-translator](https://github.com/zyddnys/manga-image-translator).

Tant qu'il n'est pas lancé, les demandes restent en attente sur le site.

## Avant de commencer

- Une **clé API DeepL gratuite** : crée un compte sur https://www.deepl.com/fr/pro-api (offre « DeepL API Free »,
  500 000 caractères par mois, soit environ 100 chapitres). La clé se trouve ensuite dans
  https://www.deepl.com/fr/your-account/keys et se termine par `:fx`.
- Le **code du profil administrateur** du site.
- Environ **15 Go** d'espace disque libre (Python, PyTorch, modèles).
- Un pilote NVIDIA récent (version 560 ou plus).

## Installation

1. Télécharge le site : https://github.com/Yanis3412/siteanime/archive/refs/heads/main.zip et décompresse-le.
2. Ouvre le dossier `traducteur` et double-clique sur **`installer.bat`**.
   - Si Windows affiche « Windows a protégé votre ordinateur » : *Informations complémentaires* → *Exécuter quand même*.
   - L'installation ajoute si besoin Python 3.12, Git et les outils de compilation C++ de Microsoft
     (une fenêtre administrateur peut s'ouvrir), puis PyTorch et manga-image-translator. Compte 20 à 40 minutes.
3. À la fin, il demande la clé DeepL et le code administrateur.

On peut relancer `installer.bat` à tout moment : il saute ce qui est déjà fait et met à jour le traducteur.

## Utilisation

Double-clique sur **`lancer.bat`** et laisse la fenêtre ouverte. Le traducteur prend les demandes une par une ;
le site affiche « Traducteur en ligne » et l'avancement page par page.

Le **premier chapitre** est plus long : les modèles (quelques Go) se téléchargent une seule fois.
Ensuite, compte environ 10 à 30 secondes par page sur une RTX 2050.

`Ctrl+C` arrête le traducteur ; le chapitre en cours est remis en attente.

## En cas de problème

- Tout est noté dans `traducteur.log`, dans ce dossier.
- Changer la clé DeepL ou se reconnecter (après un changement du code admin) : double-clique sur **`configurer.bat`**.
- « Mémoire GPU insuffisante » (CUDA out of memory) : ferme les jeux et autres programmes qui utilisent la carte.
- Une page que l'outil n'arrive pas à traiter reste en version originale dans le chapitre traduit.
