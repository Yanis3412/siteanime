// Titres recommandés par les autres profils et absents de ta liste.
import { useEffect, useMemo, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { useApp } from '../state/app.jsx';
import { useUi } from '../state/ui.jsx';
import { api } from '../lib/api.js';
import { WorkCover } from '../components/WorkCover.jsx';
import { newItem, sameWork, unitLabel } from '../lib/items.js';
import { fetchSeasons, findEntry, coverOf } from '../lib/meta.js';

export function RecommendationsPage() {
    const { session, library, readOnly, addItem, updateItem, profile } = useApp();
    const { toast } = useUi();
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [excluded, setExcluded] = useState(() => new Set());

    useEffect(() => {
        api.getRecommendations()
            .then((d) => setData(d.profiles.filter((p) => p.id !== session.profileId)))
            .catch((e) => setError(e.message));
    }, [session.profileId]);

    const recommendations = useMemo(() => {
        if (!data) return [];
        const mine = library?.items || [];
        const map = new Map();
        for (const p of data) {
            if (excluded.has(p.id)) continue;
            for (const it of p.items) {
                if (mine.some((m) => sameWork(m, it))) continue;
                const key = it.malId ? `${it.type}-${it.malId}` : it.anilistId ? `${it.type}-al${it.anilistId}` : `${it.type}-${it.title.toLowerCase()}`;
                if (!map.has(key)) map.set(key, { item: it, by: [] });
                map.get(key).by.push(p.name);
            }
        }
        return [...map.values()].sort((a, b) => b.by.length - a.by.length || a.item.title.localeCompare(b.item.title, 'fr'));
    }, [data, excluded, library]);

    const toggle = (id) =>
        setExcluded((s) => {
            const next = new Set(s);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });

    const add = async (rec) => {
        const created = newItem(rec.item);
        addItem(created);
        toast(`${created.title} ajouté à ta liste.`, { tone: 'success' });
        if (!created.malId && !created.anilistId) return;
        try {
            if (!created.imageUrl) {
                const imageUrl = coverOf(await findEntry(created));
                if (imageUrl) updateItem(created.id, { imageUrl }, { touch: false });
            }
            if (created.type === 'Anime') {
                const seasons = await fetchSeasons(created);
                if (seasons.length > 1) updateItem(created.id, (it) => ({ ...it, seasons, seasonProgress: seasons.map(() => 0) }), { touch: false });
            }
        } catch {
            /* infos complémentaires indisponibles : le titre reste ajouté */
        }
    };

    const joinNames = (names) => (names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`);

    return (
        <div className="page">
            <div className="page__head">
                <h1 className="page__title">
                    Recommandations
                    {data && <span className="page__count">{recommendations.length}</span>}
                </h1>
                {data?.length > 0 && (
                    <div className="chips" role="group" aria-label="Profils pris en compte">
                        {data.map((p) => (
                            <button key={p.id} className={`chip ${excluded.has(p.id) ? '' : 'is-on'}`} aria-pressed={!excluded.has(p.id)} onClick={() => toggle(p.id)}>
                                {!excluded.has(p.id) && <Check size={14} aria-hidden="true" />}
                                {p.name}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {error && <p className="form__error">{error}</p>}
            {!data && !error && <p className="muted">Chargement…</p>}
            {data && data.length === 0 && (
                <div className="empty">
                    <h2 className="empty__title">Aucun autre profil</h2>
                    <p className="empty__text">Les titres recommandés par tes potes apparaîtront ici dès qu’ils auront leur profil.</p>
                </div>
            )}
            {data && data.length > 0 && recommendations.length === 0 && (
                <div className="empty">
                    <h2 className="empty__title">Rien de nouveau à te recommander</h2>
                    <p className="empty__text">
                        {readOnly ? `${profile?.name} a déjà` : 'Tu as déjà'} tous les titres recommandés par les profils sélectionnés, ou personne n’a encore recommandé de titre.
                    </p>
                </div>
            )}

            {recommendations.length > 0 && (
                <ul className="recos">
                    {recommendations.map((rec) => (
                        <li key={`${rec.item.type}-${rec.item.malId || rec.item.anilistId || rec.item.title}`} className="reco">
                            <WorkCover item={rec.item} />
                            <div className="reco__text">
                                <span className="reco__title">{rec.item.title}</span>
                                <span className="reco__meta">
                                    {rec.item.type}
                                    {rec.item.total ? `, ${rec.item.total} ${unitLabel(rec.item.type, rec.item.total)}` : ''}
                                </span>
                                <span className="reco__by">Recommandé par {joinNames(rec.by)}</span>
                            </div>
                            {!readOnly && (
                                <button className="btn btn--secondary" onClick={() => add(rec)}>
                                    <Plus size={16} aria-hidden="true" />
                                    Ajouter
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
