// Panneau « Nouveautés » : nouveaux chapitres/épisodes depuis la dernière vérification
// et prochaines sorties estimées.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { Dialog } from './ui/Dialog.jsx';
import { Cover } from './ui/Cover.jsx';
import { useApp } from '../state/app.jsx';
import { findEntries, nextBroadcast, nextChapterEstimate } from '../lib/meta.js';
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
        let failed = false;

        for (let start = 0; start < items.length; start += 50) {
            const chunk = items.slice(start, start + 50);
            let entries;
            try {
                entries = await findEntries(chunk, { fresh: true });
            } catch {
                failed = true;
                break;
            }
            for (let k = 0; k < chunk.length; k++) {
                const item = chunk[k];
                const entry = entries[k];
                if (!entry) continue;
                // Pour un anime en cours, on compte les épisodes déjà diffusés, pas le total prévu.
                const released = entry.nextEpisode?.number ? entry.nextEpisode.number - 1 : entry.total;
                if (released) {
                    const key = totalsKey(item);
                    const before = known[key] || item.total;
                    if (before && released > before) {
                        const diff = released - before;
                        news.push({
                            item,
                            text:
                                diff === 1
                                    ? `${item.type === 'Anime' ? 'Épisode' : 'Chapitre'} ${released} disponible`
                                    : `${diff} nouveaux ${unitLabel(item.type)}, jusqu’au ${released}`,
                        });
                    }
                    totals[key] = released;
                }
                if (!readOnly && !item.seasons?.length && entry.total && entry.total !== item.total && entry.total >= (item.current || 0)) {
                    updateItem(item.id, { total: entry.total }, { touch: false });
                }
                if (item.type === 'Anime') {
                    const date = nextBroadcast(entry);
                    if (date) {
                        const number = entry.nextEpisode?.number;
                        upcoming.push({ item, label: number ? `Épisode ${number}` : 'Prochain épisode', date, detail: null });
                    }
                } else {
                    const est = await nextChapterEstimate(entry);
                    if (est) {
                        const next = Math.max(entry.total || 0, item.total || 0, item.current || 0) + 1;
                        upcoming.push({
                            item,
                            label: `Chapitre ${next}`,
                            date: est.date,
                            detail: `${est.weekly ? 'Estimation hebdomadaire' : 'Estimation'}${est.magazine ? `, ${est.magazine}` : ''}`,
                        });
                    }
                }
            }
            setProgress({ done: Math.min(start + 50, items.length), total: items.length });
        }

        if (!readOnly && Object.keys(totals).length) setKnownTotals(totals);
        if (failed) {
            setProgress(null);
            setResult({ news, upcoming, checkedAt: new Date(), failed: true });
            return;
        }
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
                              ? result.failed
                                ? 'Les fiches ne répondent pas pour le moment : vérification incomplète. Réessaie dans quelques minutes.'
                                : `Dernière vérification à ${result.checkedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`
                              : 'Compare tes titres en cours avec leurs fiches pour repérer les nouvelles sorties.'}
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
