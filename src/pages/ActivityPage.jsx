// Activité entre amis : chiffres de chaque profil, puis les dernières nouvelles (ajouts, épisodes vus,
// chapitres lus, séries terminées, chapitres importés), regroupées par jour.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/app.jsx';
import { api, avatarUrl } from '../lib/api.js';
import { Avatar } from '../components/ui/Avatar.jsx';
import { formatNum } from '../lib/importer.js';

const EPISODE_MINUTES = 23;
const n = (v) => v.toLocaleString('fr-FR');
const plural = (v, one, many) => `${n(v)} ${v > 1 ? many : one}`;

// Temps passé devant les animes, à partir du nombre d'épisodes.
function watchTime(episodes) {
    const hours = Math.round((episodes * EPISODE_MINUTES) / 60);
    if (hours < 1) return episodes ? 'moins d’1 h' : '0 h';
    if (hours < 48) return `${hours} h`;
    const days = Math.floor(hours / 24);
    const rest = hours % 24;
    return rest ? `${days} j ${rest} h` : `${days} j`;
}

// Phrase d'une ligne d'activité (sans le nom du profil).
function describe(e) {
    const unit = e.type === 'Anime' ? ['épisode', 'épisodes'] : ['chapitre', 'chapitres'];
    const verb = e.type === 'Anime' ? 'a vu' : 'a lu';
    switch (e.kind) {
        case 'added':
            if (e.done) return ['a ajouté', e.type === 'Anime' ? 'à sa liste, déjà vu en entier' : 'à sa liste, déjà lu en entier'];
            return ['a ajouté', e.fav ? 'à sa watchlist' : 'à sa liste'];
        case 'progress': {
            const count = e.to - e.from;
            if (e.seasons) return [`${verb} ${plural(count, unit[0], unit[1])} de`, ''];
            if (count === 1) return [`${verb} le ${unit[0]} ${formatNum(e.to)} de`, ''];
            return [`${verb} les ${unit[1]} ${formatNum(e.from + 1)} à ${formatNum(e.to)} de`, ''];
        }
        case 'finished':
            return ['a terminé', ''];
        case 'watchlist':
            return ['a mis', 'dans sa watchlist'];
        case 'recommended':
            return ['recommande', ''];
        case 'imported': {
            const nums = e.nums || [];
            if (nums.length === 1) return [`a importé le chapitre ${formatNum(nums[0])} de`, ''];
            return [`a importé ${nums.length} chapitres de`, `(${formatNum(nums[0])} à ${formatNum(nums[nums.length - 1])})`];
        }
        case 'bulk':
            return [`a mis à jour sa liste (${plural(e.count, 'changement', 'changements')})`, ''];
        default:
            return ['', ''];
    }
}

function dayLabel(ms) {
    const d = new Date(ms);
    const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((start(new Date()) - start(d)) / 86400000);
    if (diff === 0) return 'Aujourd’hui';
    if (diff === 1) return 'Hier';
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function ActivityPage() {
    const { session, library } = useApp();
    const [stats, setStats] = useState(null);
    const [entries, setEntries] = useState(null);
    const [more, setMore] = useState(false);
    const [error, setError] = useState('');

    const load = useCallback(() => {
        api.activity
            .stats()
            .then((d) => setStats(d.profiles))
            .catch(() => {});
        api.activity
            .feed()
            .then((d) => {
                setEntries(d.entries);
                setMore(d.more);
                setError('');
            })
            .catch((err) => setError(err.message));
    }, []);

    useEffect(() => {
        load();
        const onVisible = () => document.visibilityState === 'visible' && load();
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, [load]);

    const loadMore = async () => {
        const last = entries[entries.length - 1];
        const d = await api.activity.feed(last.at);
        setEntries((list) => [...list, ...d.entries]);
        setMore(d.more);
    };

    // Regroupement par jour.
    const days = [];
    for (const e of entries || []) {
        const label = dayLabel(e.at);
        if (days[days.length - 1]?.label !== label) days.push({ label, entries: [] });
        days[days.length - 1].entries.push(e);
    }

    const myItem = (e) => e.profile.id === session.profileId && library?.items.some((it) => it.id === e.itemId);

    return (
        <div className="page activity">
            <div className="page__head">
                <h1 className="page__title">Activité</h1>
            </div>

            {stats && stats.length > 0 && (
                <section className="activity__section">
                    <h2 className="section-title">Profils</h2>
                    <table className="stats">
                        <thead>
                            <tr>
                                <th scope="col">Profil</th>
                                <th scope="col">Épisodes vus</th>
                                <th scope="col">Devant les animes</th>
                                <th scope="col">Chapitres lus</th>
                                <th scope="col">Séries finies</th>
                                <th scope="col">En cours</th>
                                <th scope="col">Watchlist</th>
                            </tr>
                        </thead>
                        <tbody>
                            {stats.map((p) => (
                                <tr key={p.id} className={p.id === session.profileId ? 'is-me' : ''}>
                                    <th scope="row">
                                        <span className="stats__who">
                                            <Avatar name={p.name} src={avatarUrl(p)} size="sm" />
                                            {p.name}
                                        </span>
                                    </th>
                                    <td data-label="Épisodes vus">{n(p.episodes)}</td>
                                    <td data-label="Devant les animes">≈ {watchTime(p.episodes)}</td>
                                    <td data-label="Chapitres lus">{n(p.chapters)}</td>
                                    <td data-label="Séries finies" title={`${p.finishedAnime} animes, ${p.finishedManga} mangas`}>
                                        {n(p.finishedAnime + p.finishedManga)}
                                    </td>
                                    <td data-label="En cours">{n(p.inProgress)}</td>
                                    <td data-label="Watchlist">{n(p.watchlist)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <p className="activity__note">Temps estimé à {EPISODE_MINUTES} minutes par épisode.</p>
                </section>
            )}

            <section className="activity__section">
                <h2 className="section-title">Dernières nouvelles</h2>
                {error && <p className="form__error">{error}</p>}
                {entries && entries.length === 0 && (
                    <p className="activity__empty">
                        Rien pour l’instant. À partir de maintenant, les titres ajoutés, les épisodes vus, les chapitres lus et importés et les séries terminées de chaque profil
                        apparaîtront ici.
                    </p>
                )}
                {days.map((day) => (
                    <div key={day.label} className="feed__day">
                        <h3 className="feed__date">{day.label}</h3>
                        <ul className="feed">
                            {day.entries.map((e) => {
                                const [before, after] = describe(e);
                                const title = e.title && (myItem(e) ? <Link to={`/oeuvre/${e.itemId}`}>{e.title}</Link> : <strong>{e.title}</strong>);
                                return (
                                    <li key={e.id} className="feed__row">
                                        <Avatar name={e.profile.name} src={avatarUrl(e.profile)} size="sm" />
                                        <p className="feed__text">
                                            <strong>{e.profile.name}</strong> {before} {title} {after}
                                        </p>
                                        <time className="feed__time" dateTime={new Date(e.at).toISOString()}>
                                            {new Date(e.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                        </time>
                                        {e.imageUrl ? <img className="feed__cover" src={e.imageUrl} alt="" loading="lazy" /> : <span className="feed__cover" aria-hidden="true" />}
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ))}
                {more && (
                    <button className="btn btn--secondary activity__more" onClick={loadMore}>
                        Voir plus
                    </button>
                )}
            </section>
        </div>
    );
}
