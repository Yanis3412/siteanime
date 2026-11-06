// Bibliothèque de chapitres d'un manga : liste, reprise de lecture, import, colorisation, stockage utilisé.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownUp, BookOpen, Check, CircleDot, Languages, MoreHorizontal, Palette, Trash2, Upload, X } from 'lucide-react';
import { useApp } from '../state/app.jsx';
import { useUi } from '../state/ui.jsx';
import { api } from '../lib/api.js';
import { Menu } from './ui/Menu.jsx';
import { ImportDialog } from './ImportDialog.jsx';
import { formatBytes, formatNum } from '../lib/importer.js';
import { isChapterRead, missingRanges } from '../lib/items.js';

const PAGE = 40;

// Versions que le programme du PC sait produire (les libellés servent aussi aux anciennes versions).
export const KINDS = {
    fr: { short: 'VF', job: 'Traduction', action: 'Traduire en français', redo: 'Refaire la traduction', icon: Languages },
    color: { short: 'Couleur', job: 'Colorisation', action: 'Coloriser', redo: 'Refaire la colorisation', icon: Palette },
    'fr-color': { short: 'VF couleur', job: 'Traduction et couleur', action: 'Traduire et coloriser', redo: 'Refaire la traduction en couleur', icon: Palette },
};
// Seule la colorisation est proposée (la traduction est désactivée, voir api/jobs.js).
const OFFERED = ['color'];

