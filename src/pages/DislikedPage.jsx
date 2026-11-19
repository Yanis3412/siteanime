// « Meh » : les titres que chaque profil n'a pas aimés, et pourquoi.
// Un titre pas aimé par plusieurs profils n'apparaît qu'une fois, avec l'avis de chacun.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Pencil } from 'lucide-react';
import { useApp } from '../state/app.jsx';
import { api, avatarUrl } from '../lib/api.js';
import { Avatar } from '../components/ui/Avatar.jsx';
import { WorkCover } from '../components/WorkCover.jsx';
import { DislikeDialog } from '../components/DislikeDialog.jsx';
import { progressOf, sameWork, unitLabel } from '../lib/items.js';

export function DislikedPage() {
    const { session, library, readOnly } = useApp();
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [excluded, setExcluded] = useState(() => new Set());
    const [editing, setEditing] = useState(null); // titre de ta liste dont tu modifies la raison

    useEffect(() => {
        const load = () =>
            api
                .getDisliked()
                .then((d) => {
                    setData(d.profiles);
                    setError(null);
                })
                .catch((e) => setError(e.message));
        load();
        const onVisible = () => document.visibilityState === 'visible' && load();
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, []);

    // Ton profil vient de ta liste (à jour tout de suite), les autres du serveur.
    const profiles = useMemo(() => {
        if (!data) return null;
        return data.map((p) => {
            if (p.id !== session.profileId || !library) return p;
            const items = library.items
                .filter((it) => it.disliked)
                .map((it) => ({ ...it, total: progressOf(it).total, reason: it.dislikedReason || '', at: it.dislikedAt || it.updatedAt || 0 }));
            return { ...p, items };
        });
    }, [data, library, session.profileId]);

    const works = useMemo(() => {
        if (!profiles) return [];
        const list = [];
        for (const p of profiles) {
            if (excluded.has(p.id)) continue;
            for (const it of p.items) {
                // Même œuvre (même fiche ou même titre) chez plusieurs profils : un seul bloc.
                let work = list.find((w) => w.votes.some((v) => sameWork(v.item, it)));
                if (!work) list.push((work = { item: it, at: 0, votes: [] }));
                work.votes.push({ profile: p, item: it });
                work.at = Math.max(work.at, it.at);
                if (!work.item.imageUrl && it.imageUrl) work.item = it;
            }
        }
        for (const w of list) {
            // Ton avis en premier, puis les plus récents.
            w.votes.sort((a, b) => (b.profile.id === session.profileId) - (a.profile.id === session.profileId) || b.item.at - a.item.at);
        }
        return list.sort((a, b) => b.at - a.at);
    }, [profiles, excluded, session.profileId]);

    const toggle = (id) =>
        setExcluded((s) => {
            const next = new Set(s);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });

    const mine = (work) => library?.items.find((it) => sameWork(it, work.item));

    return (
        <div className="page">
            <div className="page__head">
                <h1 className="page__title">
                    Meh
                    {profiles && <span className="page__count">{works.length}</span>}
                </h1>
                {profiles?.length > 1 && (
                    <div className="chips" role="group" aria-label="Profils pris en compte">
                        {profiles.map((p) => (
                            <button key={p.id} className={`chip ${excluded.has(p.id) ? '' : 'is-on'}`} aria-pressed={!excluded.has(p.id)} onClick={() => toggle(p.id)}>
                                {!excluded.has(p.id) && <Check size={14} aria-hidden="true" />}
                                {p.name}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {error && <p className="form__error">{error}</p>}
            {!profiles && !error && <p className="muted">Chargement…</p>}
            {profiles && works.length === 0 && (
                <div className="empty">
                    <h2 className="empty__title">{excluded.size ? 'Rien pour les profils choisis' : 'Personne n’a encore rangé de titre ici'}</h2>
                    <p className="empty__text">Depuis la fiche d’un titre, choisis « Meh » et explique pourquoi si tu veux : tout le monde pourra le lire ici.</p>
                </div>
            )}

            {works.length > 0 && (
                <ul className="recos dislikes">
                    {works.map((work) => {
                        const own = mine(work);
                        return (
                            <li key={`${work.votes[0].profile.id}-${work.votes[0].item.id}`} className="reco dislike">
                                <WorkCover item={work.item} />
                                <div className="reco__text">
                                    {own ? (
                                        <Link to={`/oeuvre/${own.id}`} className="reco__title dislike__title">
                                            {work.item.title}
                                        </Link>
                                    ) : (
                                        <span className="reco__title">{work.item.title}</span>
                                    )}
                                    <span className="reco__meta">
                                        {work.item.type}
                                        {work.item.total ? `, ${work.item.total} ${unitLabel(work.item.type, work.item.total)}` : ''}
                                    </span>
                                    <ul className="opinions">
                                        {work.votes.map(({ profile, item }) => {
                                            const isMe = profile.id === session.profileId;
                                            return (
                                                <li key={profile.id} className="opinion">
                                                    <Avatar name={profile.name} src={avatarUrl(profile)} size="sm" />
                                                    <div className="opinion__body">
                                                        <span className="opinion__who">{profile.name}</span>
                                                        {item.reason ? <p className="opinion__text">{item.reason}</p> : <p className="opinion__text opinion__text--none">Pas de raison donnée.</p>}
                                                        {isMe && !readOnly && item.disliked && (
                                                            <button className="btn btn--link opinion__edit" onClick={() => setEditing(item)}>
                                                                <Pencil size={13} aria-hidden="true" />
                                                                {item.reason ? 'Modifier' : 'Expliquer pourquoi'}
                                                            </button>
                                                        )}
                                                    </div>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            {editing && <DislikeDialog item={library.items.find((it) => it.id === editing.id) || editing} open onClose={() => setEditing(null)} />}
        </div>
    );
}
