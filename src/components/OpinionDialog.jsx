// Avis public sur un titre : « Recommander » ou « Meh », avec une raison facultative
// que les autres profils peuvent lire (et approuver d'un pouce). Sert aussi à modifier la raison.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Dialog } from './ui/Dialog.jsx';
import { useApp } from '../state/app.jsx';
import { useUi } from '../state/ui.jsx';

export const REASON_MAX = 1000;

// Champs de l'œuvre et textes de chaque type d'avis. Recommandé et Meh s'excluent ;
// Meh retire aussi de la watchlist.
export const OPINIONS = {
    reco: {
        flag: 'recommended',
        reason: 'recommendedReason',
        at: 'recommendedAt',
        clears: { disliked: false },
        title: 'Recommander',
        editTitle: 'Pourquoi tu le recommandes ?',
        placeholder: 'Ce qui t’a plu, à qui ça plairait…',
        hint: 'Visible par tous les profils dans « Recommandations ».',
        submit: 'Recommander',
        done: (title) => `${title} est recommandé aux autres profils.`,
    },
    meh: {
        flag: 'disliked',
        reason: 'dislikedReason',
        at: 'dislikedAt',
        clears: { recommended: false, fav: false },
        title: 'Meh',
        editTitle: 'Pourquoi c’est meh ?',
        placeholder: 'Le rythme, la fin, les personnages…',
        hint: 'Visible par tous les profils dans « Meh ».',
        submit: 'Ranger dans « Meh »',
        done: (title) => `${title} est rangé dans « Meh ».`,
    },
};

export function OpinionDialog({ item, kind, open, onClose }) {
    const o = OPINIONS[kind];
    // Rendue à la racine de la page, pour ne pas hériter des styles de la carte.
    return createPortal(
        <Dialog open={open} onClose={onClose} title={item[o.flag] ? o.editTitle : o.title} description={item.title} size="sm">
            {open && <OpinionForm item={item} kind={kind} onClose={onClose} />}
        </Dialog>,
        document.body,
    );
}

function OpinionForm({ item, kind, onClose }) {
    const o = OPINIONS[kind];
    const { updateItem } = useApp();
    const { toast } = useUi();
    const [reason, setReason] = useState(item[o.reason] || '');

    const submit = (e) => {
        e.preventDefault();
        const text = reason.trim();
        if (item[o.flag]) {
            updateItem(item.id, { [o.reason]: text });
            toast('Raison enregistrée.', { tone: 'success' });
        } else {
            updateItem(item.id, { [o.flag]: true, [o.reason]: text, [o.at]: Date.now(), ...o.clears });
            toast(o.done(item.title));
        }
        onClose();
    };

    return (
        <form className="dislike-form" onSubmit={submit}>
            <label className="field">
                <span className="field__label">Pourquoi ? (facultatif)</span>
                <textarea className="input dislike-form__input" value={reason} maxLength={REASON_MAX} onChange={(e) => setReason(e.target.value)} placeholder={o.placeholder} autoFocus />
                <span className="field__hint">{o.hint}</span>
            </label>
            <div className="form__actions">
                <button type="button" className="btn btn--secondary" onClick={onClose}>
                    Annuler
                </button>
                <button type="submit" className="btn btn--primary">
                    {item[o.flag] ? 'Enregistrer' : o.submit}
                </button>
            </div>
        </form>
    );
}
