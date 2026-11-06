// Éditeur de découpage d'une capture de page web en planches.
// La capture est affichée en une longue colonne : on ajoute, déplace ou retire les coupures,
// et on choisit où commence et finit le chapitre (le reste, c'est le site).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { Dialog } from './ui/Dialog.jsx';
import { loadStrip, renderPages } from '../lib/strip.js';

const SNAP_PX = 14; // distance (à l'écran) à laquelle une coupure est attirée vers une marge
const MIN_GAP = 24; // écart minimal entre deux coupures, en pixels de la capture

export function StripEditor({ row, onClose, onDone }) {
    const [busy, setBusy] = useState(false);
    return (
        <Dialog open={!!row} onClose={busy ? () => {} : onClose} title="Découper en planches" description={row?.label} size="lg" className="strip-dialog">
            {row && <Editor key={row.id} row={row} onClose={onClose} onDone={onDone} setBusy={setBusy} />}
        </Dialog>
    );
}

function Editor({ row, onClose, onDone, setBusy }) {
    const [strip, setStrip] = useState(null);
    const [error, setError] = useState('');
    const [step, setStep] = useState('Lecture de la capture…');
    const [rendering, setRendering] = useState(false);
    const [start, setStart] = useState(0);
    const [end, setEnd] = useState(0);
    const [cuts, setCuts] = useState([]);
    const [hover, setHover] = useState(null);
    const [displayWidth, setDisplayWidth] = useState(440);
    const viewportRef = useRef(null);
    const areaRef = useRef(null);
    const dragRef = useRef(null);

    // Chargement et proposition automatique.
    useEffect(() => {
        let alive = true;
        loadStrip(row, (s) => alive && setStep(s))
            .then((s) => {
                if (!alive) return;
                setStrip(s);
                const saved = row.split;
                setStart(saved?.start ?? s.start);
                setEnd(saved?.end ?? s.end);
                setCuts(saved?.cuts ?? s.cuts);
            })
            .catch((err) => alive && setError(err.message || 'Capture illisible'));
        return () => {
            alive = false;
        };
    }, [row]);

    // Images affichées (une par morceau de la capture).
    const urls = useMemo(() => strip?.slices.map((s) => URL.createObjectURL(s.blob)) || [], [strip]);
    useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

    // Largeur d'affichage : la place disponible, sans dépasser 520 px.
    useEffect(() => {
        const el = viewportRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setDisplayWidth(Math.min(520, Math.max(220, el.clientWidth - 48))));
        ro.observe(el);
        return () => ro.disconnect();
    }, [strip]);

    const colWidth = strip ? strip.x1 - strip.x0 : 1;
    const k = displayWidth / colWidth; // pixels écran par pixel de capture
    const sorted = useMemo(() => [...cuts].filter((c) => c > start && c < end).sort((a, b) => a - b), [cuts, start, end]);
    const bounds = [start, ...sorted, end];
    const pageCount = bounds.length - 1;

    const yFromEvent = useCallback(
        (e) => {
            const rect = areaRef.current.getBoundingClientRect();
            return Math.round((e.clientY - rect.top) / k);
        },
        [k],
    );

    const snap = useCallback(
        (y) => {
            let best = y;
            let dist = SNAP_PX / k;
            for (const s of strip?.snaps || []) {
                if (Math.abs(s - y) < dist) {
                    dist = Math.abs(s - y);
                    best = s;
                }
            }
            return best;
        },
        [strip, k],
    );

    const clampCut = (y) => Math.min(end - MIN_GAP, Math.max(start + MIN_GAP, y));

    const addCut = (y) => {
        const v = clampCut(snap(y));
        if (sorted.some((c) => Math.abs(c - v) < MIN_GAP)) return;
        setCuts((list) => [...list, v]);
    };

    // Glisser une coupure, le début ou la fin.
    const beginDrag = (e, kind, index) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        dragRef.current = { kind, index, moved: false };
    };
    const onPointerMove = (e) => {
        if (!strip) return;
        const y = yFromEvent(e);
        const drag = dragRef.current;
        if (!drag) {
            setHover(y > start && y < end ? snap(y) : null);
            return;
        }
        drag.moved = true;
        if (drag.kind === 'cut') {
            const v = clampCut(snap(y));
            setCuts((list) => list.map((c, i) => (i === drag.index ? v : c)));
        } else if (drag.kind === 'start') {
            setStart(Math.max(0, Math.min(snap(y), (sorted[0] ?? end) - MIN_GAP)));
        } else if (drag.kind === 'end') {
            setEnd(Math.min(strip.height, Math.max(snap(y), (sorted[sorted.length - 1] ?? start) + MIN_GAP)));
        }
    };
    const endDrag = () => {
        dragRef.current = null;
    };

    const nudge = (e, kind, index) => {
        const step = (e.shiftKey ? 20 : 2) / k;
        const dir = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
        if (kind === 'cut' && (e.key === 'Delete' || e.key === 'Backspace')) {
            e.preventDefault();
            setCuts((list) => list.filter((_, i) => i !== index));
            return;
        }
        if (!dir) return;
        e.preventDefault();
        const d = Math.round(dir * step);
        if (kind === 'cut') setCuts((list) => list.map((c, i) => (i === index ? clampCut(c + d) : c)));
        if (kind === 'start') setStart((v) => Math.max(0, Math.min(v + d, (sorted[0] ?? end) - MIN_GAP)));
        if (kind === 'end') setEnd((v) => Math.min(strip.height, Math.max(v + d, (sorted[sorted.length - 1] ?? start) + MIN_GAP)));
    };

    const reset = () => {
        setStart(strip.start);
        setEnd(strip.end);
        setCuts(strip.cuts);
    };

    const finish = async () => {
        setRendering(true);
        setBusy(true);
        try {
            const pages = await renderPages(strip, { start, end, cuts: sorted }, (s) => setStep(s));
            onDone({ pages, split: { start, end, cuts: sorted } });
        } catch (err) {
            setError(err.message || 'Découpage impossible');
        } finally {
            setRendering(false);
            setBusy(false);
        }
    };

    if (error) {
        return (
            <div className="strip__state">
                <p className="form__error">{error}</p>
                <div className="form__actions">
                    <button className="btn btn--secondary" onClick={onClose}>
                        Fermer
                    </button>
                </div>
            </div>
        );
    }
    if (!strip) {
        return (
            <div className="strip__state">
                <p className="muted">{step}</p>
            </div>
        );
    }

    return (
        <div className="strip">
            <aside className="strip__side">
                <p className="strip__count">
                    <strong>{pageCount}</strong> {pageCount > 1 ? 'planches' : 'planche'}
                </p>
                <ul className="strip__help">
                    <li>Clique entre deux planches pour ajouter une coupure.</li>
                    <li>Fais glisser une ligne pour l’ajuster, ou retire-la avec la croix.</li>
                    <li>Les zones grisées en haut et en bas sont le site : elles ne sont pas importées. Déplace « Début » et « Fin » si une planche est coupée.</li>
                </ul>
                <button type="button" className="btn btn--ghost btn--sm" onClick={reset} disabled={rendering}>
                    <RotateCcw size={15} aria-hidden="true" />
                    Revenir à la proposition
                </button>
                <div className="strip__actions">
                    <button type="button" className="btn btn--secondary" onClick={onClose} disabled={rendering}>
                        Annuler
                    </button>
                    <button type="button" className="btn btn--primary" onClick={finish} disabled={rendering}>
                        {rendering ? step : `Découper en ${pageCount} ${pageCount > 1 ? 'planches' : 'planche'}`}
                    </button>
                </div>
            </aside>

            <div className="strip__viewport" ref={viewportRef}>
                <div
                    ref={areaRef}
                    className={`strip__area ${rendering ? 'is-busy' : ''}`}
                    style={{ width: displayWidth, height: strip.height * k }}
                    onPointerMove={onPointerMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onPointerLeave={() => !dragRef.current && setHover(null)}
                    onClick={(e) => {
                        if (rendering) return;
                        const y = yFromEvent(e);
                        if (y > start && y < end) addCut(y);
                    }}
                >
                    {strip.slices.map((s, i) => (
                        <div key={i} className="strip__slice" style={{ top: s.top * k, height: s.h * k }}>
                            <img src={urls[i]} alt="" draggable="false" style={{ width: strip.width * k, height: s.h * k, marginLeft: -strip.x0 * k }} />
                        </div>
                    ))}

                    <div className="strip__shade" style={{ top: 0, height: start * k }} />
                    <div className="strip__shade" style={{ top: end * k, bottom: 0 }} />

                    {bounds.slice(0, -1).map((y, i) => (
                        <span key={`n${i}`} className="strip__num" style={{ top: y * k + 6 }}>
                            {i + 1}
                        </span>
                    ))}

                    {hover !== null && !dragRef.current && <div className="strip__hover" style={{ top: hover * k }} aria-hidden="true" />}

                    {cuts.map((c, i) =>
                        c > start && c < end ? (
                            <div key={i} className="strip__cut" style={{ top: c * k }}>
                                <button
                                    type="button"
                                    className="strip__grip"
                                    aria-label={`Coupure ${sorted.indexOf(c) + 1}. Flèches pour la déplacer, Suppr pour la retirer.`}
                                    onPointerDown={(e) => beginDrag(e, 'cut', i)}
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => nudge(e, 'cut', i)}
                                />
                                <button
                                    type="button"
                                    className="strip__remove"
                                    aria-label={`Retirer la coupure ${sorted.indexOf(c) + 1}`}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setCuts((list) => list.filter((_, j) => j !== i));
                                    }}
                                >
                                    <X size={13} />
                                </button>
                            </div>
                        ) : null,
                    )}

                    {[
                        ['start', start, 'Début'],
                        ['end', end, 'Fin'],
                    ].map(([kind, y, label]) => (
                        <div key={kind} className={`strip__limit strip__limit--${kind}`} style={{ top: y * k }}>
                            <button
                                type="button"
                                className="strip__limit-grip"
                                aria-label={`${label} du chapitre. Flèches pour le déplacer.`}
                                onPointerDown={(e) => beginDrag(e, kind)}
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => nudge(e, kind)}
                            >
                                {label}
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
