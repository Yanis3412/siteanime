// Explications pour installer le site comme une appli, quand le navigateur ne le propose pas lui-même
// (iPhone : toujours à la main, depuis le menu Partager).
import { Ellipsis, Share, SquarePlus } from 'lucide-react';
import { Dialog } from './ui/Dialog.jsx';
import { isIos, isIosOtherBrowser } from '../lib/pwa.js';

export function InstallDialog({ open, onClose }) {
    const ios = isIos();
    const otherBrowser = isIosOtherBrowser();
    return (
        <Dialog open={open} onClose={onClose} title="Installer l’appli" size="sm">
            {ios ? (
                <>
                    <ol className="install-steps">
                        {otherBrowser ? (
                            <li>
                                Touche le bouton <strong>Partager</strong> <Share size={16} aria-hidden="true" className="install-steps__icon" /> dans la barre d’adresse.
                            </li>
                        ) : (
                            <li>
                                Dans Safari, touche le bouton <strong>trois points</strong> <Ellipsis size={16} aria-hidden="true" className="install-steps__icon" /> à droite de la barre d’adresse, puis{' '}
                                <strong>Partager</strong> <Share size={16} aria-hidden="true" className="install-steps__icon" />.
                                <span className="install-steps__note">Sur les iPhone plus anciens, le bouton Partager est directement en bas de l’écran.</span>
                            </li>
                        )}
                        <li>
                            Fais défiler et choisis <strong>Sur l’écran d’accueil</strong> <SquarePlus size={16} aria-hidden="true" className="install-steps__icon" />.
                        </li>
                        <li>
                            Laisse activée l’option pour l’ouvrir comme une app web, puis touche <strong>Ajouter</strong>.
                        </li>
                    </ol>
                    <p className="dialog__text">L’icône Liste apparaît sur ton écran d’accueil. Ouvre-la et tape ton code une première fois : l’appli garde sa propre connexion.</p>
                </>
            ) : (
                <p className="dialog__text">
                    Dans le menu de ton navigateur, choisis <strong>Installer l’application</strong> ou <strong>Ajouter à l’écran d’accueil</strong>. Si tu ne vois aucune des deux, ouvre le
                    site dans Chrome ou Edge.
                </p>
            )}
            <div className="form__actions">
                <button className="btn btn--secondary" onClick={onClose}>
                    Fermer
                </button>
            </div>
        </Dialog>
    );
}
