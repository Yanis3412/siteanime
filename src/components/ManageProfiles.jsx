// « Gérer les profils » : réservé à l'administrateur. Pour chaque profil : photo, nom, nouveau code, suppression.
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ShieldCheck } from 'lucide-react';
import { useApp } from '../state/app.jsx';
import { useUi } from '../state/ui.jsx';
import { Dialog } from './ui/Dialog.jsx';
import { Avatar } from './ui/Avatar.jsx';
import { PinField } from './PinField.jsx';
import { PhotoField } from './PhotoField.jsx';
import { api, avatarUrl } from '../lib/api.js';
import { formatBytes } from '../lib/importer.js';

export function ManageProfilesDialog({ open, onClose }) {
    const { profiles, hasAdminAccess, session } = useApp();
    const [selectedId, setSelectedId] = useState(null);
    const [storage, setStorage] = useState(null); // espace utilisé, par profil
    const selected = profiles?.find((p) => p.id === selectedId) || null;

    // Recalculé à chaque ouverture et après une suppression.
    const loadStorage = () =>
        api.adminStorage(session.token)
            .then(setStorage)
            .catch(() => setStorage(null));
    useEffect(() => {
        if (open && hasAdminAccess) loadStorage();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, hasAdminAccess]);
    const usageOf = (id) => storage?.profiles.find((p) => p.id === id) || null;

    const close = () => {
        setSelectedId(null);
        onClose();
    };

    return (
        <Dialog
            open={open}
            onClose={close}
            title={selected ? selected.name : 'Gérer les profils'}
            description={selected ? null : 'Choisis un profil pour changer sa photo, son nom ou son code, ou pour le supprimer.'}
            size="md"
            className="manage"
        >
            <AdminGate>
                {selected ? (
                    <ProfileEditor
                        key={selected.id}
                        profile={selected}
                        usage={usageOf(selected.id)}
                        limitBytes={storage?.limitBytes}
                        onBack={() => setSelectedId(null)}
                        onDeleted={() => {
                            setSelectedId(null);
                            loadStorage();
                        }}
                    />
                ) : (
                    <>
                        {storage && <StorageSummary storage={storage} />}
                        <ProfileList profiles={profiles || []} usageOf={usageOf} onPick={setSelectedId} />
                    </>
                )}
            </AdminGate>
        </Dialog>
    );
}

// Réservé au profil administrateur ouvert avec son code.
function AdminGate({ children }) {
    const { hasAdminAccess } = useApp();
    if (!hasAdminAccess) return <p className="dialog__text">Ouvre le profil administrateur avec son code pour gérer les profils.</p>;
    return children;
}

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

function shareOf(bytes, limit) {
    const pct = (bytes / limit) * 100;
    const text = pct < 1 ? 'moins de 1 %' : `${Math.round(pct)} %`;
    return `Soit ${text} des ${formatBytes(limit)} partagés entre tous les profils.`;
}

function StorageSummary({ storage }) {
    const chapters = storage.profiles.reduce((n, p) => n + p.chapters, 0);
    return (
        <div className="storage manage-storage">
            <div className="storage__text">
                <span>
                    Stockage : {formatBytes(storage.totalBytes)} utilisés sur {formatBytes(storage.limitBytes)}
                </span>
                <span className="muted">{plural(chapters, 'chapitre', 'chapitres')}</span>
            </div>
            <div className="meter meter--thin" style={{ '--p': `${Math.min(100, (storage.totalBytes / storage.limitBytes) * 100)}%` }} />
        </div>
    );
}

function ProfileList({ profiles, usageOf, onPick }) {
    return (
        <ul className="manage-list">
            {profiles.map((p) => (
                <li key={p.id}>
                    <button type="button" className="manage-row" onClick={() => onPick(p.id)}>
                        <Avatar name={p.name} src={avatarUrl(p)} />
                        <span className="manage-row__main">
                            <span className="manage-row__name">
                                {p.name}
                                {p.isAdmin && <ShieldCheck size={14} aria-label="Administrateur" className="profile-tile__admin" />}
                            </span>
                            <span className="manage-row__meta">
                                {plural(p.itemCount, 'titre', 'titres')}
                                {usageOf(p.id) && `, ${plural(usageOf(p.id).chapters, 'chapitre', 'chapitres')}`}
                            </span>
                        </span>
                        <span className="manage-row__size">{usageOf(p.id)?.bytes ? formatBytes(usageOf(p.id).bytes) : ''}
                        </span>
                        <ChevronRight size={16} aria-hidden="true" />
                    </button>
                </li>
            ))}
        </ul>
    );
}

