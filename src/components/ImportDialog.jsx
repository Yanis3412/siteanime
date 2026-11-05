// Fenêtre d'import de chapitres : sélection des fichiers, vérification des numéros, envoi.
import { useRef, useState } from 'react';
import { FolderOpen, Upload } from 'lucide-react';
import { Dialog } from './ui/Dialog.jsx';
import { extractPages, filesFromDrop, filesFromInput, formatBytes, formatNum, groupIntoChapters, uploadChapter } from '../lib/importer.js';

export function ImportDialog({ open, onClose, item, profileId, token, existing, onImported }) {
    // Pendant l'envoi, la fenêtre ne se ferme pas par erreur (Échap, clic à côté).
    const [busy, setBusy] = useState(false);
    return (
        <Dialog open={open} onClose={busy ? () => {} : onClose} title="Importer des chapitres" description={item.title} size="md">
            <ImportForm onClose={onClose} setBusy={setBusy} item={item} profileId={profileId} token={token} existing={existing} onImported={onImported} />
        </Dialog>
    );
}

function ImportForm({ onClose, setBusy, item, profileId, token, existing, onImported }) {
    const [rows, setRows] = useState([]);
    const [unsupported, setUnsupported] = useState([]);
    const [phase, setPhase] = useState('pick'); // pick | review | uploading | done
    const [dragging, setDragging] = useState(false);
    const fileInput = useRef(null);
    const folderInput = useRef(null);

    const addEntries = (entries) => {
        const { chapters, unsupported: bad } = groupIntoChapters(entries);
        setRows((r) =>
            [...r, ...chapters.map((c) => ({ ...c, numText: c.num === null ? '' : formatNum(c.num), state: 'ready', step: '' }))].sort(
                (a, b) => (a.num ?? Infinity) - (b.num ?? Infinity),
            ),
        );
        setUnsupported((u) => [...u, ...bad]);
        if (chapters.length) setPhase('review');
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
                                            ? [row.kind === 'pdf' ? 'PDF' : row.kind === 'archive' ? 'Archive' : `${row.pages} images`, formatBytes(row.size)].join(', ')
                                            : row.step}
                                    </span>
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
        </div>
    );
}
