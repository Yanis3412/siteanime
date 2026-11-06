// « Sauvegardes » (administrateur) : sauvegardes des listes de tous les profils, faites chaque lundi
// ou à la demande ; téléchargement et restauration profil par profil.
import { useEffect, useState } from 'react';
import { ChevronLeft, Download, RotateCcw } from 'lucide-react';
import { useApp } from '../state/app.jsx';
import { useUi } from '../state/ui.jsx';
import { Dialog } from './ui/Dialog.jsx';
import { api } from '../lib/api.js';
import { formatBytes } from '../lib/importer.js';

const REASON = { auto: 'Automatique', manual: 'Manuelle', before: 'Avant une restauration' };
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const when = (ms) =>
    new Date(ms).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function BackupsDialog({ open, onClose }) {
    const [selected, setSelected] = useState(null);
    const close = () => {
        setSelected(null);
        onClose();
    };
    return (
        <Dialog
            open={open}
            onClose={close}
            title={selected ? 'Restaurer une sauvegarde' : 'Sauvegardes'}
            description={selected ? when(selected.createdAt) : 'Les listes de tous les profils sont sauvegardées chaque lundi matin, à part de la base de données. Les 10 dernières sauvegardes sont gardées.'}
            size="md"
        >
            {selected ? <Restore backup={selected} onBack={() => setSelected(null)} onDone={close} /> : <BackupList onRestore={setSelected} />}
        </Dialog>
    );
}

function BackupList({ onRestore }) {
    const { session } = useApp();
    const { toast } = useUi();
    const [backups, setBackups] = useState(null);
    const [error, setError] = useState('');
    const [creating, setCreating] = useState(false);

    const load = () =>
        api.backups
            .list(session.token)
            .then((d) => setBackups(d.backups))
            .catch((err) => setError(err.message));
    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const create = async () => {
        setCreating(true);
        try {
            await api.backups.create(session.token);
            toast('Sauvegarde faite.', { tone: 'success' });
            await load();
        } catch (err) {
            toast(err.message, { tone: 'error' });
        } finally {
            setCreating(false);
        }
    };

    const download = async (b) => {
        try {
            const { url } = await api.backups.download(b.key, session.token);
            const res = await fetch(url);
            if (!res.ok) throw new Error('Téléchargement impossible');
            const href = URL.createObjectURL(await res.blob());
            const a = document.createElement('a');
            a.href = href;
            a.download = b.key.split('/').pop();
            a.rel = 'noopener';
            document.body.append(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(href), 10000);
        } catch (err) {
            toast(err.message, { tone: 'error' });
        }
    };

    if (error) return <p className="form__error">{error}</p>;
    return (
        <div className="backups">
            <button className="btn btn--secondary backups__create" onClick={create} disabled={creating || !backups}>
                {creating ? 'Sauvegarde…' : 'Sauvegarder maintenant'}
            </button>
            {!backups ? (
                <p className="muted">Chargement…</p>
            ) : !backups.length ? (
                <p className="manage-section__text">Aucune sauvegarde pour l’instant. La première sera faite lundi matin, ou tout de suite avec le bouton ci-dessus.</p>
            ) : (
                <ul className="backups__list">
                    {backups.map((b) => (
                        <li key={b.key} className="backups__row">
                            <span className="backups__main">
                                <span className="backups__date">{when(b.createdAt)}</span>
                                <span className="backups__meta">
                                    {REASON[b.reason]}, {plural(b.profiles, 'profil', 'profils')}, {plural(b.items, 'titre', 'titres')}, {formatBytes(b.size)}
                                </span>
                            </span>
                            <button className="btn btn--ghost btn--icon btn--sm" onClick={() => download(b)} aria-label="Télécharger" title="Télécharger">
                                <Download size={16} />
                            </button>
                            <button className="btn btn--ghost btn--sm" onClick={() => onRestore(b)}>
                                <RotateCcw size={15} aria-hidden="true" />
                                Restaurer
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function Restore({ backup, onBack, onDone }) {
    const { session } = useApp();
    const { toast, confirm } = useUi();
    const [detail, setDetail] = useState(null);
    const [chosen, setChosen] = useState(new Set());
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        api.backups
            .show(backup.key, session.token)
            .then((d) => {
                setDetail(d);
                setChosen(new Set());
            })
            .catch((err) => setError(err.message));
    }, [backup.key, session.token]);

    const toggle = (id) =>
        setChosen((set) => {
            const next = new Set(set);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const restore = async () => {
        const names = detail.profiles.filter((p) => chosen.has(p.id)).map((p) => p.currentName || p.name);
        const ok = await confirm({
            title: `Restaurer ${plural(names.length, 'liste', 'listes')} ?`,
            message: `${names.join(', ')} : la liste reviendra exactement à son état du ${when(backup.createdAt)}. Les changements faits depuis seront remplacés. L’état actuel est sauvegardé juste avant, pour pouvoir revenir en arrière.`,
            confirmLabel: 'Restaurer',
            danger: true,
        });
        if (!ok) return;
        setBusy(true);
        try {
            const res = await api.backups.restore(backup.key, [...chosen], session.token);
            toast(`${plural(res.restored, 'liste restaurée', 'listes restaurées')}. L’état d’avant est gardé dans les sauvegardes.`, { tone: 'success', duration: 6000 });
            // Sa propre liste a changé : on recharge pour l'afficher.
            if (chosen.has(session.profileId)) window.location.reload();
            else onDone();
        } catch (err) {
            toast(err.message, { tone: 'error' });
            setBusy(false);
        }
    };

    return (
        <div className="backups">
            <button type="button" className="btn btn--ghost btn--sm manage-back" onClick={onBack}>
                <ChevronLeft size={16} aria-hidden="true" />
                Toutes les sauvegardes
            </button>
            {error && <p className="form__error">{error}</p>}
            {!detail && !error && <p className="muted">Chargement…</p>}
            {detail && (
                <>
                    <p className="manage-section__text">Choisis les listes à remettre dans l’état de cette sauvegarde. Les chapitres importés, les codes et les photos ne changent pas.</p>
                    <ul className="backups__choices">
                        {detail.profiles.map((p) => (
                            <li key={p.id}>
                                <label className={`backups__choice ${p.exists ? '' : 'is-disabled'}`}>
                                    <input type="checkbox" checked={chosen.has(p.id)} disabled={!p.exists || busy} onChange={() => toggle(p.id)} />
                                    <span className="backups__main">
                                        <span className="backups__date">{p.currentName || p.name}</span>
                                        <span className="backups__meta">
                                            {p.exists
                                                ? `${plural(p.items, 'titre', 'titres')} dans la sauvegarde, ${plural(p.currentItems, 'titre', 'titres')} aujourd’hui`
                                                : 'Profil supprimé depuis : impossible de le restaurer ici'}
                                        </span>
                                    </span>
                                </label>
                            </li>
                        ))}
                    </ul>
                    <div className="form__actions">
                        <button className="btn btn--secondary" onClick={onBack} disabled={busy}>
                            Annuler
                        </button>
                        <button className="btn btn--danger" onClick={restore} disabled={!chosen.size || busy}>
                            {busy ? 'Restauration…' : chosen.size ? `Restaurer ${plural(chosen.size, 'liste', 'listes')}` : 'Restaurer'}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
