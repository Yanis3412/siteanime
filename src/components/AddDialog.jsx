// Ajout d'une œuvre : recherche des fiches (AniList, MyAnimeList en secours), puis ajout avec la fiche choisie.
import { useEffect, useRef, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { Dialog } from './ui/Dialog.jsx';
import { Cover } from './ui/Cover.jsx';
import { useApp } from '../state/app.jsx';
import { useUi } from '../state/ui.jsx';
import { search, summarize, fetchSeasons, findEntry } from '../lib/meta.js';
import { newItem, sameWork, unitLabel } from '../lib/items.js';

export function AddDialog({ open, onClose, defaultType }) {
    return (
        <Dialog open={open} onClose={onClose} title="Ajouter un titre" size="md" variant="top" className="add-dialog">
            <AddForm onClose={onClose} defaultType={defaultType} />
        </Dialog>
    );
}

function AddForm({ onClose, defaultType }) {
    const { library, addItem, updateItem } = useApp();
    const { toast } = useUi();
    const [type, setType] = useState(defaultType);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [state, setState] = useState('idle'); // idle | loading | done | error
    const [active, setActive] = useState(0);
    const listRef = useRef(null);
    const requestRef = useRef(0);

    useEffect(() => {
        const q = query.trim();
        if (q.length < 2) {
            setResults([]);
            setState('idle');
            return;
        }
        const id = ++requestRef.current;
        setState('loading');
        const timer = setTimeout(async () => {
            try {
                const list = await search(q, type, 8);
                if (id !== requestRef.current) return;
                setResults(list.map(summarize));
                setActive(0);
                setState('done');
            } catch {
                if (id === requestRef.current) setState('error');
            }
        }, 350);
        return () => clearTimeout(timer);
    }, [query, type]);

    const add = async (info) => {
        const candidate = newItem({ ...info, type });
        if (library?.items.some((it) => sameWork(it, candidate))) {
            toast(`${candidate.title} est déjà dans ta liste.`);
            return;
        }
        addItem(candidate);
        toast(`${candidate.title} ajouté.`, { tone: 'success' });
        onClose();

        // Compléments en arrière-plan : saisons pour un anime, fiche complète sinon.
        try {
            if (type === 'Anime' && (candidate.anilistId || candidate.malId)) {
                const seasons = await fetchSeasons(candidate);
                if (seasons.length > 1) {
                    updateItem(candidate.id, (it) => ({ ...it, seasons, seasonProgress: seasons.map(() => 0) }), { touch: false });
                }
            } else if (!candidate.anilistId && !candidate.malId) {
                const full = summarize(await findEntry(candidate));
                if (full) {
                    updateItem(
                        candidate.id,
                        (it) => ({ ...it, malId: full.malId, anilistId: full.anilistId, status: full.status, total: full.total, imageUrl: full.imageUrl }),
                        { touch: false },
                    );
                }
            }
        } catch {
            /* infos complémentaires indisponibles : l'œuvre reste ajoutée */
        }
    };

    const options = [...results, ...(query.trim().length >= 2 ? [{ manual: true, title: query.trim() }] : [])];

    const onKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, options.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
        } else if (e.key === 'Enter' && options[active]) {
            e.preventDefault();
            add(options[active].manual ? { title: options[active].title } : options[active]);
        }
    };

    useEffect(() => {
        listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
    }, [active]);

    return (
        <div className="add">
            <div className="add__bar">
                <div className="segmented" role="radiogroup" aria-label="Type">
                    {['Manga', 'Anime'].map((t) => (
                        <button key={t} role="radio" aria-checked={type === t} className={`segmented__opt ${type === t ? 'is-active' : ''}`} onClick={() => setType(t)}>
                            {t}
                        </button>
                    ))}
                </div>
                <label className="search">
                    <Search size={18} aria-hidden="true" />
                    <input
                        className="search__input"
                        placeholder={type === 'Anime' ? 'Titre de l’anime' : 'Titre du manga'}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={onKeyDown}
                        autoFocus
                        role="combobox"
                        aria-expanded={options.length > 0}
                        aria-controls="add-results"
                        aria-activedescendant={options.length ? `add-opt-${active}` : undefined}
                        aria-label="Rechercher un titre"
                    />
                </label>
            </div>

            <div className="add__results" id="add-results" role="listbox" ref={listRef}>
                {state === 'idle' && <p className="add__hint">Tape au moins deux lettres pour chercher un titre.</p>}
                {state === 'loading' && !results.length && <p className="add__hint">Recherche…</p>}
                {state === 'error' && <p className="add__hint">La recherche ne répond pas pour le moment. Tu peux quand même ajouter le titre tel quel.</p>}
                {state === 'done' && !results.length && <p className="add__hint">Aucune fiche trouvée pour « {query.trim()} ».</p>}
                {options.map((opt, i) =>
                    opt.manual ? (
                        <button
                            key="manual"
                            id={`add-opt-${i}`}
                            data-index={i}
                            role="option"
                            aria-selected={i === active}
                            className={`add__option add__option--manual ${i === active ? 'is-active' : ''}`}
                            onMouseEnter={() => setActive(i)}
                            onClick={() => add({ title: opt.title })}
                        >
                            <span className="add__plus">
                                <Plus size={18} />
                            </span>
                            <span>
                                Ajouter « {opt.title} » sans fiche
                            </span>
                        </button>
                    ) : (
                        <button
                            key={opt.anilistId || opt.malId}
                            id={`add-opt-${i}`}
                            data-index={i}
                            role="option"
                            aria-selected={i === active}
                            className={`add__option ${i === active ? 'is-active' : ''}`}
                            onMouseEnter={() => setActive(i)}
                            onClick={() => add(opt)}
                        >
                            <Cover src={opt.imageUrl} title={opt.title} className="cover--thumb" />
                            <span className="add__text">
                                <span className="add__title">{opt.title}</span>
                                <span className="add__meta">
                                    {opt.year && <span>{opt.year}</span>}
                                    <span>{opt.total ? `${opt.total} ${unitLabel(type, opt.total)}` : opt.status === 'ongoing' ? 'En cours de parution' : 'Nombre inconnu'}</span>
                                </span>
                            </span>
                        </button>
                    ),
                )}
            </div>
        </div>
    );
}
