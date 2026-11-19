// Pages « Recommandations » et « Meh » : les avis publics de chaque profil, avec leur raison.
// Un titre choisi par plusieurs profils n'apparaît qu'une fois, avec l'avis de chacun.
// Sous chaque avis, les autres profils peuvent mettre un pouce : d'accord ou pas d'accord.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Pencil, Plus, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useApp } from '../state/app.jsx';
import { useUi } from '../state/ui.jsx';
import { api, avatarUrl } from '../lib/api.js';
import { Avatar } from '../components/ui/Avatar.jsx';
import { WorkCover } from '../components/WorkCover.jsx';
import { OpinionDialog, OPINIONS } from '../components/OpinionDialog.jsx';
import { newItem, progressOf, sameWork, unitLabel } from '../lib/items.js';
import { fetchSeasons, findEntry, coverOf } from '../lib/meta.js';

const PAGES = {
    reco: {
        title: 'Recommandations',
        load: () => api.getRecommendations(),
        emptyTitle: 'Personne n’a encore recommandé de titre',
        emptyText: 'Depuis la fiche d’un titre, choisis « Recommander » et explique pourquoi si tu veux : tout le monde pourra le lire ici.',
    },
    meh: {
        title: 'Meh',
        load: () => api.getDisliked(),
        emptyTitle: 'Personne n’a encore rangé de titre ici',
        emptyText: 'Depuis la fiche d’un titre, choisis « Meh » et explique pourquoi si tu veux : tout le monde pourra le lire ici.',
    },
};

const NO_VOTES = { up: [], down: [] };

export const RecommendationsPage = () => <OpinionsPage key="reco" kind="reco" />;
export const DislikedPage = () => <OpinionsPage key="meh" kind="meh" />;