function ProfileEditor({ profile, usage, limitBytes, onBack, onDeleted }) {
    const { renameProfile, changePin, deleteProfile } = useApp();
    const { toast, confirm } = useUi();

    const [name, setName] = useState(profile.name);
    const [nameError, setNameError] = useState('');
    const [pin, setPin] = useState('');
    const [pin2, setPin2] = useState('');
    const [pinError, setPinError] = useState('');
    const [busy, setBusy] = useState(null); // 'name' | 'pin' | 'delete'

    const rename = async (e) => {
        e.preventDefault();
        setBusy('name');
        setNameError('');
        try {
            await renameProfile(profile.id, name, { asAdmin: true });
            toast('Profil renommé.', { tone: 'success' });
        } catch (err) {
            setNameError(err.message);
        } finally {
            setBusy(null);
        }
    };

    const resetPin = async (e) => {
        e.preventDefault();
        if (!/^\d{4,6}$/.test(pin)) return setPinError('Le code doit faire entre 4 et 6 chiffres.');
        if (pin !== pin2) return setPinError('Les deux codes ne correspondent pas.');
        setBusy('pin');
        setPinError('');
        try {
            await changePin(profile.id, pin, { asAdmin: true });
            setPin('');
            setPin2('');
            toast(`Nouveau code enregistré pour ${profile.name}.`, { tone: 'success' });
        } catch (err) {
            setPinError(err.message);
        } finally {
            setBusy(null);
        }
    };

    const remove = async () => {
        const ok = await confirm({
            title: `Supprimer le profil ${profile.name} ?`,
            message: `Sa liste (${profile.itemCount} titres), ses chapitres importés${usage?.bytes ? ` (${formatBytes(usage.bytes)})` : ''} et sa photo seront effacés définitivement.`,
            confirmLabel: 'Supprimer le profil',
            danger: true,
        });
        if (!ok) return;
        setBusy('delete');
        try {
            await deleteProfile(profile.id, { asAdmin: true });
            toast(`Profil ${profile.name} supprimé.`, { tone: 'success' });
            onDeleted();
        } catch (err) {
            toast(err.message, { tone: 'error' });
            setBusy(null);
        }
    };

    const renamed = name.trim() && name.trim() !== profile.name;

    return (
        <div className="manage-editor">
            <button type="button" className="btn btn--ghost btn--sm manage-back" onClick={onBack}>
                <ChevronLeft size={16} aria-hidden="true" />
                Tous les profils
            </button>

            <section className="manage-section" aria-label="Photo">
                <PhotoField profile={profile} asAdmin />
            </section>

            <section className="manage-section">
                <h3 className="manage-section__title">Stockage</h3>
                {!usage ? (
                    <p className="manage-section__text">Calcul en cours…</p>
                ) : usage.chapters === 0 ? (
                    <p className="manage-section__text">Aucun chapitre importé.</p>
                ) : (
                    <>
                        <p className="manage-section__text manage-usage">
                            <strong>{formatBytes(usage.bytes)}</strong> pour {plural(usage.chapters, 'chapitre', 'chapitres')} sur {plural(usage.titles, 'titre', 'titres')}
                            {usage.colored > 0 && `, dont ${usage.colored} en couleur`}.
                            {usage.colorBytes > 0 && (
                                <>
                                    <br />
                                    Pages originales : {formatBytes(usage.originalBytes)}. Versions couleur : {formatBytes(usage.colorBytes)}.
                                </>
                            )}
                        </p>
                        {limitBytes && <p className="manage-section__text">{shareOf(usage.bytes, limitBytes)}</p>}
                    </>
                )}
            </section>

            <section className="manage-section">
                <h3 className="manage-section__title">Nom</h3>
                <form className="manage-inline" onSubmit={rename}>
                    <label className="field">
                        <span className="sr-only">Nom du profil</span>
                        <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} required />
                    </label>
                    <button className="btn btn--secondary" disabled={!renamed || busy === 'name'}>
                        Renommer
                    </button>
                </form>
                {nameError && <p className="form__error">{nameError}</p>}
            </section>

            <section className="manage-section">
                <h3 className="manage-section__title">Code</h3>
                <p className="manage-section__text">
                    {profile.isAdmin
                        ? 'Ton code administrateur. Tes autres appareils devront saisir le nouveau.'
                        : `Si ${profile.name} a oublié son code, choisis-en un nouveau et donne-le-lui. Ses appareils devront le saisir à nouveau.`}
                </p>
                <form className="form manage-pin" onSubmit={resetPin}>
                    <div className="manage-pin__fields">
                        <PinField label="Nouveau code" value={pin} onChange={setPin} invalid={!!pinError} />
                        <PinField label="Confirme le code" value={pin2} onChange={setPin2} invalid={!!pinError} />
                    </div>
                    {pinError && <p className="form__error">{pinError}</p>}
                    <div className="form__actions">
                        <button className="btn btn--secondary" disabled={!pin || busy === 'pin'}>
                            Changer le code
                        </button>
                    </div>
                </form>
            </section>

            {!profile.isAdmin && (
                <section className="manage-section manage-section--danger">
                    <h3 className="manage-section__title">Supprimer le profil</h3>
                    <p className="manage-section__text">Efface sa liste, ses chapitres importés et sa photo. Impossible à annuler.</p>
                    <div>
                        <button type="button" className="btn btn--danger" onClick={remove} disabled={busy === 'delete'}>
                            Supprimer {profile.name}
                        </button>
                    </div>
                </section>
            )}
        </div>
    );
}
