// Page de profil : bannière, photo (le GIF bouge ici seulement), bio, chiffres, top 3 Anime / Manga
// et derniers avis (recommandations et « Meh »). Chacun modifie la sienne avec « Modifier le profil ».
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useApp } from '../state/app.jsx';
import { api, avatarUrl, mediaUrl } from '../lib/api.js';
import { Avatar } from '../components/ui/Avatar.jsx';
import { Cover } from '../components/ui/Cover.jsx';
import { Framed } from '../components/ui/Framed.jsx';
import { WorkCover } from '../components/WorkCover.jsx';
import { ProfileEditor } from '../components/ProfileEditor.jsx';
import { watchTime } from '../lib/stats.js';

const n = (v) => v.toLocaleString('fr-FR');

// Même teinte que la pastille du profil (voir Avatar).
function hueOf(name = '') {
    let hash = 0;
    for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return hash % 360;
}

function useReducedMotion() {
    const query = '(prefers-reduced-motion: reduce)';
    const [reduce, setReduce] = useState(() => window.matchMedia?.(query).matches ?? false);
    useEffect(() => {
        const mq = window.matchMedia?.(query);
        if (!mq) return;
        const on = () => setReduce(mq.matches);
        mq.addEventListener('change', on);
        return () => mq.removeEventListener('change', on);
    }, []);
    return reduce;
}

export function ProfilePage() {
    const { id } = useParams();
    const { profiles, session, library, readOnly } = useApp();
    const reduce = useReducedMotion();
    const [editing, setEditing] = useState(false);
    const [theirLibrary, setTheirLibrary] = useState(null);
    const [stats, setStats] = useState(null);
    const [opinions, setOpinions] = useState(null);

    const profile = profiles?.find((p) => p.id === id) || null;
    const isMe = id === session.profileId;
    const canEdit = isMe && !readOnly;

    useEffect(() => {
        let alive = true;
        setStats(null);
        setOpinions(null);
        setTheirLibrary(null);
        if (!isMe) {
            api.getLibrary(id)
                .then((l) => alive && setTheirLibrary(l))
                .catch(() => alive && setTheirLibrary({ items: [] }));
        }
        api.activity
            .stats()
            .then((d) => alive && setStats(d.profiles.find((p) => p.id === id) || null))
            .catch(() => {});
        Promise.all([api.getRecommendations(), api.getDisliked()])
            .then(([reco, meh]) => {
                if (!alive) return;
                const of = (d) => (d.profiles.find((p) => p.id === id)?.items || []).sort((a, b) => b.at - a.at);
                setOpinions({ reco: of(reco), meh: of(meh) });
            })
            .catch(() => {});
        return () => {
            alive = false;
        };
    }, [id, isMe]);

    const items = (isMe ? library : theirLibrary)?.items;
    const tops = useMemo(() => {
        if (!profile || !items) return null;
        const pick = (ids) => (ids || []).map((tid) => items.find((it) => it.id === tid)).filter(Boolean);
        return { anime: pick(profile.top?.anime), manga: pick(profile.top?.manga) };
    }, [profile, items]);

    if (!profiles) return <div className="page muted">Chargement…</div>;
    if (!profile) {
        return (
            <div className="page">
                <div className="empty">
                    <h1 className="empty__title">Profil introuvable</h1>
                    <p className="empty__text">Ce profil a peut-être été supprimé.</p>
                    <Link className="btn btn--secondary" to="/activite">
                        Voir l’activité
                    </Link>
                </div>
            </div>
        );
    }

    const bannerSrc = profile.banner ? mediaUrl(profile, 'banner', { still: reduce }) : null;
    const anim = profile.anim && !reduce ? { src: mediaUrl(profile, 'anim'), frame: profile.anim } : null;

    return (
        <div className="page profile" style={{ '--profile-hue': hueOf(profile.name) }}>
            <div className={`profile__banner ${bannerSrc ? '' : 'is-empty'}`}>{bannerSrc && <Framed src={bannerSrc} frame={profile.banner} />}</div>

            <header className="profile__head">
                <div className="profile__avatar">
                    <Avatar name={profile.name} src={avatarUrl(profile)} size="xl" anim={anim} />
                </div>
                <div className="profile__id">
                    <h1 className="profile__name">{profile.name}</h1>
                    {profile.bio ? (
                        <p className="profile__bio">{profile.bio}</p>
                    ) : (
                        canEdit && <p className="profile__bio profile__bio--empty">Pas encore de bio. Présente-toi avec « Modifier le profil ».</p>
                    )}
                </div>
                {canEdit && (
                    <button className="btn btn--secondary profile__edit" onClick={() => setEditing(true)}>
                        <Pencil size={16} aria-hidden="true" />
                        Modifier le profil
                    </button>
                )}
            </header>

            {stats && (
                <dl className="profile__stats">
                    <div>
                        <dt>Épisodes vus</dt>
                        <dd>{n(stats.episodes)}</dd>
                    </div>
                    <div>
                        <dt>Devant les animes</dt>
                        <dd>≈ {watchTime(stats.episodes)}</dd>
                    </div>
                    <div>
                        <dt>Chapitres lus</dt>
                        <dd>{n(stats.chapters)}</dd>
                    </div>
                    <div>
                        <dt>Séries finies</dt>
                        <dd>{n(stats.finishedAnime + stats.finishedManga)}</dd>
                    </div>
                </dl>
            )}

            <div className="profile__tops">
                <TopList title="Top 3 Anime" list={tops?.anime} linkable={isMe} empty={canEdit ? 'Choisis tes 3 animes préférés avec « Modifier le profil ».' : 'Pas encore de top 3.'} />
                <TopList title="Top 3 Manga" list={tops?.manga} linkable={isMe} empty={canEdit ? 'Choisis tes 3 mangas préférés avec « Modifier le profil ».' : 'Pas encore de top 3.'} />
            </div>

            {opinions && (opinions.reco.length > 0 || opinions.meh.length > 0) && (
                <div className="profile__opinions">
                    <OpinionList title="Recommande" to="/recommandations" list={opinions.reco} />
                    <OpinionList title="Meh" to="/meh" list={opinions.meh} />
                </div>
            )}

            {canEdit && <ProfileEditor open={editing} onClose={() => setEditing(false)} profile={profile} />}
        </div>
    );
}