function OpinionsPage({ kind }) {
    const page = PAGES[kind];
    const o = OPINIONS[kind];
    const { session, library, readOnly, addItem, updateItem } = useApp();
    const { toast } = useUi();
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [excluded, setExcluded] = useState(() => new Set());
    const [editing, setEditing] = useState(null); // titre de ta liste dont tu modifies la raison

    useEffect(() => {
        const load = () =>
            page
                .load()
                .then((d) => {
                    setData(d.profiles);
                    setError(null);
                })
                .catch((e) => setError(e.message));
        load();
        const onVisible = () => document.visibilityState === 'visible' && load();
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, [page]);

    // Ton profil vient de ta liste (à jour tout de suite), les autres du serveur.
    const profiles = useMemo(() => {
        if (!data) return null;
        return data.map((p) => {
            if (p.id !== session.profileId || !library) return p;
            const votes = new Map(p.items.map((it) => [it.id, it.votes]));
            const items = library.items
                .filter((it) => it[o.flag])
                .map((it) => ({ ...it, total: progressOf(it).total, reason: it[o.reason] || '', at: it[o.at] || it.updatedAt || 0, votes: votes.get(it.id) || NO_VOTES }));
            return { ...p, items };
        });
    }, [data, library, session.profileId, o]);

    const names = useMemo(() => new Map((profiles || []).map((p) => [p.id, p.name])), [profiles]);

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

    const setVotes = useCallback(
        (ownerId, itemId, votes) =>
            setData((list) => list.map((p) => (p.id !== ownerId ? p : { ...p, items: p.items.map((it) => (it.id === itemId ? { ...it, votes } : it)) }))),
        [],
    );

    // Pouce : affiché tout de suite, annulé si l'enregistrement échoue.
    const vote = async (ownerId, item, value) => {
        const me = session.profileId;
        const before = item.votes || NO_VOTES;
        const after = { up: before.up.filter((id) => id !== me), down: before.down.filter((id) => id !== me) };
        if (value === 1) after.up.push(me);
        if (value === -1) after.down.push(me);
        setVotes(ownerId, item.id, after);
        try {
            const res = await api.vote({ owner: ownerId, itemId: item.id, kind, value }, session.token);
            setVotes(ownerId, item.id, res.votes);
        } catch (err) {
            setVotes(ownerId, item.id, before);
            toast(err.message, { tone: 'error' });
        }
    };

    // Ajouter à sa liste un titre recommandé par quelqu'un d'autre.
    const add = async (work) => {
        const created = newItem(work.item);
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

    return (
        <div className="page">
            <div className="page__head">
                <h1 className="page__title">
                    {page.title}
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
                    <h2 className="empty__title">{excluded.size ? 'Rien pour les profils choisis' : page.emptyTitle}</h2>
                    <p className="empty__text">{page.emptyText}</p>
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
                                    {kind === 'reco' && !own && !readOnly && (
                                        <button className="btn btn--secondary btn--sm reco__add" onClick={() => add(work)}>
                                            <Plus size={15} aria-hidden="true" />
                                            Ajouter à ma liste
                                        </button>
                                    )}
                                    <ul className="opinions">
                                        {work.votes.map(({ profile, item }) => {
                                            const isMe = profile.id === session.profileId;
                                            return (
                                                <li key={profile.id} className="opinion">
                                                    <Link to={`/profil/${profile.id}`} aria-hidden="true" tabIndex={-1}>
                                                        <Avatar name={profile.name} src={avatarUrl(profile)} size="sm" />
                                                    </Link>
                                                    <div className="opinion__body">
                                                        <Link to={`/profil/${profile.id}`} className="opinion__who">
                                                            {profile.name}
                                                        </Link>
                                                        {item.reason ? <p className="opinion__text">{item.reason}</p> : <p className="opinion__text opinion__text--none">Pas de raison donnée.</p>}
                                                        <div className="opinion__foot">
                                                            <Votes
                                                                votes={item.votes || NO_VOTES}
                                                                me={session.profileId}
                                                                names={names}
                                                                canVote={!isMe && !readOnly && !!session.token}
                                                                own={isMe}
                                                                onVote={(value) => vote(profile.id, item, value)}
                                                            />
                                                            {isMe && !readOnly && item[o.flag] && (
                                                                <button className="btn btn--link opinion__edit" onClick={() => setEditing(item)}>
                                                                    <Pencil size={13} aria-hidden="true" />
                                                                    {item.reason ? 'Modifier' : 'Expliquer pourquoi'}
                                                                </button>
                                                            )}
                                                        </div>
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

            {editing && <OpinionDialog item={library.items.find((it) => it.id === editing.id) || editing} kind={kind} open onClose={() => setEditing(null)} />}
        </div>
    );
}

const joinNames = (list) => (list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} et ${list[list.length - 1]}`);

// Pouce vers le haut (d'accord) et vers le bas (pas d'accord), avec leur nombre.
// Un nouveau clic sur le même pouce le retire. On ne vote pas pour son propre avis.
function Votes({ votes, me, names, canVote, own, onVote }) {
    const my = votes.up.includes(me) ? 1 : votes.down.includes(me) ? -1 : 0;
    const who = (ids) => ids.map((id) => names.get(id)).filter(Boolean);
    const buttons = [
        { value: 1, ids: votes.up, Icon: ThumbsUp, label: 'D’accord', verb: (n) => (n > 1 ? 'sont d’accord' : 'est d’accord') },
        { value: -1, ids: votes.down, Icon: ThumbsDown, label: 'Pas d’accord', verb: (n) => (n > 1 ? 'ne sont pas d’accord' : 'n’est pas d’accord') },
    ];
    return (
        <div className="votes" role="group" aria-label="Pouces">
            {buttons.map(({ value, ids, Icon, label, verb }) => {
                const list = who(ids);
                const on = my === value;
                const hint = list.length ? `${joinNames(list)} ${verb(list.length)}` : own ? 'Personne pour l’instant' : label;
                return (
                    <button
                        key={value}
                        type="button"
                        className={`vote ${value === 1 ? 'vote--up' : 'vote--down'} ${on ? 'is-on' : ''}`}
                        aria-pressed={canVote ? on : undefined}
                        aria-disabled={!canVote}
                        aria-label={`${label} : ${ids.length}`}
                        title={hint}
                        onClick={() => canVote && onVote(on ? 0 : value)}
                    >
                        <Icon size={15} aria-hidden="true" />
                        <span className="vote__count">{ids.length}</span>
                    </button>
                );
            })}
        </div>
    );
}
