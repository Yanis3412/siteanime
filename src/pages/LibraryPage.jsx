// Grille des mangas, des animes ou de la watchlist, avec filtre, statut et tri.
import { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { useApp } from '../state/app.jsx';
import { ItemCard } from '../components/ItemCard.jsx';
import { percentOf, statusOf } from '../lib/items.js';
import { load, save } from '../lib/storage.js';

const TITLES = { Manga: 'Mangas', Anime: 'Animes', watchlist: 'Watchlist' };
const EMPTY = {
    Manga: { title: 'Aucun manga pour l’instant', text: 'Ajoute un manga pour suivre les chapitres que tu as lus.', cta: 'Ajouter un manga' },
    Anime: { title: 'Aucun anime pour l’instant', text: 'Ajoute un anime pour suivre les épisodes que tu as vus.', cta: 'Ajouter un anime' },
    watchlist: { title: 'Ta watchlist est vide', text: 'Depuis le menu d’un titre, choisis « Mettre dans la watchlist » pour le garder de côté.' },
};
const SORTS = {
    title: { label: 'Titre', fn: (a, b) => a.title.localeCompare(b.title, 'fr') },
    updated: { label: 'Modifiés récemment', fn: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) },
    added: { label: 'Ajoutés récemment', fn: (a, b) => (b.addedAt || 0) - (a.addedAt || 0) },
    progress: { label: 'Progression', fn: (a, b) => (percentOf(b) ?? -1) - (percentOf(a) ?? -1) },
};
const FILTERS = [
    { id: 'all', label: 'Tous' },
    { id: 'ongoing', label: 'En cours' },
    { id: 'completed', label: 'Terminés' },
];

export function LibraryPage({ view }) {
    const { library, readOnly, profile } = useApp();
    const { openAdd } = useOutletContext();
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState('all');
    const [sort, setSort] = useState(() => load('sort', 'title'));

    const base = useMemo(() => {
        const items = library?.items || [];
        // Comme avant : un titre dans la watchlist n'apparaît plus dans Mangas / Animes.
        if (view === 'watchlist') return items.filter((it) => it.fav);
        return items.filter((it) => it.type === view && !it.fav);
    }, [library, view]);

    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        return base
            .filter((it) => !q || it.title.toLowerCase().includes(q))
            .filter((it) => filter === 'all' || statusOf(it) === filter)
            .sort(SORTS[sort]?.fn || SORTS.title.fn);
    }, [base, query, filter, sort]);

    const changeSort = (value) => {
        setSort(value);
        save('sort', value);
    };

    const empty = EMPTY[view];

    return (
        <div className="page">
            <div className="page__head">
                <h1 className="page__title">
                    {TITLES[view]}
                    {library && <span className="page__count">{base.length}</span>}
                </h1>
                {base.length > 0 && (
                    <div className="toolbar">
                        <label className="search search--compact">
                            <Search size={16} aria-hidden="true" />
                            <input className="search__input" placeholder="Filtrer par titre" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filtrer par titre" />
                        </label>
                        <div className="segmented" role="radiogroup" aria-label="Statut de parution">
                            {FILTERS.map((f) => (
                                <button key={f.id} role="radio" aria-checked={filter === f.id} className={`segmented__opt ${filter === f.id ? 'is-active' : ''}`} onClick={() => setFilter(f.id)}>
                                    {f.label}
                                </button>
                            ))}
                        </div>
                        <label className="select">
                            <span className="sr-only">Trier par</span>
                            <select value={sort} onChange={(e) => changeSort(e.target.value)}>
                                {Object.entries(SORTS).map(([id, s]) => (
                                    <option key={id} value={id}>
                                        {s.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                )}
            </div>

            {!library ? (
                <div className="grid" aria-busy="true">
                    {Array.from({ length: 12 }, (_, i) => (
                        <div key={i} className="card card--skeleton">
                            <div className="cover" />
                            <div className="skeleton-line" />
                        </div>
                    ))}
                </div>
            ) : base.length === 0 ? (
                <div className="empty">
                    <h2 className="empty__title">{readOnly ? `${profile?.name} n’a rien ici pour l’instant` : empty.title}</h2>
                    {!readOnly && <p className="empty__text">{empty.text}</p>}
                    {!readOnly && empty.cta && (
                        <button className="btn btn--primary" onClick={openAdd}>
                            <Plus size={18} aria-hidden="true" />
                            {empty.cta}
                        </button>
                    )}
                </div>
            ) : visible.length === 0 ? (
                <div className="empty">
                    <h2 className="empty__title">Aucun titre ne correspond</h2>
                    <p className="empty__text">Change le filtre ou efface la recherche.</p>
                    <button
                        className="btn btn--secondary"
                        onClick={() => {
                            setQuery('');
                            setFilter('all');
                        }}
                    >
                        Tout afficher
                    </button>
                </div>
            ) : (
                <div className="grid">
                    {visible.map((item) => (
                        <ItemCard key={item.id} item={item} readOnly={readOnly} />
                    ))}
                </div>
            )}
        </div>
    );
}