// Les trois titres préférés, du n° 1 au n° 3.
function TopList({ title, list, linkable, empty }) {
    return (
        <section className="top">
            <h2 className="section-title">{title}</h2>
            {!list ? (
                <p className="muted">Chargement…</p>
            ) : list.length === 0 ? (
                <p className="top__empty">{empty}</p>
            ) : (
                <ol className="top__list">
                    {list.map((it, i) => {
                        const body = (
                            <>
                                <span className="top__rank" aria-hidden="true">
                                    {i + 1}
                                </span>
                                <Cover src={it.imageUrl} title={it.title} className="top__cover" />
                                <span className="top__title">{it.title}</span>
                            </>
                        );
                        return (
                            <li key={it.id} className={`top__item top__item--${i + 1}`} aria-label={`N° ${i + 1} : ${it.title}`}>
                                {linkable ? (
                                    <Link to={`/oeuvre/${it.id}`} className="top__link">
                                        {body}
                                    </Link>
                                ) : (
                                    <div className="top__link">{body}</div>
                                )}
                            </li>
                        );
                    })}
                </ol>
            )}
        </section>
    );
}

// Derniers avis publics du profil, avec leur raison et leurs pouces.
function OpinionList({ title, to, list }) {
    return (
        <section className="pop">
            <div className="pop__head">
                <h2 className="section-title">{title}</h2>
                {list.length > 0 && (
                    <Link to={to} className="pop__all">
                        Tout voir
                    </Link>
                )}
            </div>
            {list.length === 0 ? (
                <p className="top__empty">Rien pour l’instant.</p>
            ) : (
                <ul className="pop__list">
                    {list.slice(0, 3).map((it) => (
                        <li key={it.id} className="pop__item">
                            <WorkCover item={it} className="cover--thumb" />
                            <div className="pop__text">
                                <span className="pop__title">{it.title}</span>
                                {it.reason ? <p className="pop__reason">{it.reason}</p> : <p className="pop__reason pop__reason--none">Pas de raison donnée.</p>}
                                <span className="pop__votes" aria-label={`${it.votes.up.length} d’accord, ${it.votes.down.length} pas d’accord`}>
                                    <span className="pop__vote pop__vote--up">
                                        <ThumbsUp size={13} aria-hidden="true" />
                                        {it.votes.up.length}
                                    </span>
                                    <span className="pop__vote pop__vote--down">
                                        <ThumbsDown size={13} aria-hidden="true" />
                                        {it.votes.down.length}
                                    </span>
                                </span>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