export function ChaptersSection({ item }) {
    const { session, writeTokenFor } = useApp();
    const { toast, confirm } = useUi();
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [importOpen, setImportOpen] = useState(false);
    const [shown, setShown] = useState(PAGE);
    const [desc, setDesc] = useState(true);
    const profileId = session.profileId;
    const token = writeTokenFor(profileId);

    const [jobs, setJobs] = useState([]);
    const [worker, setWorker] = useState(null);
    const activeRef = useRef(0);

    const load = useCallback(() => {
        api.chapters
            .list(profileId, item.id, token)
            .then((d) => {
                setData(d);
                setError(null);
            })
            .catch((e) => setError(e.message));
    }, [profileId, item.id, token]);

    const loadJobs = useCallback(async () => {
        try {
            const d = await api.jobs.list(profileId, item.id, token);
            const active = d.jobs.filter((j) => j.status !== 'error').length;
            // Une demande vient de se terminer : on recharge la liste pour afficher la nouvelle version.
            if (active < activeRef.current) load();
            activeRef.current = active;
            setJobs(d.jobs);
            setWorker(d.worker);
        } catch {
            /* état de la file indisponible : on réessaiera */
        }
    }, [profileId, item.id, token, load]);

    useEffect(load, [load]);
    useEffect(() => {
        loadJobs();
    }, [loadJobs]);

    // Suivi en direct tant que des demandes sont en attente ou en cours.
    const hasActive = jobs.some((j) => j.status === 'queued' || j.status === 'running');
    useEffect(() => {
        if (!hasActive) return;
        const timer = setInterval(loadJobs, 5000);
        return () => clearInterval(timer);
    }, [hasActive, loadJobs]);

    const jobFor = (num) => jobs.filter((j) => j.num === num);

    const requestKind = async (kind, nums) => {
        if (!nums.length) return toast('Aucun chapitre à traiter.');
        try {
            const res = await api.jobs.request({ profileId, itemId: item.id, nums, kind }, token);
            setWorker(res.worker);
            const count = res.jobs.length;
            toast(
                count
                    ? `${count} chapitre${count > 1 ? 's' : ''} en attente de ${KINDS[kind].job.toLowerCase()}.${res.worker?.online ? '' : ' Le coloriseur est éteint : ce sera fait dès qu’il sera lancé sur le PC.'}`
                    : 'Ces chapitres sont déjà en attente.',
                { tone: 'success', duration: 6000 },
            );
            loadJobs();
        } catch (e) {
            toast(e.message, { tone: 'error' });
        }
    };

    const cancelJob = async (job) => {
        try {
            await api.jobs.cancel(job.id, token);
            setJobs((list) => list.filter((j) => j.id !== job.id));
        } catch (e) {
            toast(e.message, { tone: 'error' });
        }
    };

    const chapters = data?.chapters || [];
    const sorted = useMemo(() => [...chapters].sort((a, b) => (desc ? b.num - a.num : a.num - b.num)), [chapters, desc]);
    const existing = useMemo(() => new Set(chapters.map((c) => c.num)), [chapters]);
    const missing = useMemo(() => missingRanges(chapters.map((c) => c.num)), [chapters]);

    // Chapitre à reprendre : celui commencé, sinon le premier non lu.
    const resume = useMemo(() => {
        const asc = [...chapters].sort((a, b) => a.num - b.num);
        return asc.find((c) => c.lastPage > 0 && !isChapterRead(c, item)) || asc.find((c) => !isChapterRead(c, item)) || null;
    }, [chapters, item]);

    const onImported = (chapter) =>
        setData((d) => ({
            ...d,
            chapters: [...(d?.chapters || []).filter((c) => c.num !== chapter.num), chapter],
            usage: d?.usage && { ...d.usage, profileBytes: d.usage.profileBytes + chapter.bytes, totalBytes: d.usage.totalBytes + chapter.bytes },
        }));

    const setRead = async (chapter, read) => {
        try {
            const res = await api.chapters.update({ profileId, itemId: item.id, num: chapter.num, read, ...(read ? {} : { lastPage: 0 }) }, token);
            setData((d) => ({ ...d, chapters: d.chapters.map((c) => (c.num === chapter.num ? res.chapter : c)) }));
        } catch (e) {
            toast(e.message, { tone: 'error' });
        }
    };

    const remove = async (chapter) => {
        const ok = await confirm({
            title: `Supprimer le chapitre ${formatNum(chapter.num)} ?`,
            message: 'Les pages seront effacées du stockage. Ta progression sur le titre ne change pas.',
            confirmLabel: 'Supprimer',
            danger: true,
        });
        if (!ok) return;
        try {
            const res = await api.chapters.remove(profileId, item.id, chapter.num, token);
            setData((d) => ({ ...d, chapters: d.chapters.filter((c) => c.num !== chapter.num), usage: res.usage || d.usage }));
            toast(`Chapitre ${formatNum(chapter.num)} supprimé.`);
        } catch (e) {
            toast(e.message, { tone: 'error' });
        }
    };

    if (error) {
        return (
            <section className="chapters">
                <h2 className="section-title">Chapitres</h2>
                <p className="form__error">{error}</p>
            </section>
        );
    }
    if (!data) {
        return (
            <section className="chapters">
                <h2 className="section-title">Chapitres</h2>
                <p className="muted">Chargement…</p>
            </section>
        );
    }
    if (!data.configured) {
        return (
            <section className="chapters">
                <h2 className="section-title">Chapitres</h2>
                <div className="notice">
                    <p>Le stockage des chapitres n’est pas encore branché.</p>
                    <p className="muted">Il faut ajouter les accès Cloudflare R2 dans les réglages Vercel du site (voir le README).</p>
                </div>
            </section>
        );
    }

    const usage = data.usage;
    const toColor = chapters.filter((c) => !isChapterRead(c, item) && !c.variants?.includes('color') && !jobFor(c.num).some((j) => j.kind === 'color' && j.status !== 'error'));
    const first = chapters.length ? Math.min(...chapters.map((c) => c.num)) : null;
    const last = chapters.length ? Math.max(...chapters.map((c) => c.num)) : null;

    return (
        <section className="chapters">
            <div className="chapters__head">
                <h2 className="section-title">
                    Chapitres <span className="chapters__count">{chapters.length || ''}</span>
                </h2>
                <div className="chapters__actions">
                    {chapters.length > 0 && (
                        <button
                            className="btn btn--secondary"
                            disabled={!toColor.length}
                            title={toColor.length ? undefined : 'Tous les chapitres non lus sont déjà en couleur ou en attente.'}
                            onClick={() => requestKind('color', toColor.map((c) => c.num))}
                        >
                            <Palette size={16} aria-hidden="true" />
                            Coloriser les non lus{toColor.length ? ` (${toColor.length})` : ''}
                        </button>
                    )}
                    {resume && (
                        <Link to={`/oeuvre/${item.id}/chapitre/${resume.num}`} className="btn btn--primary">
                            <BookOpen size={16} aria-hidden="true" />
                            {resume.lastPage > 0 ? 'Reprendre' : 'Lire'} le chapitre {formatNum(resume.num)}
                        </Link>
                    )}
                    <button className="btn btn--secondary" onClick={() => setImportOpen(true)}>
                        <Upload size={16} aria-hidden="true" />
                        Importer
                    </button>
                </div>
            </div>

            {chapters.length === 0 ? (
                <div className="notice">
                    <p>Aucun chapitre importé pour l’instant.</p>
                    <p className="muted">Importe des fichiers CBZ, ZIP, PDF ou des dossiers d’images pour les lire ici.</p>
                </div>
            ) : (
                <>
                    <div className="chapters__summary">
                        <span>
                            Du chapitre {formatNum(first)} au {formatNum(last)}
                            {missing.count > 0 ? `. Manquants : ${missing.text}` : ''}
                        </span>
                        <button className="btn btn--ghost btn--sm" onClick={() => setDesc((d) => !d)}>
                            <ArrowDownUp size={15} aria-hidden="true" />
                            {desc ? 'Plus récents d’abord' : 'Plus anciens d’abord'}
                        </button>
                    </div>
                    {(jobs.length > 0 || (worker && !worker.online && hasActive)) && (
                        <p className={`chapters__worker ${worker?.online ? 'is-online' : ''}`}>
                            <span className="chapters__dot" aria-hidden="true" />
                            {worker?.online
                                ? 'Coloriseur en ligne. Les chapitres sont traités un par un.'
                                : 'Coloriseur éteint. Les demandes seront traitées dès que lancer.bat tournera sur le PC.'}
                        </p>
                    )}
                    <ul className="chapters__list">
                        {sorted.slice(0, shown).map((c) => {
                            const read = isChapterRead(c, item);
                            const started = !read && c.lastPage > 0;
                            return (
                                <li key={c.num} className={`chapter ${read ? 'is-read' : ''}`}>
                                    <Link to={`/oeuvre/${item.id}/chapitre/${c.num}`} className="chapter__link">
                                        <span className="chapter__num">Chapitre {formatNum(c.num)}</span>
                                        {c.title && <span className="chapter__title">{c.title}</span>}
                                        <span className="chapter__meta" title={c.addedAt ? `Importé le ${new Date(c.addedAt).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}` : undefined}>
                                            {c.pages} pages{c.addedAt ? `, importé le ${new Date(c.addedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}` : ''}
                                        </span>
                                        {(c.variants || []).map((v) => (
                                            <span key={v} className="chapter__variant">
                                                {KINDS[v]?.short}
                                            </span>
                                        ))}
                                        {jobFor(c.num).map((j) => (
                                            <span key={j.id} className={`chapter__job is-${j.status}`} title={j.error || undefined}>
                                                {KINDS[j.kind]?.job}
                                                {j.status === 'queued' ? ' en attente' : j.status === 'running' ? ` : ${j.done}/${j.total || c.pages}` : ' en échec'}
                                            </span>
                                        ))}
                                        <span className={`chapter__state ${started ? 'is-started' : read ? 'is-read' : 'is-new'}`}>
                                            {read ? (
                                                <>
                                                    <Check size={14} aria-hidden="true" /> Lu
                                                </>
                                            ) : started ? (
                                                `Page ${c.lastPage + 1} sur ${c.pages}`
                                            ) : (
                                                <>
                                                    <CircleDot size={13} aria-hidden="true" /> Non lu
                                                </>
                                            )}
                                        </span>
                                    </Link>
                                    <Menu
                                        label={`Actions pour le chapitre ${formatNum(c.num)}`}
                                        trigger={(props) => (
                                            <button className="btn btn--ghost btn--icon btn--sm" {...props}>
                                                <MoreHorizontal size={17} />
                                            </button>
                                        )}
                                        items={[
                                            read
                                                ? { label: 'Marquer comme non lu', icon: CircleDot, onSelect: () => setRead(c, false) }
                                                : { label: 'Marquer comme lu', icon: Check, onSelect: () => setRead(c, true) },
                                            'separator',
                                            ...OFFERED.map((kind) => {
                                                const k = KINDS[kind];
                                                const pending = jobFor(c.num).find((j) => j.kind === kind && j.status !== 'error');
                                                return {
                                                    label: pending ? `${k.job} déjà demandée` : c.variants?.includes(kind) ? k.redo : k.action,
                                                    icon: k.icon,
                                                    disabled: !!pending,
                                                    onSelect: () => requestKind(kind, [c.num]),
                                                };
                                            }),
                                            ...jobFor(c.num)
                                                .filter((j) => j.status !== 'running')
                                                .map((j) => ({ label: `Annuler : ${KINDS[j.kind]?.job.toLowerCase()}`, icon: X, onSelect: () => cancelJob(j) })),
                                            'separator',
                                            { label: 'Supprimer le chapitre', icon: Trash2, danger: true, onSelect: () => remove(c) },
                                        ]}
                                    />
                                </li>
                            );
                        })}
                    </ul>
                    {sorted.length > shown && (
                        <button className="btn btn--secondary chapters__more" onClick={() => setShown((n) => n + PAGE)}>
                            Afficher {Math.min(PAGE, sorted.length - shown)} chapitres de plus
                        </button>
                    )}
                </>
            )}

            {usage && (
                <div className="storage">
                    <div className="storage__text">
                        <span>
                            Stockage : {formatBytes(usage.totalBytes)} utilisés sur {formatBytes(usage.limitBytes)}
                        </span>
                        <span className="muted">dont {formatBytes(usage.profileBytes)} pour toi</span>
                    </div>
                    <div className="meter meter--thin" style={{ '--p': `${Math.min(100, (usage.totalBytes / usage.limitBytes) * 100)}%` }} />
                </div>
            )}

            <ImportDialog
                open={importOpen}
                onClose={() => setImportOpen(false)}
                item={item}
                profileId={profileId}
                token={token}
                existing={existing}
                onImported={onImported}
            />
        </section>
    );
}
