// Écran d'accueil : choix du profil, déverrouillage par code, création d'un profil.
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Eye, Plus, ShieldCheck } from 'lucide-react';
import { useApp } from '../state/app.jsx';
import { Avatar } from '../components/ui/Avatar.jsx';
import { Dialog } from '../components/ui/Dialog.jsx';
import { PinField } from '../components/PinField.jsx';

export function ProfilesPage() {
    const { profiles, profilesError, refreshProfiles, resume } = useApp();
    const navigate = useNavigate();
    const location = useLocation();
    const [unlocking, setUnlocking] = useState(null);
    const [creating, setCreating] = useState(false);
    const [opening, setOpening] = useState(null);

    const goIn = () => navigate(location.state?.from || '/mangas', { replace: true });

    const pick = async (p) => {
        setOpening(p.id);
        // Déjà déverrouillé sur cet appareil : pas besoin du code.
        const ok = await resume(p.id);
        setOpening(null);
        if (ok) goIn();
        else setUnlocking(p);
    };

    return (
        <div className="profiles">
            <div className="profiles__inner">
                <span className="brand brand--lg">Liste</span>
                <h1 className="profiles__title">Choisis ton profil</h1>

                {profilesError && (
                    <div className="profiles__error">
                        <p>Impossible de charger les profils : {profilesError}</p>
                        <button className="btn btn--secondary" onClick={refreshProfiles}>
                            Réessayer
                        </button>
                    </div>
                )}

                {!profiles && !profilesError && <p className="muted">Chargement des profils…</p>}

                {profiles && (
                    <ul className="profiles__grid">
                        {profiles.map((p) => (
                            <li key={p.id}>
                                <button className="profile-tile" onClick={() => pick(p)} disabled={opening === p.id}>
                                    <Avatar name={p.name} size="lg" />
                                    <span className="profile-tile__name">
                                        {p.name}
                                        {p.isAdmin && <ShieldCheck size={15} aria-label="Administrateur" className="profile-tile__admin" />}
                                    </span>
                                    <span className="profile-tile__count">
                                        {p.itemCount} {p.itemCount > 1 ? 'titres' : 'titre'}
                                    </span>
                                </button>
                            </li>
                        ))}
                        <li>
                            <button className="profile-tile profile-tile--new" onClick={() => setCreating(true)}>
                                <span className="avatar avatar--lg avatar--new" aria-hidden="true">
                                    <Plus size={26} />
                                </span>
                                <span className="profile-tile__name">Nouveau profil</span>
                            </button>
                        </li>
                    </ul>
                )}
            </div>

            <UnlockDialog profile={unlocking} onClose={() => setUnlocking(null)} onDone={goIn} />
            <CreateDialog open={creating} onClose={() => setCreating(false)} onDone={goIn} />
        </div>
    );
}

function UnlockDialog({ profile, onClose, onDone }) {
    return (
        <Dialog open={!!profile} onClose={onClose} title={profile ? `Déverrouiller ${profile.name}` : ''} description="Entre le code du profil pour modifier sa liste." size="sm">
            {profile && <UnlockForm profile={profile} onClose={onClose} onDone={onDone} />}
        </Dialog>
    );
}

function UnlockForm({ profile, onClose, onDone }) {
    const { unlock, spectate } = useApp();
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        if (!pin) return setError('Entre le code.');
        setBusy(true);
        setError('');
        try {
            await unlock(profile.id, pin);
            onClose();
            onDone();
        } catch (err) {
            setError(err.message);
            setPin('');
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="form" onSubmit={submit}>
            <PinField label="Code" value={pin} onChange={setPin} autoFocus invalid={!!error} />
            {error && (
                <p className="form__error" role="alert">
                    {error}
                </p>
            )}
            <div className="form__actions form__actions--split">
                <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={async () => {
                        await spectate(profile.id);
                        onClose();
                        onDone();
                    }}
                >
                    <Eye size={16} aria-hidden="true" />
                    Voir en lecture seule
                </button>
                <button className="btn btn--primary" disabled={busy}>
                    Déverrouiller
                </button>
            </div>
        </form>
    );
}

function CreateDialog({ open, onClose, onDone }) {
    return (
        <Dialog open={open} onClose={onClose} title="Nouveau profil" description="Le code protège ta liste : sans lui, les autres peuvent seulement la consulter." size="sm">
            <CreateForm onClose={onClose} onDone={onDone} />
        </Dialog>
    );
}

function CreateForm({ onClose, onDone }) {
    const { createProfile } = useApp();
    const [name, setName] = useState('');
    const [pin, setPin] = useState('');
    const [pin2, setPin2] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        if (!name.trim()) return setError('Donne un nom au profil.');
        if (!/^\d{4,6}$/.test(pin)) return setError('Le code doit faire entre 4 et 6 chiffres.');
        if (pin !== pin2) return setError('Les deux codes ne correspondent pas.');
        setBusy(true);
        setError('');
        try {
            await createProfile(name.trim(), pin);
            onClose();
            onDone();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="form" onSubmit={submit}>
            <label className="field">
                <span className="field__label">Nom du profil</span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus />
            </label>
            <PinField label="Code (4 à 6 chiffres)" value={pin} onChange={setPin} />
            <PinField label="Confirme le code" value={pin2} onChange={setPin2} />
            {error && (
                <p className="form__error" role="alert">
                    {error}
                </p>
            )}
            <div className="form__actions">
                <button type="button" className="btn btn--secondary" onClick={onClose}>
                    Annuler
                </button>
                <button className="btn btn--primary" disabled={busy}>
                    Créer le profil
                </button>
            </div>
        </form>
    );
}
