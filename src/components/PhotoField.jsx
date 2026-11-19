// Photo d'un profil : aperçu, choix d'une image depuis l'appareil, cadrage, retrait.
// Un GIF bouge sur la page de profil ; partout ailleurs, c'est sa première image (cadrée) qui s'affiche.
import { useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { useApp } from '../state/app.jsx';
import { useUi } from '../state/ui.jsx';
import { Avatar } from './ui/Avatar.jsx';
import { PhotoCropper } from './PhotoCropper.jsx';
import { avatarUrl, mediaUrl } from '../lib/api.js';
import { readPhoto, releasePhoto } from '../lib/avatarImage.js';

export function PhotoField({ profile, asAdmin = false }) {
    const { setProfilePhoto } = useApp();
    const { toast } = useUi();
    const [busy, setBusy] = useState(false);
    const [photo, setPhoto] = useState(null); // image choisie, en cours de cadrage
    const inputRef = useRef(null);

    const choose = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
            setPhoto(await readPhoto(file));
        } catch (err) {
            toast(err.message, { tone: 'error' });
        }
    };

    const closeCropper = () => {
        releasePhoto(photo);
        setPhoto(null);
    };

    const save = async ({ image, framing }) => {
        setBusy(true);
        try {
            await setProfilePhoto(profile.id, image, { asAdmin, anim: photo.animated ? { file: photo.file, framing } : null });
            toast('Photo enregistrée.', { tone: 'success' });
            closeCropper();
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
            <Avatar name={profile.name} src={avatarUrl(profile)} size="lg" anim={profile.anim ? { src: mediaUrl(profile, 'anim'), frame: profile.anim } : null} />
            <div className="photo-field__actions">
                <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/*" hidden onChange={choose} />
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => inputRef.current?.click()} disabled={busy}>
                    <ImagePlus size={16} aria-hidden="true" />
                    {busy ? 'Envoi…' : profile.avatar ? 'Changer la photo' : 'Choisir une photo'}
                </button>
                {profile.avatar && (
                    <button type="button" className="btn btn--ghost btn--sm" onClick={remove} disabled={busy}>
                        Retirer
                    </button>
                )}
                <p className="field__hint">Une image JPG, PNG, WebP ou un GIF (5 Mo au maximum) de ton ordinateur ou de ton téléphone. Tu pourras la cadrer avant de l’enregistrer. Le GIF bouge sur ta page de profil.</p>
            </div>
            <PhotoCropper photo={photo} name={profile.name} busy={busy} onCancel={closeCropper} onConfirm={save} />
        </div>
    );
}
