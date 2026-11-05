// Panneau « Nouveautés » : nouveaux chapitres/épisodes depuis la dernière vérification
// et prochaines sorties estimées.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { Dialog } from './ui/Dialog.jsx';
import { Cover } from './ui/Cover.jsx';
import { useApp } from '../state/app.jsx';
import { findEntry, summarize, nextBroadcast, nextChapterEstimate } from '../lib/jikan.js';
import { relativeDate, totalsKey, unitLabel } from '../lib/items.js';

export function ReleasesSheet({ open, onClose }) {
    const { library, readOnly, updateItem, setKnownTotals } = useApp();
    const [result, setResult] = useState(null); // { news, upcoming, checkedAt }
    const [progress, setProgress] = useState(null);

    const run = async () => {
        const items = (library?.items || []).filter((it) => it.status !== 'completed');
        const known = { ...(library?.lastKnownTotals || {}) };
        const news = [];
        const upcoming = [];
        const totals = {};
        setProgress({ done: 0, total: items.length });

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            try {
                const entry = await findEntry(item, { fresh: true });
                const info = summarize(entry, item.type);
                if (info?.total) {
                    const key = totalsKey(item);
                    const before = known[key] || item.total;
                    if (before && info.total > before) {
                        const diff = info.total - before;
                        news.push({
                            item,
                            text:
                                diff === 1
                                    ? `${item.type === 'Anime' ? 'Épisode' : 'Chapitre'} ${info.total} disponible`
                                    : `${diff} nouveaux ${unitLabel(item.type)}, jusqu’au ${info.total}`,
                        });
                    }
                    totals[key] = info.total;
                    if (!readOnly && !item.seasons?.length && info.total !== item.total && info.total >= (item.current || 0)) {
                        updateItem(item.id, { total: info.total }, { touch: false });
                    }
                }
                if (item.type === 'Anime') {
                    const date = nextBroadcast(entry);
                    // MAL ne donne souvent pas le nombre d'épisodes d'un anime en cours de diffusion.
                    if (date) upcoming.push({ item, label: info?.total ? `Épisode ${info.total + 1}` : 'Prochain épisode', date, detail: null });
                } else {
                    const est = nextChapterEstimate(entry);
                    if (est) {
                        const next = Math.max(info?.total || 0, item.total || 0, item.current || 0) + 1;
                        upcoming.push({
                            item,
                            label: `Chapitre ${next}`,
                            date: est.date,
                            detail: `${est.weekly ? 'Estimation hebdomadaire' : 'Estimation'}${est.magazine ? `, ${est.magazine}` : ''}`,
                        });
                    }
                }
            } catch {
                /* titre ignoré si MyAnimeList ne répond pas */
            }
            setProgress({ done: i + 1, total: items.length });
        }

        if (!readOnly && Object.keys(totals).length) setKnownTotals(totals);
        upcoming.sort((a, b) => a.date - b.date);
        setResult({ news, upcoming, checkedAt: new Date() });
        setProgress(null);
    };

    const checking = !!progress;

    return (
        <Dialog open={open} onClose={onClose} title="Nouveautés" variant="sheet" size="md">
            <div className="releases">
                <div className="releases__bar">
                    <p className="releases__intro">
                        {checking
                            ? `Vérification de ${progress.done} sur ${progress.total} titres en cours…`
                            : result
                              ? `Dernière vérification à ${result.checkedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`
                              : 'Compare tes titres en cours avec MyAnimeList pour repérer les nouvelles sorties.'}
                    </p>
                    <button className="btn btn--primary" onClick={run} disabled={checking}>
                        <RefreshCw size={16} className={checking ? 'spin' : ''} aria-hidden="true" />
                        {result ? 'Vérifier à nouveau' : 'Vérifier'}
                    </button>
                </div>
                {checking && <div className="meter" style={{ '--p': `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} />}

                {result && (
                    <>
                        <section className="releases__group">
                            <h3 className="releases__title">Nouvelles sorties</h3>
                            {result.news.length ? (
                                result.news.map((n) => <ReleaseRow key={n.item.id} item={n.item} title={n.text} onNavigate={onClose} highlight />)
                            ) : (
                                <p className="releases__empty">Rien de neuf depuis la dernière vérification.</p>
                            )}
                        </section>
                        <section className="releases__group">
                            <h3 className="releases__title">Prochaines sorties</h3>
                            {result.upcoming.length ? (
                                result.upcoming.map((u) => (
                                    <ReleaseRow key={u.item.id} item={u.item} title={u.label} sub={`${relativeDate(u.date)}${u.detail ? `. ${u.detail}` : ''}`} onNavigate={onClose} />
                                ))
                            ) : (
                                <p className="releases__empty">Aucune sortie prévue parmi tes titres en cours.</p>
                            )}
                        </section>
                    </>
                )}
            </div>
        </Dialog>
    );
}

function ReleaseRow({ item, title, sub, onNavigate, highlight }) {
    return (
        <Link to={`/oeuvre/${item.id}`} className={`release ${highlight ? 'release--new' : ''}`} onClick={onNavigate}>
            <Cover src={item.imageUrl} title={item.title} className="cover--thumb" />
            <span className="release__text">
                <span className="release__name">{item.title}</span>
                <span className="release__what">{title}</span>
                {sub && <span className="release__when">{sub}</span>}
            </span>
        </Link>
    );
}
