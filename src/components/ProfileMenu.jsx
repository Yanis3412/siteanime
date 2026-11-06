// Menu du profil : changer de profil, photo, renommer, code, export/import, thème, administration.
import { useState } from 'react';
import { CalendarX, DatabaseBackup, Download, Smartphone, ImagePlus, KeyRound, Moon, Pencil, Sun, Trash2, Upload, UserCog, Users } from 'lucide-react';
import { useApp } from '../state/app.jsx';
import { useUi } from '../state/ui.jsx';
import { Menu } from './ui/Menu.jsx';
import { Avatar } from './ui/Avatar.jsx';
import { Dialog } from './ui/Dialog.jsx';
import { PinField } from './PinField.jsx';
import { PhotoField } from './PhotoField.jsx';
import { ManageProfilesDialog } from './ManageProfiles.jsx';
import { BackupsDialog } from './Backups.jsx';
import { InstallDialog } from './InstallApp.jsx';
import { canPromptInstall, isStandalone, promptInstall } from '../lib/pwa.js';
import { buildExport, downloadJson, parseImport } from '../lib/transfer.js';
import { formatBytes } from '../lib/importer.js';
import { api, avatarUrl } from '../lib/api.js';

export function ProfileMenu() {
    const app = useApp();
    const { profile, readOnly, library, hasAdminAccess } = app;
    const { toast, confirm, theme, toggleTheme } = useUi();
    const [dialog, setDialog] = useState(null); // 'rename' | 'pin' | 'photo' | 'manage' | 'backups' | 'install'

    if (!profile) return null;

    const exportList = () => {
        if (!library) return;
        const date = new Date().toISOString().slice(0, 10);
        downloadJson(buildExport(profile.name, library), `${profile.name}-${date}.json`);
        toast('Liste exportée. Garde ce fichier en lieu sûr.', { tone: 'success' });
    };

    const importList = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                const data = parseImport(await file.text());
                const ok = await confirm({
                    title: `Importer « ${data.profileName} » ?`,
                    message: `${data.items.length} titres vont remplacer les ${library?.items.length || 0} titres actuels de ${profile.name}.`,
                    confirmLabel: 'Remplacer ma liste',
                    danger: true,
                });
                if (!ok) return;
                app.replaceLibrary(data.items, data.lastKnownTotals);
                toast(`${data.items.length} titres importés.`, { tone: 'success' });
            } catch (err) {
                toast(err.message, { tone: 'error' });
            }
        };
        input.click();
    };

    // Installer le site comme une appli : directement si le navigateur le permet (Android, ordinateur),
    // sinon explications (iPhone).
    const install = async () => {
        if (canPromptInstall()) {
            if (await promptInstall()) toast('Appli installée : retrouve-la sur ton écran d’accueil.', { tone: 'success' });
        } else setDialog('install');
    };

    // Supprime les chapitres importés il y a plus de 2 mois, sur tous les profils.
    const cleanup = async () => {
        const token = app.session.token;
        try {
            const preview = await api.adminCleanupPreview(token);
            const date = new Date(preview.cutoff).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
            if (!preview.chapters) {
                toast(`Aucun chapitre importé avant le ${date}.`);
                return;
            }
            const who = preview.profiles.map((p) => `${p.name} (${p.chapters})`).join(', ');
            const ok = await confirm({
                title: `Supprimer ${preview.chapters} chapitre${preview.chapters > 1 ? 's' : ''} ?`,
                message: `Tous les chapitres importés avant le ${date}, sur tous les profils : ${who}. Leurs pages et leurs versions en couleur seront effacées (${formatBytes(preview.bytes)} libérés). La progression de lecture ne change pas.`,
                confirmLabel: 'Supprimer les chapitres',
                danger: true,
            });
            if (!ok) return;
            app.setTask({ label: 'Suppression des anciens chapitres', done: 0, total: preview.chapters });
            let removed = 0;
            let freed = 0;
            for (let i = 0; i < 30; i++) {
                const res = await api.adminCleanup(token);
                removed += res.removed;
                freed += res.freed;
                app.setTask({ label: 'Suppression des anciens chapitres', done: Math.min(removed, preview.chapters), total: preview.chapters });
                if (res.done) break;
            }
            toast(`${removed} chapitre${removed > 1 ? 's' : ''} supprimé${removed > 1 ? 's' : ''}, ${formatBytes(freed)} libérés.`, { tone: 'success' });
        } catch (err) {
            toast(err.message, { tone: 'error' });
        } finally {
            app.setTask(null);
        }
    };

    const removeProfile = async () => {
        const ok = await confirm({
            title: `Supprimer le profil ${profile.name} ?`,
            message: 'La liste et toutes ses données seront effacées définitivement. Pense à l’exporter avant.',
            confirmLabel: 'Supprimer le profil',
            danger: true,
        });
        if (!ok) return;
        try {
            await app.deleteProfile(profile.id);
            toast('Profil supprimé.', { tone: 'success' });
        } catch (err) {
            toast(err.message, { tone: 'error' });
        }
    };

    const role = readOnly ? 'Lecture seule' : profile.isAdmin ? 'Administrateur' : `${profile.itemCount} titres`;

    return (
        <>
            <Menu
                label={`Profil ${profile.name}`}
                trigger={(props) => (
                    <button className="profile-trigger" {...props}>
                        <Avatar name={profile.name} src={avatarUrl(profile)} size="sm" />
                    </button>
                )}
                items={[
                    {
                        header: (
                            <div className="menu__profile">
                                <Avatar name={profile.name} src={avatarUrl(profile)} />
                                <div>
                                    <div className="menu__profile-name">{profile.name}</div>
                                    <div className="menu__profile-role">{role}</div>
                                </div>
                            </div>
                        ),
                    },
                    // Ferme la session : le code sera redemandé pour revenir sur ce profil.
                    { label: 'Changer de profil', icon: Users, onSelect: app.leave },
                    'separator',
                    !readOnly && { label: 'Changer la photo', icon: ImagePlus, onSelect: () => setDialog('photo') },
                    !readOnly && { label: 'Renommer le profil', icon: Pencil, onSelect: () => setDialog('rename') },
                    !readOnly && { label: 'Changer le code', icon: KeyRound, onSelect: () => setDialog('pin') },
                    { label: 'Exporter la liste', icon: Download, onSelect: exportList },
                    !readOnly && { label: 'Importer une liste', icon: Upload, onSelect: importList },
                    { label: theme === 'dark' ? 'Passer en thème clair' : 'Passer en thème sombre', icon: theme === 'dark' ? Sun : Moon, onSelect: toggleTheme },
                    !isStandalone() && { label: 'Installer l’appli', icon: Smartphone, onSelect: install },
                    hasAdminAccess && 'separator',
                    hasAdminAccess && { label: 'Gérer les profils', icon: UserCog, onSelect: () => setDialog('manage') },
                    hasAdminAccess && { label: 'Sauvegardes', icon: DatabaseBackup, onSelect: () => setDialog('backups') },
                    hasAdminAccess && { label: 'Supprimer les chapitres de plus de 2 mois', icon: CalendarX, onSelect: cleanup },
                    !readOnly && !profile.isAdmin && { label: 'Supprimer le profil', icon: Trash2, danger: true, onSelect: removeProfile },
                ]}
            />
            <RenameDialog open={dialog === 'rename'} onClose={() => setDialog(null)} />
            <PinDialog open={dialog === 'pin'} onClose={() => setDialog(null)} />
            <Dialog open={dialog === 'photo'} onClose={() => setDialog(null)} title="Photo du profil" size="sm">
                <PhotoField profile={profile} />
                <div className="form__actions">
                    <button type="button" className="btn btn--secondary" onClick={() => setDialog(null)}>
                        Fermer
                    </button>
                </div>
            </Dialog>
            <ManageProfilesDialog open={dialog === 'manage'} onClose={() => setDialog(null)} />
            <BackupsDialog open={dialog === 'backups'} onClose={() => setDialog(null)} />
            <InstallDialog open={dialog === 'install'} onClose={() => setDialog(null)} />
        </>
    );
}

