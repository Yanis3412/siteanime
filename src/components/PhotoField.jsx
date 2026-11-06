// Photo d'un profil : aperçu, choix d'une image depuis l'appareil, retrait.
// La photo est enregistrée dès qu'elle est choisie.
import { useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { useApp } from '../state/app.jsx';
import { useUi } from '../state/ui.jsx';
import { Avatar } from './ui/Avatar.jsx';
import { avatarUrl } from '../lib/api.js';
import { makeAvatar } from '../lib/avatarImage.js';

export function PhotoField({ profile, asAdmin = false }) {
    const { setProfilePhoto } = useApp();
    const { toast } = useUi();
    const [busy, setBusy] = useState(false);
    const inputRef = useRef(null);

    const choose = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setBusy(true);
        try {
            const image = await makeAvatar(file);
            await setProfilePhoto(profile.id, image, { asAdmin });
            toast('Photo enregistrée.', { tone: 'success' });
        } catch (err) {
            toast(err.message, { tone: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        setBusy(true);
        try {
            await setProfilePhoto(profile.id, null, { asAdmin });
            toast('Photo retirée.', { tone: 'success' });
        } catch (err) {
            toast(err.message, { tone: 'error' });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className={`photo-field ${busy ? 'is-busy' : ''}`}>
            <Avatar name={profile.name} src={avatarUrl(profile)} size="lg" />
            <div className="photo-field__actions">
                <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/*" hidden onChange={choose} />
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => inputRef.current?.click()} disabled={busy}>
                    <ImagePlus size={16} aria-hidden="true" />
                    {busy ? 'Envoi…' : profile.avatar ? 'Changer la photo' : 'Choisir une photo'}
                </button>
                {profile.avatar && (
                    <button type="button" className="btn btn--ghost btn--sm" onClick={remove} disabled={busy}>
                        Retirer
                    </button>
                )}
                <p className="field__hint">Une image JPG, PNG ou WebP de ton ordinateur ou de ton téléphone, recadrée en carré.</p>
            </div>
        </div>
    );
}
