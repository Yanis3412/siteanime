// Page détaillée d'une œuvre : progression, saisons, résumé, note et actions.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Bookmark, BookmarkCheck, ExternalLink, Minus, Pencil, Plus, RefreshCw, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react';
import { useApp } from '../state/app.jsx';
import { useItemActions } from '../hooks/useItemActions.js';
import { Cover } from '../components/ui/Cover.jsx';
import { Dialog } from '../components/ui/Dialog.jsx';
import { ChaptersSection } from '../components/ChaptersSection.jsx';
import { DislikeDialog } from '../components/DislikeDialog.jsx';
import { findEntry, externalLink } from '../lib/meta.js';
import {
    percentOf,
    progressOf,
    statusOf,
    statusLabel,
    stepProgress,
    setCurrent,
    setTotal,
    setSeasonProgress,
    unitLabel,
} from '../lib/items.js';

export function ItemPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { library, readOnly } = useApp();
    const actions = useItemActions();
    const [editing, setEditing] = useState(false);
    const [disliking, setDisliking] = useState(false);
    const item = library?.items.find((it) => it.id === id);

    if (!library) return <div className="page"><p className="muted">Chargement…</p></div>;
    if (!item) {
        return (
            <div className="page">
                <div className="empty">
                    <h1 className="empty__title">Ce titre n’est plus dans la liste</h1>
                    <Link to="/mangas" className="btn btn--secondary">
                        Retour aux mangas
                    </Link>
                </div>
            </div>
        );
    }

    const back = item.disliked
        ? { to: '/pas-aimes', label: 'Pas aimés' }
        : item.fav
          ? { to: '/watchlist', label: 'Watchlist' }
          : item.type === 'Anime' ? { to: '/animes', label: 'Animes' } : { to: '/mangas', label: 'Mangas' };
    const { current, total } = progressOf(item);
    const percent = percentOf(item);
    const status = statusOf(item);
    const hasSeasons = item.seasons?.length > 0;

    return (
        <div className="page page--item">
            <Link to={back.to} className="backlink">
                <ArrowLeft size={16} aria-hidden="true" />
                {back.label}
            </Link>

            <div className="item">
                <div className="item__aside">
                    <Cover src={item.imageUrl} title={item.title} className="cover--lg" eager />
                    {(item.officialUrl || externalLink(item)) && (
                        <div className="item__links">
                            {item.officialUrl && (
                                <a className="btn btn--secondary btn--block" href={item.officialUrl} target="_blank" rel="noopener noreferrer">
                                    {item.type === 'Anime' ? 'Regarder' : 'Lire'}
                                    <ExternalLink size={15} aria-hidden="true" />
                                </a>
                            )}
                            {externalLink(item) && (
                                <a className="btn btn--ghost btn--block" href={externalLink(item).url} target="_blank" rel="noopener noreferrer">
                                    {externalLink(item).label}
                                    <ExternalLink size={15} aria-hidden="true" />
                                </a>
                            )}
                        </div>
                    )}
                </div>

                <div className="item__main">
                    <h1 className="item__title">{item.title}</h1>
                    <div className="badges">
                        <span className="badge">{item.type}</span>
                        <span className={`badge badge--${status}`}>{statusLabel[status]}</span>
                        {item.fav && <span className="badge">Dans la watchlist</span>}
                        {item.recommended && <span className="badge">Recommandé</span>}
                        {item.disliked && <span className="badge">Pas aimé</span>}
                    </div>

                    <section className="progress" aria-label="Progression">
                        <div className="progress__numbers">
                            <span className="progress__current">{current}</span>
                            <span className="progress__total">
                                / {total ?? '?'} {unitLabel(item.type, total || 2)}
                            </span>
                            {percent !== null && <span className="progress__pct">{percent} %</span>}
                        </div>
                        <div className="meter" style={{ '--p': `${percent ?? 0}%` }} />
                        {!readOnly && !hasSeasons && (
                            <div className="progress__edit">
                                <div className="stepper">
                                    <button className="stepper__btn" onClick={() => actions.update(item.id, (it) => stepProgress(it, -1))} aria-label="Retirer un">
                                        <Minus size={18} />
                                    </button>
                                    <NumberInput label={item.type === 'Anime' ? 'Épisodes vus' : 'Chapitres lus'} value={item.current} onCommit={(v) => actions.update(item.id, (it) => setCurrent(it, v))} />
                                    <button className="stepper__btn stepper__btn--plus" onClick={() => actions.update(item.id, (it) => stepProgress(it, 1))} aria-label="Ajouter un">
                                        <Plus size={18} />
                                    </button>
                                </div>
                                <NumberInput label="Total" showLabel value={item.total ?? ''} placeholder="?" onCommit={(v) => actions.update(item.id, (it) => setTotal(it, v))} />
                            </div>
                        )}
                    </section>

                    {hasSeasons && (
                        <section className="seasons">
                            <h2 className="section-title">Saisons</h2>
                            {item.seasons.map((s, i) => {
                                const done = item.seasonProgress?.[i] || 0;
                                return (
                                    <div key={`${s.malId}-${i}`} className="season">
                                        <div className="season__info">
                                            <span className="season__num">Saison {s.seasonNumber || i + 1}</span>
                                            <span className="season__name">{s.name}</span>
                                        </div>
                                        <div className="season__progress">
                                            {readOnly ? (
                                                <span className="season__count">
                                                    {done} / {s.episodes ?? '?'}
                                                </span>
                                            ) : (
                                                <div className="stepper stepper--sm">
                                                    <button className="stepper__btn" onClick={() => actions.update(item.id, (it) => setSeasonProgress(it, i, done - 1))} aria-label={`Retirer un épisode, saison ${i + 1}`}>
                                                        <Minus size={15} />
                                                    </button>
                                                    <NumberInput label={`Épisodes vus, saison ${i + 1}`} value={done} suffix={`/ ${s.episodes ?? '?'}`} onCommit={(v) => actions.update(item.id, (it) => setSeasonProgress(it, i, v))} />
                                                    <button className="stepper__btn stepper__btn--plus" onClick={() => actions.update(item.id, (it) => setSeasonProgress(it, i, done + 1))} aria-label={`Ajouter un épisode, saison ${i + 1}`}>
                                                        <Plus size={15} />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </section>
                    )}

                    {!readOnly && (
                        <div className="item__actions">
                            <button className="btn btn--secondary" onClick={() => actions.toggleWatchlist(item)}>
                                {item.fav ? <BookmarkCheck size={16} aria-hidden="true" /> : <Bookmark size={16} aria-hidden="true" />}
                                {item.fav ? 'Retirer de la watchlist' : 'Mettre dans la watchlist'}
                            </button>
                            <button className={`btn btn--secondary ${item.recommended ? 'is-on' : ''}`} onClick={() => actions.toggleRecommended(item)} aria-pressed={item.recommended}>
                                <ThumbsUp size={16} aria-hidden="true" />
                                {item.recommended ? 'Recommandé' : 'Recommander'}
                            </button>
                            <button
                                className={`btn btn--secondary ${item.disliked ? 'is-on' : ''}`}
                                onClick={() => (item.disliked ? actions.removeDisliked(item) : setDisliking(true))}
                                aria-pressed={!!item.disliked}
                            >
                                <ThumbsDown size={16} aria-hidden="true" />
                                Pas aimé
                            </button>
                            <button className="btn btn--ghost" onClick={() => actions.refresh(item)}>
                                <RefreshCw size={16} aria-hidden="true" />
                                Actualiser
                            </button>
                            <button className="btn btn--ghost" onClick={() => setEditing(true)}>
                                <Pencil size={16} aria-hidden="true" />
                                Modifier
                            </button>
                            <button
                                className="btn btn--ghost btn--danger-text"
                                onClick={async () => {
                                    if (await actions.remove(item)) navigate(back.to);
                                }}
                            >
                                <Trash2 size={16} aria-hidden="true" />
                                Supprimer
                            </button>
                        </div>
                    )}

                    {item.disliked && (
                        <section className="note dislike-reason">
                            <h2 className="section-title">Pourquoi {readOnly ? 'ce titre n’a pas plu' : 'tu n’as pas aimé'}</h2>
                            {item.dislikedReason ? <p className="note__text">{item.dislikedReason}</p> : <p className="muted">{readOnly ? 'Pas de raison donnée.' : 'Tu n’as pas encore expliqué pourquoi.'}</p>}
                            {!readOnly && (
                                <button className="btn btn--ghost btn--sm dislike-reason__edit" onClick={() => setDisliking(true)}>
                                    <Pencil size={15} aria-hidden="true" />
                                    {item.dislikedReason ? 'Modifier' : 'Expliquer pourquoi'}
                                </button>
                            )}
                        </section>
                    )}

                    {item.type === 'Manga' && !readOnly && <ChaptersSection item={item} />}

                    <NoteField item={item} readOnly={readOnly} />
                    <Synopsis item={item} />
                </div>
            </div>

            <EditDialog item={item} open={editing} onClose={() => setEditing(false)} />
            {disliking && <DislikeDialog item={item} open onClose={() => setDisliking(false)} />}
        </div>
    );
}

// Champ numérique validé à la sortie du champ ou avec Entrée.
function NumberInput({ label, value, onCommit, placeholder, suffix, showLabel }) {
    const [draft, setDraft] = useState(String(value ?? ''));
    useEffect(() => setDraft(String(value ?? '')), [value]);
    const commit = () => {
        if (draft !== String(value ?? '')) onCommit(draft);
    };
    return (
        <label className="numfield">
            <span className={showLabel ? 'numfield__label' : 'sr-only'}>{label}</span>
            <input
                className="numfield__input"
                type="number"
                inputMode="numeric"
                min="0"
                value={draft}
                placeholder={placeholder}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            {suffix && <span className="numfield__suffix">{suffix}</span>}
        </label>
    );
}

function NoteField({ item, readOnly }) {
    const { updateItem } = useApp();
    const [draft, setDraft] = useState(item.note || '');
    const timer = useRef(null);
    useEffect(() => setDraft(item.note || ''), [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

    if (readOnly && !item.note) return null;

    const commit = (value) => {
        clearTimeout(timer.current);
        if (value !== (item.note || '')) updateItem(item.id, { note: value });
    };

    return (
        <section className="note">
            <h2 className="section-title">
                <label htmlFor="note">Note perso</label>
            </h2>
            {readOnly ? (
                <p className="note__text">{item.note}</p>
            ) : (
                <textarea
                    id="note"
                    className="input note__input"
                    value={draft}
                    maxLength={4000}
                    placeholder="Où tu t’es arrêté, ce que tu en penses…"
                    onChange={(e) => {
                        const v = e.target.value;
                        setDraft(v);
                        clearTimeout(timer.current);
                        timer.current = setTimeout(() => commit(v), 900);
                    }}
                    onBlur={() => commit(draft)}
                />
            )}
        </section>
    );
}

// Résumé et genres depuis la fiche de l'œuvre (en anglais), chargés à l'ouverture.
function Synopsis({ item }) {
    const [data, setData] = useState(null);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        setData(null);
        if (!item.malId && !item.anilistId) return;
        let alive = true;
        findEntry({ type: item.type, title: item.title, malId: item.malId, anilistId: item.anilistId })
            .then((e) => alive && e && setData(e))
            .catch(() => {});
        return () => {
            alive = false;
        };
    }, [item.malId, item.anilistId, item.type, item.title]);

    if (!data?.synopsis) return null;
    const text = data.synopsis;

    return (
        <section className="synopsis">
            <h2 className="section-title">Résumé</h2>
            {(data.genres.length > 0 || data.score) && (
                <div className="badges badges--quiet">
                    {data.score && <span className="badge">Note {data.scoreSource} {String(data.score).replace('.', ',')}</span>}
                    {data.genres.slice(0, 6).map((g) => (
                        <span key={g} className="badge">
                            {g}
                        </span>
                    ))}
                </div>
            )}
            <p className={`synopsis__text ${open ? 'is-open' : ''}`} lang="en">
                {text}
            </p>
            {text.length > 420 && (
                <button className="btn btn--link" onClick={() => setOpen((o) => !o)}>
                    {open ? 'Réduire' : 'Lire la suite'}
                </button>
            )}
        </section>
    );
}

function EditDialog({ item, open, onClose }) {
    return (
        <Dialog open={open} onClose={onClose} title="Modifier le titre" size="sm">
            <EditForm item={item} onClose={onClose} />
        </Dialog>
    );
}

function EditForm({ item, onClose }) {
    const { updateItem } = useApp();
    const actions = useItemActions();
    const [title, setTitle] = useState(item.title);
    const [type, setType] = useState(item.type);
    const [officialUrl, setOfficialUrl] = useState(item.officialUrl || '');
    const [error, setError] = useState('');

    const submit = (e) => {
        e.preventDefault();
        const cleanTitle = title.trim();
        if (!cleanTitle) return setError('Le titre ne peut pas être vide.');
        const url = officialUrl.trim();
        if (url && !/^https:\/\//.test(url)) return setError('Le lien doit commencer par https://');
        const identityChanged = cleanTitle !== item.title || type !== item.type;
        const changes = { title: cleanTitle, type, officialUrl: url || null };
        if (identityChanged) Object.assign(changes, { malId: null, anilistId: null, status: 'unknown', imageUrl: null, seasons: undefined, seasonProgress: undefined });
        updateItem(item.id, changes);
        onClose();
        // Nouveau titre : on cherche la bonne fiche.
        if (identityChanged) actions.refresh({ ...item, ...changes });
    };

    return (
        <form className="form" onSubmit={submit}>
            <label className="field">
                <span className="field__label">Titre</span>
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus />
            </label>
            <div className="field">
                <span className="field__label">Type</span>
                <div className="segmented" role="radiogroup" aria-label="Type">
                    {['Manga', 'Anime'].map((t) => (
                        <button type="button" key={t} role="radio" aria-checked={type === t} className={`segmented__opt ${type === t ? 'is-active' : ''}`} onClick={() => setType(t)}>
                            {t}
                        </button>
                    ))}
                </div>
            </div>
            <label className="field">
                <span className="field__label">Lien officiel (optionnel)</span>
                <input className="input" type="url" value={officialUrl} onChange={(e) => setOfficialUrl(e.target.value)} placeholder="https://mangaplus.shueisha.co.jp/…" />
                <span className="field__hint">Ajoute un bouton « {type === 'Anime' ? 'Regarder' : 'Lire'} » sur cette page.</span>
            </label>
            {error && <p className="form__error">{error}</p>}
            <div className="form__actions">
                <button type="button" className="btn btn--secondary" onClick={onClose}>
                    Annuler
                </button>
                <button className="btn btn--primary">Enregistrer</button>
            </div>
        </form>
    );
}
