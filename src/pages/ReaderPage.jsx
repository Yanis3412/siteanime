// Liseuse : page par page ou en défilement vertical, sens de lecture japonais ou occidental.
// La page atteinte est enregistrée, et finir un chapitre met à jour la progression du titre.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Maximize, Minimize, Settings2 } from 'lucide-react';
import { useApp } from '../state/app.jsx';
import { api } from '../lib/api.js';
import { load, save } from '../lib/storage.js';
import { formatNum } from '../lib/importer.js';
import { progressAfterReading } from '../lib/items.js';

const DEFAULTS = { mode: 'paged', direction: 'rtl', fit: 'height' };

export function ReaderPage() {
    const { id, num } = useParams();
    const navigate = useNavigate();
    const { session, library, writeTokenFor, updateItem } = useApp();
    const item = library?.items.find((it) => it.id === id);
    const profileId = session.profileId;
    const token = writeTokenFor(profileId);

    const [settings, setSettings] = useState(() => ({ ...DEFAULTS, ...load('reader', {}) }));
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [page, setPage] = useState(0);
    const [ended, setEnded] = useState(false);
    const [ui, setUi] = useState(true);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [fullscreen, setFullscreen] = useState(false);
    const rootRef = useRef(null);
    const markedRef = useRef(false);
    const refetchedRef = useRef(false);
    const saveTimer = useRef(null);

    const changeSettings = (changes) =>
        setSettings((s) => {
            const next = { ...s, ...changes };
            save('reader', next);
            return next;
        });

    // Chargement du chapitre (liens de lecture valables quelques heures).
    const fetchChapter = useCallback(
        () =>
            api.chapters.get(profileId, id, num, token).then((d) => {
                setData(d);
                return d;
            }),
        [profileId, id, num, token],
    );

    useEffect(() => {
        setData(null);
        setError(null);
        setEnded(false);
        markedRef.current = false;
        refetchedRef.current = false;
        fetchChapter()
            .then((d) => {
                const resumeAt = d.chapter.read ? 0 : d.chapter.lastPage || 0;
                setPage(Math.min(resumeAt, d.pages.length - 1));
                if (d.chapter.read) markedRef.current = true;
            })
            .catch((e) => setError(e.status === 404 ? 'Ce chapitre n’existe plus.' : e.message));
    }, [fetchChapter]);

    useEffect(() => {
        if (!item || !data) return;
        const before = document.title;
        document.title = `${item.title}, chapitre ${formatNum(data.chapter.num)}`;
        return () => {
            document.title = before;
        };
    }, [item, data]);

    const total = data?.pages.length || 0;

    // Enregistre la page atteinte et marque le chapitre comme lu à la dernière page.
    const itemRef = useRef(item);
    itemRef.current = item;
    useEffect(() => {
        if (!data) return;
        clearTimeout(saveTimer.current);
        const current = data.chapter.num;
        if (page >= total - 1 && !markedRef.current) {
            markedRef.current = true;
            api.chapters.update({ profileId, itemId: id, num: current, read: true, lastPage: page }, token).catch(() => {});
            if (itemRef.current) updateItem(itemRef.current.id, (it) => progressAfterReading(it, current));
            return;
        }
        saveTimer.current = setTimeout(() => {
            api.chapters.update({ profileId, itemId: id, num: current, lastPage: page }, token).catch(() => {});
        }, 1200);
        return () => clearTimeout(saveTimer.current);
    }, [page, data, total, profileId, id, token, updateItem]);

    const pageRef = useRef(0);
    pageRef.current = page;
    const go = useCallback(
        (delta) => {
            if (!total) return;
            const next = pageRef.current + delta;
            if (next >= total) return setEnded(true);
            setEnded(false);
            setPage(Math.max(0, next));
        },
        [total],
    );

    const goChapter = (target) => target !== null && target !== undefined && navigate(`/oeuvre/${id}/chapitre/${target}`);

    const toggleFullscreen = useCallback(() => {
        if (document.fullscreenElement) document.exitFullscreen?.();
        else rootRef.current?.requestFullscreen?.().catch(() => {});
    }, []);

    useEffect(() => {
        const onChange = () => setFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', onChange);
        return () => document.removeEventListener('fullscreenchange', onChange);
    }, []);

    // Clavier : flèches selon le sens de lecture, espace, début/fin, F, Échap.
    useEffect(() => {
        const onKey = (e) => {
            if (e.target.closest?.('input, select, textarea')) return;
            const rtl = settings.direction === 'rtl';
            if (e.key === 'ArrowRight') settings.mode === 'paged' && (e.preventDefault(), go(rtl ? -1 : 1));
            else if (e.key === 'ArrowLeft') settings.mode === 'paged' && (e.preventDefault(), go(rtl ? 1 : -1));
            else if ((e.key === ' ' || e.key === 'PageDown') && settings.mode === 'paged') (e.preventDefault(), go(e.shiftKey ? -1 : 1));
            else if (e.key === 'PageUp' && settings.mode === 'paged') (e.preventDefault(), go(-1));
            else if (e.key === 'Home') setPage(0);
            else if (e.key === 'End') setPage(Math.max(0, total - 1));
            else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
            else if (e.key === 'Escape' && settingsOpen) setSettingsOpen(false);
            else if (e.key === 'Escape' && !document.fullscreenElement) navigate(`/oeuvre/${id}`);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [go, settings, total, toggleFullscreen, navigate, id, settingsOpen]);

    // Masque les barres après quelques secondes sans bouger la souris (mode page par page).
    useEffect(() => {
        if (settings.mode !== 'paged' || settingsOpen) return;
        let timer = setTimeout(() => setUi(false), 2600);
        const onMove = (e) => {
            if (e.pointerType === 'touch') return;
            setUi(true);
            clearTimeout(timer);
            timer = setTimeout(() => setUi(false), 2600);
        };
        window.addEventListener('pointermove', onMove);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('pointermove', onMove);
        };
    }, [settings.mode, settingsOpen]);

    // Liens expirés (lecture très longue) : on recharge une fois les liens des pages.
    const onImageError = () => {
        if (refetchedRef.current) return;
        refetchedRef.current = true;
        fetchChapter().catch(() => {});
    };

    const back = `/oeuvre/${id}`;
    const chapterLabel = data ? `Chapitre ${formatNum(data.chapter.num)}` : `Chapitre ${formatNum(num)}`;

    if (error) {
        return (
            <div className="reader reader--message">
                <p>{error}</p>
                <Link to={back} className="btn btn--secondary">
                    Retour au titre
                </Link>
            </div>
        );
    }

    return (
        <div ref={rootRef} className={`reader reader--${settings.mode} ${ui || ended ? 'show-ui' : ''}`}>
            <header className="reader__bar">
                <Link to={back} className="reader__back" aria-label="Retour au titre">
                    <ArrowLeft size={18} />
                    <span className="reader__series">{item?.title}</span>
                </Link>
                <div className="reader__title">
                    {chapterLabel}
                    {data?.chapter.title && <span className="reader__subtitle">{data.chapter.title}</span>}
                </div>
                <div className="reader__tools">
                    <button className="reader__icon" onClick={() => setSettingsOpen((o) => !o)} aria-label="Réglages de lecture" aria-expanded={settingsOpen}>
                        <Settings2 size={19} />
                    </button>
                    <button className="reader__icon" onClick={toggleFullscreen} aria-label={fullscreen ? 'Quitter le plein écran' : 'Plein écran'}>
                        {fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
                    </button>
                </div>
                {settingsOpen && <ReaderSettings settings={settings} onChange={changeSettings} onClose={() => setSettingsOpen(false)} />}
            </header>

            {!data ? (
                <div className="reader__loading">Chargement du chapitre…</div>
            ) : settings.mode === 'paged' ? (
                <PagedView
                    pages={data.pages}
                    page={page}
                    settings={settings}
                    onPrev={() => go(-1)}
                    onNext={() => go(1)}
                    onToggleUi={() => setUi((u) => !u)}
                    onImageError={onImageError}
                />
            ) : (
                <ScrollView pages={data.pages} page={page} onPage={setPage} onImageError={onImageError}>
                    <EndOfChapter data={data} item={item} onNext={() => goChapter(data.next)} back={back} />
                </ScrollView>
            )}

            {data && settings.mode === 'paged' && ended && (
                <div className="reader__end">
                    <EndOfChapter data={data} item={item} onNext={() => goChapter(data.next)} back={back} onStay={() => setEnded(false)} />
                </div>
            )}

            {data && (
                <footer className="reader__foot">
                    <button className="reader__chap" onClick={() => goChapter(settings.direction === 'rtl' && settings.mode === 'paged' ? data.next : data.prev)} disabled={(settings.direction === 'rtl' && settings.mode === 'paged' ? data.next : data.prev) === null}>
                        <ChevronLeft size={18} aria-hidden="true" />
                        <span>{settings.direction === 'rtl' && settings.mode === 'paged' ? 'Suivant' : 'Précédent'}</span>
                    </button>
                    <div className="reader__slider">
                        <input
                            type="range"
                            min="0"
                            max={Math.max(0, total - 1)}
                            value={page}
                            dir={settings.mode === 'paged' && settings.direction === 'rtl' ? 'rtl' : 'ltr'}
                            onChange={(e) => {
                                setEnded(false);
                                setPage(Number(e.target.value));
                            }}
                            aria-label="Aller à la page"
                        />
                        <span className="reader__count">
                            {page + 1} / {total}
                        </span>
                    </div>
                    <button className="reader__chap" onClick={() => goChapter(settings.direction === 'rtl' && settings.mode === 'paged' ? data.prev : data.next)} disabled={(settings.direction === 'rtl' && settings.mode === 'paged' ? data.prev : data.next) === null}>
                        <span>{settings.direction === 'rtl' && settings.mode === 'paged' ? 'Précédent' : 'Suivant'}</span>
                        <ChevronRight size={18} aria-hidden="true" />
                    </button>
                </footer>
            )}
        </div>
    );
}

function PagedView({ pages, page, settings, onPrev, onNext, onToggleUi, onImageError }) {
    const scrollRef = useRef(null);

    // Préchargement des pages suivantes.
    useEffect(() => {
        for (let i = page + 1; i <= page + 3 && i < pages.length; i++) {
            const img = new Image();
            img.src = pages[i];
        }
        scrollRef.current?.scrollTo({ top: 0 });
    }, [page, pages]);

    // Zones de clic : bords pour tourner les pages (selon le sens), centre pour les barres.
    const onClick = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const rtl = settings.direction === 'rtl';
        if (x < 0.35) rtl ? onNext() : onPrev();
        else if (x > 0.65) rtl ? onPrev() : onNext();
        else onToggleUi();
    };

    return (
        <div ref={scrollRef} className={`paged paged--${settings.fit}`} onClick={onClick}>
            <img key={pages[page]} className="paged__img" src={pages[page]} alt={`Page ${page + 1}`} onError={onImageError} draggable="false" />
        </div>
    );
}

function ScrollView({ pages, page, onPage, onImageError, children }) {
    const listRef = useRef(null);
    const initial = useRef(page);

    // Reprise : on se place sur la dernière page lue.
    useEffect(() => {
        const target = listRef.current?.querySelector(`[data-index="${initial.current}"]`);
        if (initial.current > 0 && target) target.scrollIntoView({ block: 'start' });
    }, []);

    // La page courante est celle qui traverse le milieu de l'écran.
    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) if (entry.isIntersecting) onPage(Number(entry.target.dataset.index));
            },
            { rootMargin: '-50% 0px -50% 0px' },
        );
        listRef.current?.querySelectorAll('img[data-index]').forEach((img) => observer.observe(img));
        return () => observer.disconnect();
    }, [pages, onPage]);

    // Le curseur de page fait défiler jusqu'à la page choisie.
    const lastScrolled = useRef(page);
    useEffect(() => {
        if (Math.abs(page - lastScrolled.current) > 1) {
            listRef.current?.querySelector(`[data-index="${page}"]`)?.scrollIntoView({ block: 'start' });
        }
        lastScrolled.current = page;
    }, [page]);

    return (
        <div className="scrollview" ref={listRef}>
            {pages.map((src, i) => (
                <img key={src} data-index={i} className="scrollview__img" src={src} alt={`Page ${i + 1}`} loading={Math.abs(i - initial.current) < 3 ? 'eager' : 'lazy'} onError={onImageError} />
            ))}
            {children}
        </div>
    );
}

