// « Meh » : range le titre dans la section « Meh », avec une raison facultative
// que les autres profils peuvent lire. Sert aussi à modifier la raison plus tard.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Dialog } from './ui/Dialog.jsx';
import { useApp } from '../state/app.jsx';
import { useUi } from '../state/ui.jsx';

export const REASON_MAX = 1000;

export function DislikeDialog({ item, open, onClose }) {
    // Rendue à la racine de la page, pour ne pas hériter des styles de la carte.
    return createPortal(
        <Dialog open={open} onClose={onClose} title={item.disliked ? 'Pourquoi c’est meh ?' : 'Meh'} description={item.title} size="sm">
            {open && <DislikeForm item={item} onClose={onClose} />}
        </Dialog>,
        document.body,
    );
}

function DislikeForm({ item, onClose }) {
    const { updateItem } = useApp();
    const { toast } = useUi();
    const [reason, setReason] = useState(item.dislikedReason || '');

    const submit = (e) => {
        e.preventDefault();
        const text = reason.trim();
        if (item.disliked) {
            updateItem(item.id, { dislikedReason: text });
            toast('Raison enregistrée.', { tone: 'success' });
        } else {
            // Watchlist, Recommandé et Meh s'excluent.
            updateItem(item.id, { disliked: true, dislikedReason: text, dislikedAt: Date.now(), recommended: false, fav: false });
            toast(`${item.title} est rangé dans « Meh ».`);
        }
        onClose();
    };

    return (
        <form className="dislike-form" onSubmit={submit}>
            <label className="field">
                <span className="field__label">Pourquoi ? (facultatif)</span>
                <textarea
                    className="input dislike-form__input"
                    value={reason}
                    maxLength={REASON_MAX}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Le rythme, la fin, les personnages…"
                    autoFocus
                />
                <span className="field__hint">Visible par tous les profils dans « Meh ».</span>
            </label>
            <div className="form__actions">
                <button type="button" className="btn btn--secondary" onClick={onClose}>
                    Annuler
                </button>
                <button type="submit" className="btn btn--primary">
                    {item.disliked ? 'Enregistrer' : 'Ranger dans « Meh »'}
                </button>
            </div>
        </form>
    );
}
