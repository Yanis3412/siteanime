// Grille des mangas, des animes ou de la watchlist, avec filtre, statut et tri.
// Les titres « Pas aimés » ont leur propre section (page Pas aimés) : ils n'apparaissent pas ici.
import { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Plus, Search } from 'lucide-react';
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
const byTitle = (a, b) => a.title.localeCompare(b.title, 'fr');
const byDate = (field) => (a, b) => (a[field] || 0) - (b[field] || 0);

// cmp trie dans l'ordre croissant ; dir est l'ordre proposé par défaut.
const SORTS = {
    title: { label: 'Titre', cmp: byTitle, dir: 'asc', orders: { asc: 'De A à Z', desc: 'De Z à A' } },
    updated: { label: 'Dernière modification', cmp: byDate('updatedAt'), dir: 'desc', orders: { desc: 'Les plus récents d’abord', asc: 'Les plus anciens d’abord' } },
    added: { label: 'Date d’ajout', cmp: byDate('addedAt'), dir: 'desc', orders: { desc: 'Les plus récents d’abord', asc: 'Les plus anciens d’abord' } },
    progress: { label: 'Progression', cmp: null, dir: 'asc', orders: { asc: 'Les moins avancés d’abord', desc: 'Les plus avancés d’abord' } },
};

function sortItems(items, sortId, dir) {
    const sign = dir === 'desc' ? -1 : 1;
    const sort = SORTS[sortId] || SORTS.title;
    return [...items].sort((a, b) => {
        if (sortId === 'progress') {
            // Total inconnu : toujours à la fin.
            const pa = percentOf(a);
            const pb = percentOf(b);
            if (pa === null || pb === null) return pa === pb ? byTitle(a, b) : pa === null ? 1 : -1;
            return sign * (pa - pb) || byTitle(a, b);
        }
        return sign * sort.cmp(a, b) || byTitle(a, b);
    });
}

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
    const [dirs, setDirs] = useState(() => load('sortDirs', {}));
    const dir = dirs[sort] || SORTS[sort]?.dir || 'asc';

    const base = useMemo(() => {
        const items = library?.items || [];
        // Comme avant : un titre dans la watchlist n'apparaît plus dans Mangas / Animes.
        if (view === 'watchlist') return items.filter((it) => it.fav && !it.disliked);
        return items.filter((it) => it.type === view && !it.fav && !it.disliked);
    }, [library, view]);

    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        const shown = base
            .filter((it) => !q || it.title.toLowerCase().includes(q))
            .filter((it) => filter === 'all' || statusOf(it) === filter);
        return sortItems(shown, sort, dir);
    }, [base, query, filter, sort, dir]);

    const changeSort = (value) => {
        setSort(value);
        save('sort', value);
    };

    const flipOrder = () => {
        const next = { ...dirs, [sort]: dir === 'asc' ? 'desc' : 'asc' };
        setDirs(next);
        save('sortDirs', next);
    };
    const orders = (SORTS[sort] || SORTS.title).orders;

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
                        <div className="segmented" role="radiogroup" aria-label="Afficher">
                            {FILTERS.map((f) => (
                                <button key={f.id} role="radio" aria-checked={filter === f.id} className={`segmented__opt ${filter === f.id ? 'is-active' : ''}`} onClick={() => setFilter(f.id)}>
                                    {f.label}
                                </button>
                            ))}
                        </div>
                        <div className="sort">
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
                            <button className="btn btn--secondary btn--icon sort-order" onClick={flipOrder} title={`${orders[dir]} (cliquer pour inverser)`} aria-label={`Ordre : ${orders[dir].toLowerCase()}. Inverser`}>
                                {dir === 'asc' ? <ArrowUpNarrowWide size={17} /> : <ArrowDownWideNarrow size={17} />}
                            </button>
                        </div>
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