function EndOfChapter({ data, item, onNext, back, onStay }) {
    return (
        <div className="endpanel">
            <p className="endpanel__title">Fin du chapitre {formatNum(data.chapter.num)}</p>
            {item && <p className="endpanel__text">Ta progression sur {item.title} est à jour.</p>}
            <div className="endpanel__actions">
                {data.next !== null ? (
                    <button className="btn btn--primary" onClick={onNext}>
                        Chapitre {formatNum(data.next)}
                        <ChevronRight size={16} aria-hidden="true" />
                    </button>
                ) : (
                    <p className="endpanel__text">Le chapitre suivant n’est pas encore importé.</p>
                )}
                <Link to={back} className="btn btn--secondary">
                    Retour au titre
                </Link>
                {onStay && (
                    <button className="btn btn--ghost" onClick={onStay}>
                        Revoir la dernière page
                    </button>
                )}
            </div>
        </div>
    );
}

function ReaderSettings({ settings, onChange, onClose }) {
    const ref = useRef(null);
    useEffect(() => {
        const onDown = (e) => {
            if (!ref.current?.contains(e.target) && !e.target.closest('[aria-label="Réglages de lecture"]')) onClose();
        };
        document.addEventListener('pointerdown', onDown);
        return () => document.removeEventListener('pointerdown', onDown);
    }, [onClose]);

    const options = useMemo(
        () => [
            { key: 'mode', label: 'Affichage', values: [['paged', 'Page par page'], ['scroll', 'Défilement']] },
            { key: 'direction', label: 'Sens de lecture', values: [['rtl', 'Japonais'], ['ltr', 'Occidental']], hidden: settings.mode !== 'paged' },
            { key: 'fit', label: 'Taille des pages', values: [['height', 'Hauteur de l’écran'], ['width', 'Largeur']], hidden: settings.mode !== 'paged' },
        ],
        [settings.mode],
    );

    return (
        <div className="reader__settings" ref={ref} role="dialog" aria-label="Réglages de lecture">
            {options
                .filter((o) => !o.hidden)
                .map((o) => (
                    <div key={o.key} className="reader__setting">
                        <span className="reader__setting-label">{o.label}</span>
                        <div className="segmented" role="radiogroup" aria-label={o.label}>
                            {o.values.map(([value, label]) => (
                                <button key={value} role="radio" aria-checked={settings[o.key] === value} className={`segmented__opt ${settings[o.key] === value ? 'is-active' : ''}`} onClick={() => onChange({ [o.key]: value })}>
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                ))}
            <p className="reader__keys">Flèches pour tourner les pages, F pour le plein écran, Échap pour quitter.</p>
        </div>
    );
}