function RenameDialog({ open, onClose }) {
    return (
        <Dialog open={open} onClose={onClose} title="Renommer le profil" size="sm">
            <RenameForm onClose={onClose} />
        </Dialog>
    );
}

// Monté à chaque ouverture : le champ repart du nom actuel.
function RenameForm({ onClose }) {
    const { profile, renameProfile } = useApp();
    const { toast } = useUi();
    const [name, setName] = useState(profile.name);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
            await renameProfile(profile.id, name);
            toast('Profil renommé.', { tone: 'success' });
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <form onSubmit={submit} className="form">
            <label className="field">
                <span className="field__label">Nom du profil</span>
                <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus required />
            </label>
            {error && <p className="form__error">{error}</p>}
            <div className="form__actions">
                <button type="button" className="btn btn--secondary" onClick={onClose}>
                    Annuler
                </button>
                <button className="btn btn--primary" disabled={busy}>
                    Renommer
                </button>
            </div>
        </form>
    );
}

function PinDialog({ open, onClose }) {
    const { profile, changePin } = useApp();
    const { toast } = useUi();
    const [pin, setPin] = useState('');
    const [pin2, setPin2] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const close = () => {
        setPin('');
        setPin2('');
        setError('');
        onClose();
    };

    const submit = async (e) => {
        e.preventDefault();
        if (!/^\d{4,6}$/.test(pin)) return setError('Le code doit faire entre 4 et 6 chiffres.');
        if (pin !== pin2) return setError('Les deux codes ne correspondent pas.');
        setBusy(true);
        try {
            await changePin(profile.id, pin);
            toast('Code modifié. Les autres appareils devront le saisir à nouveau.', { tone: 'success' });
            close();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onClose={close} title="Changer le code" description={`Nouveau code pour ${profile.name}, de 4 à 6 chiffres.`} size="sm">
            <form onSubmit={submit} className="form">
                <PinField label="Nouveau code" value={pin} onChange={setPin} autoFocus />
                <PinField label="Confirme le code" value={pin2} onChange={setPin2} />
                {error && <p className="form__error">{error}</p>}
                <div className="form__actions">
                    <button type="button" className="btn btn--secondary" onClick={close}>
                        Annuler
                    </button>
                    <button className="btn btn--primary" disabled={busy}>
                        Enregistrer le code
                    </button>
                </div>
            </form>
        </Dialog>
    );
}
