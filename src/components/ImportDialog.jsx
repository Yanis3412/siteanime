// Fenêtre d'import de chapitres : sélection des fichiers, vérification des numéros, envoi.
import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Scissors, Upload } from 'lucide-react';
import { Dialog } from './ui/Dialog.jsx';
import { StripEditor } from './StripEditor.jsx';
import { extractPages, filesFromDrop, filesFromInput, formatBytes, formatNum, groupIntoChapters, uploadChapter } from '../lib/importer.js';
import { hasTallImages, isCapturePdf } from '../lib/strip.js';

// initialEntries : fichiers déposés directement sur la page du manga (import rapide).
export function ImportDialog({ open, onClose, item, profileId, token, existing, onImported, initialEntries = null }) {
    // Pendant l'envoi, la fenêtre ne se ferme pas par erreur (Échap, clic à côté).
    const [busy, setBusy] = useState(false);
    return (
        <Dialog open={open} onClose={busy ? () => {} : onClose} title="Importer des chapitres" description={item.title} size="md">
            <ImportForm
                onClose={onClose}
                setBusy={setBusy}
                item={item}
                profileId={profileId}
                token={token}
                existing={existing}
                onImported={onImported}
                initialEntries={initialEntries}
            />
        </Dialog>
    );
}

function ImportForm({ onClose, setBusy, item, profileId, token, existing, onImported, initialEntries }) {
    const [rows, setRows] = useState([]);
    const [unsupported, setUnsupported] = useState([]);
    const [phase, setPhase] = useState('pick'); // pick | review | uploading | done
    const [dragging, setDragging] = useState(false);
    const [splitting, setSplitting] = useState(null); // ligne en cours de découpage
    const [quick, setQuick] = useState(false); // une capture déposée sur la page : découpage puis import direct
    const fileInput = useRef(null);
    const folderInput = useRef(null);
    const autoRunRef = useRef(false);

    // Fichiers déposés sur la page : s'il n'y a qu'une capture, on ouvre tout de suite le découpage.
    const initialDoneRef = useRef(false);
    useEffect(() => {
        if (!initialEntries?.length || initialDoneRef.current) return;
        initialDoneRef.current = true;
        const chapters = addEntries(initialEntries);
        if (chapters.length === 1 && (chapters[0].kind === 'pdf' || chapters[0].kind === 'images')) {
            const row = chapters[0];
            const check = row.kind === 'pdf' ? isCapturePdf(row.files[0]) : hasTallImages(row.files);
            check.then((capture) => {
                if (!capture) return;
                setQuick(true);
                setSplitting({ ...row, numText: row.num === null ? '' : formatNum(row.num) });
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialEntries]);

    const addEntries = (entries) => {
        const { chapters, unsupported: bad } = groupIntoChapters(entries);
        setRows((r) =>
            [...r, ...chapters.map((c) => ({ ...c, numText: c.num === null ? '' : formatNum(c.num), state: 'ready', step: '' }))].sort(
                (a, b) => (a.num ?? Infinity) - (b.num ?? Infinity),
            ),
        );
        setUnsupported((u) => [...u, ...bad]);
        if (chapters.length) setPhase('review');
        // Capture de page web (GoFullPage…) : les planches sont coupées n'importe où, on proposera de les redécouper.
        for (const c of chapters) {
            const check = c.kind === 'pdf' ? isCapturePdf(c.files[0]) : c.kind === 'images' ? hasTallImages(c.files) : Promise.resolve(false);
            check.then((capture) => capture && update(c.id, { capture: true }));
        }
        return chapters;
    };

    const update = (id, changes) => setRows((r) => r.map((row) => (row.id === id ? { ...row, ...changes } : row)));
    const remove = (id) => setRows((r) => r.filter((row) => row.id !== id));

    const parsed = rows.map((r) => ({ ...r, value: r.numText.trim() === '' ? null : Number(r.numText.replace(',', '.')) }));
    const invalid = parsed.filter((r) => r.value === null || !Number.isFinite(r.value) || r.value < 0);
    const duplicates = new Set(parsed.map((r) => r.value).filter((v, i, all) => v !== null && all.indexOf(v) !== i));
    const canImport = rows.length > 0 && invalid.length === 0 && duplicates.size === 0;

    const run = async () => {
        setPhase('uploading');
        setBusy(true);
        for (const row of parsed) {
            if (row.state === 'done') continue;
            update(row.id, { state: 'working', step: 'Lecture du fichier…', progress: 0 });
            try {
                const pages = await extractPages(row, (step) => update(row.id, { step }));
                update(row.id, { step: `Envoi de ${pages.length} pages…` });
                const res = await uploadChapter({
                    profileId,
                    itemId: item.id,
                    num: row.value,
                    pages,
                    token,
                    onProgress: (done, total) => update(row.id, { progress: done / total, step: `Envoi : ${done} sur ${total} pages` }),
                });
                update(row.id, { state: 'done', step: `${res.chapter.pages} pages, ${formatBytes(res.chapter.bytes)}`, progress: 1 });
                onImported(res.chapter);
            } catch (err) {
                update(row.id, { state: 'error', step: err.message || 'Échec de l’import' });
            }
        }
        setBusy(false);
        setPhase('done');
    };

    // Import rapide : une fois la capture découpée et le numéro vérifié, on lance l'envoi.
    useEffect(() => {
        if (!autoRunRef.current || !canImport || phase !== 'review') return;
        autoRunRef.current = false;
        run();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, canImport, phase]);

    const failed = rows.filter((r) => r.state === 'error').length;
    const imported = rows.filter((r) => r.state === 'done').length;

    return (
        <div className="import">
            {(phase === 'pick' || phase === 'review') && (
                <div
                    className={`dropzone ${dragging ? 'is-over' : ''} ${phase === 'review' ? 'dropzone--compact' : ''}`}
                    onDragOver={(e) => {
                        e.preventDefault();
                        setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={async (e) => {
                        e.preventDefault();
                        setDragging(false);
                        addEntries(await filesFromDrop(e.dataTransfer));
                    }}
                >
                    <Upload size={22} aria-hidden="true" />
                    <p className="dropzone__text">
                        {phase === 'pick' ? 'Glisse ici des fichiers CBZ, ZIP ou PDF, ou des dossiers d’images.' : 'Ajoute d’autres chapitres ici.'}
                    </p>
                    <div className="dropzone__actions">
                        <button type="button" className="btn btn--secondary" onClick={() => fileInput.current?.click()}>
                            Choisir des fichiers
                        </button>
                        <button type="button" className="btn btn--ghost" onClick={() => folderInput.current?.click()}>
                            <FolderOpen size={16} aria-hidden="true" />
                            Choisir un dossier
                        </button>
                    </div>
                    <input
                        ref={fileInput}
                        type="file"
                        multiple
                        hidden
                        accept=".cbz,.zip,.pdf,image/*"
                        onChange={(e) => {
                            addEntries(filesFromInput(e.target.files));
                            e.target.value = '';
                        }}
                    />
                    <input
                        ref={folderInput}
                        type="file"
                        hidden
                        webkitdirectory=""
                        onChange={(e) => {
                            addEntries(filesFromInput(e.target.files));
                            e.target.value = '';
                        }}
                    />
                </div>
            )}

            {unsupported.length > 0 && (
                <p className="import__warn">
                    Ignorés : {unsupported.join(', ')}. Les archives CBR et RAR ne sont pas prises en charge, convertis-les en CBZ.
                </p>
            )}

            {rows.length > 0 && (
                <ul className="import__list">
                    {parsed.map((row) => {
                        const replaces = row.value !== null && existing.has(row.value);
                        const dup = duplicates.has(row.value);
                        return (
                            <li key={row.id} className={`import__row is-${row.state}`}>
                                <div className="import__info">
                                    <span className="import__name">{row.label}</span>
                                    <span className="import__meta">
                                        {row.state === 'ready'
                                            ? row.splitPages
                                                ? `Découpé en ${row.splitPages.length} planches`
                                                : [row.kind === 'pdf' ? 'PDF' : row.kind === 'archive' ? 'Archive' : `${row.pages} images`, formatBytes(row.size)].join(', ')
                                            : row.step}
                                    </span>
                                    {row.state === 'ready' && row.capture && !row.splitPages && (
                                        <span className="import__note">Capture d’une page web : les planches sont coupées au mauvais endroit.</span>
                                    )}
                                    {row.state === 'ready' && (row.capture || row.splitPages) && (
                                        <button type="button" className="btn btn--secondary btn--sm import__split" onClick={() => setSplitting(row)}>
                                            <Scissors size={15} aria-hidden="true" />
                                            {row.splitPages ? 'Modifier le découpage' : 'Découper par planche'}
                                        </button>
                                    )}
                                    {row.state === 'ready' && (replaces || dup) && (
                                        <span className={dup ? 'import__error' : 'import__note'}>{dup ? 'Ce numéro est utilisé deux fois.' : 'Remplacera le chapitre déjà importé.'}</span>
                                    )}
                                    {row.state === 'working' && <span className="meter meter--thin" style={{ '--p': `${(row.progress || 0) * 100}%` }} />}
                                </div>
                                {row.state === 'ready' ? (
                                    <>
                                        <label className="import__num">
                                            <span>Chapitre</span>
                                            <input
                                                className={`input ${row.value === null || dup ? 'is-invalid' : ''}`}
                                                inputMode="decimal"
                                                value={row.numText}
                                                placeholder="?"
                                                onChange={(e) => update(row.id, { numText: e.target.value })}
                                                aria-label={`Numéro de chapitre pour ${row.label}`}
                                            />
                                        </label>
                                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => remove(row.id)}>
                                            Retirer
                                        </button>
                                    </>
                                ) : (
                                    <span className={`import__state import__state--${row.state}`}>
                                        {row.state === 'done' ? 'Importé' : row.state === 'error' ? 'Échec' : 'En cours'}
                                    </span>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            <div className="form__actions">
                {phase === 'done' ? (
                    <>
                        <p className="import__summary">
                            {imported} chapitre{imported > 1 ? 's' : ''} importé{imported > 1 ? 's' : ''}
                            {failed ? `, ${failed} en échec` : ''}.
                        </p>
                        {failed > 0 && (
                            <button className="btn btn--secondary" onClick={run}>
                                Réessayer les échecs
                            </button>
                        )}
                        <button className="btn btn--primary" onClick={onClose}>
                            Fermer
                        </button>
                    </>
                ) : (
                    <>
                        <button type="button" className="btn btn--secondary" onClick={onClose} disabled={phase === 'uploading'}>
                            Annuler
                        </button>
                        <button className="btn btn--primary" onClick={run} disabled={!canImport || phase === 'uploading'}>
                            {phase === 'uploading' ? 'Import en cours…' : `Importer ${rows.length || ''} chapitre${rows.length > 1 ? 's' : ''}`}
                        </button>
                    </>
                )}
            </div>
            {phase === 'uploading' && <p className="import__hint">Garde cette page ouverte pendant l’import.</p>}

            <StripEditor
                row={splitting}
                chapter={
                    quick && splitting
                        ? {
                              value: rows.find((r) => r.id === splitting.id)?.numText ?? splitting.numText,
                              onChange: (numText) => update(splitting.id, { numText }),
                              existing,
                          }
                        : null
                }
                onClose={() => {
                    setSplitting(null);
                    setQuick(false);
                }}
                onDone={({ pages, split }) => {
                    update(splitting.id, { splitPages: pages, split, size: pages.reduce((n, p) => n + p.size, 0) });
                    if (quick) autoRunRef.current = true;
                    setSplitting(null);
                    setQuick(false);
                }}
            />
        </div>
    );
}
