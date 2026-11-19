// Carte d'une œuvre dans la grille : couverture, titre, progression et réglage rapide.
import { memo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, BookmarkCheck, Minus, MoreHorizontal, Plus, RefreshCw, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react';
import { Cover } from './ui/Cover.jsx';
import { Menu } from './ui/Menu.jsx';
import { percentOf, progressOf, statusOf, stepProgress, isCaughtUp } from '../lib/items.js';
import { useItemActions } from '../hooks/useItemActions.js';
import { DislikeDialog } from './DislikeDialog.jsx';

export const ItemCard = memo(function ItemCard({ item, readOnly }) {
    const actions = useItemActions();
    const [disliking, setDisliking] = useState(false);
    const { current, total } = progressOf(item);
    const percent = percentOf(item);
    const status = statusOf(item);
    const caughtUp = isCaughtUp(item);
    const unit = item.type === 'Anime' ? 'Ép.' : 'Ch.';

    return (
        <article className={`card ${caughtUp ? 'is-caughtup' : ''}`}>
            <Link to={`/oeuvre/${item.id}`} className="card__link">
                <div className="card__cover">
                    <Cover src={item.imageUrl} title={item.title} />
                    {percent !== null && <span className="card__bar" style={{ '--p': `${percent}%` }} aria-hidden="true" />}
                    {item.recommended && (
                        <span className="card__flag" title="Recommandé">
                            <ThumbsUp size={13} aria-label="Recommandé" />
                        </span>
                    )}
                </div>
                <h3 className="card__title">{item.title}</h3>
            </Link>

            <div className="card__meta">
                <span className="card__count" aria-label={`Progression ${current} sur ${total ?? 'inconnu'}`}>
                    <span className="card__unit">{unit}</span> {current}
                    <span className="card__total">/{total ?? '?'}</span>
                </span>
                <span className={`dot dot--${status}`} title={status === 'ongoing' ? 'En cours de parution' : status === 'completed' ? 'Terminé' : 'Statut inconnu'} />
                {!readOnly && (
                    <span className="card__steps">
                        <button className="step" onClick={() => actions.update(item.id, (it) => stepProgress(it, -1))} aria-label={`Retirer un ${item.type === 'Anime' ? 'épisode' : 'chapitre'} à ${item.title}`}>
                            <Minus size={15} />
                        </button>
                        <button className="step step--plus" onClick={() => actions.update(item.id, (it) => stepProgress(it, 1))} aria-label={`Ajouter un ${item.type === 'Anime' ? 'épisode' : 'chapitre'} à ${item.title}`}>
                            <Plus size={15} />
                        </button>
                    </span>
                )}
            </div>

            {!readOnly && (
                <div className="card__menu">
                    <Menu
                        label={`Actions pour ${item.title}`}
                        trigger={(props) => (
                            <button className="card__menubtn" {...props}>
                                <MoreHorizontal size={18} />
                            </button>
                        )}
                        items={[
                            {
                                label: item.fav ? 'Retirer de la watchlist' : 'Mettre dans la watchlist',
                                icon: item.fav ? BookmarkCheck : Bookmark,
                                onSelect: () => actions.toggleWatchlist(item),
                            },
                            {
                                label: item.recommended ? 'Ne plus recommander' : 'Recommander aux autres',
                                icon: ThumbsUp,
                                onSelect: () => actions.toggleRecommended(item),
                            },
                            {
                                label: item.disliked ? 'Retirer de « Meh »' : 'Meh…',
                                icon: ThumbsDown,
                                onSelect: () => (item.disliked ? actions.removeDisliked(item) : setDisliking(true)),
                            },
                            { label: 'Actualiser les infos', icon: RefreshCw, onSelect: () => actions.refresh(item) },
                            'separator',
                            { label: 'Supprimer', icon: Trash2, danger: true, onSelect: () => actions.remove(item) },
                        ]}
                    />
                    {disliking && <DislikeDialog item={item} open onClose={() => setDisliking(false)} />}
                </div>
            )}
        </article>
    );
});
