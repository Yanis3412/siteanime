// « Modifier mon profil » : bannière, photo (GIF possible), bio et top 3 Anime / Manga.
// La bannière et la photo s'enregistrent dès qu'elles sont cadrées ; la bio et les tops avec « Enregistrer ».
import { useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Plus, Search, X } from 'lucide-react';
import { useApp } from '../state/app.jsx';
import { useUi } from '../state/ui.jsx';
import { Dialog } from './ui/Dialog.jsx';
import { Cover } from './ui/Cover.jsx';
import { Framed } from './ui/Framed.jsx';
import { PhotoField } from './PhotoField.jsx';
import { PhotoCropper } from './PhotoCropper.jsx';
import { mediaUrl } from '../lib/api.js';
import { readPhoto, releasePhoto } from '../lib/avatarImage.js';

export const BIO_MAX = 300;

export function ProfileEditor({ open, onClose, profile }) {
    return (
        <Dialog open={open} onClose={onClose} title="Modifier mon profil" description="Ce que les autres voient sur ta page de profil." size="md" className="pedit-dialog">
            {open && profile && <Editor profile={profile} onClose={onClose} />}
        </Dialog>
    );
}

function Editor({ profile, onClose }) {
    const { library, updateProfileInfo } = useApp();
    const { toast } = useUi();
    const [bio, setBio] = useState(profile.bio || '');
    const mine = useMemo(() => new Set((library?.items || []).map((it) => it.id)), [library]);
    // Un titre retiré de la liste libère sa place.
    const [top, setTop] = useState(() => ({
        anime: (profile.top?.anime || []).filter((id) => mine.has(id)),
        manga: (profile.top?.manga || []).filter((id) => mine.has(id)),
    }));
    const [saving, setSaving] = useState(false);

    const save = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            await updateProfileInfo(profile.id, { bio: bio.trim(), top });
            toast('Profil enregistré.', { tone: 'success' });
            onClose();
        } catch (err) {
            toast(err.message, { tone: 'error' });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="pedit">
            <section className="pedit__section">
                <h3 className="pedit__title">Bannière</h3>
                <BannerField profile={profile} />
            </section>
            <section className="pedit__section">
                <h3 className="pedit__title">Photo</h3>
                <PhotoField profile={profile} />
            </section>

            <form className="pedit__form" onSubmit={save}>
                <section className="pedit__section">
                    <label className="field">
                        <span className="pedit__title">Bio</span>
                        <textarea
                            className="input pedit__bio"
                            value={bio}
                            maxLength={BIO_MAX}
                            onChange={(e) => setBio(e.target.value)}
                            placeholder="Ce que tu regardes, ce que tu lis, ce que tu attends…"
                        />
                        <span className="field__hint pedit__count">
                            {bio.length} / {BIO_MAX}
                        </span>
                    </label>
                </section>
                <section className="pedit__section">
                    <h3 className="pedit__title">Top 3 Anime</h3>
                    <TopEditor type="Anime" ids={top.anime} onChange={(anime) => setTop((t) => ({ ...t, anime }))} />
                </section>
                <section className="pedit__section">
                    <h3 className="pedit__title">Top 3 Manga</h3>
                    <TopEditor type="Manga" ids={top.manga} onChange={(manga) => setTop((t) => ({ ...t, manga }))} />
                </section>
                <div className="form__actions pedit__actions">
                    <button type="button" className="btn btn--secondary" onClick={onClose} disabled={saving}>
                        Annuler
                    </button>
                    <button type="submit" className="btn btn--primary" disabled={saving}>
                        {saving ? 'Enregistrement…' : 'Enregistrer'}
                    </button>
                </div>
            </form>
        </div>
    );
}

// Bannière : aperçu, choix d'une image ou d'un GIF, cadrage au format 3:1, retrait.
function BannerField({ profile }) {
    const { setProfileBanner } = useApp();
    const { toast } = useUi();
    const [photo, setPhoto] = useState(null);
    const [busy, setBusy] = useState(false);
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
    const close = () => {
        releasePhoto(photo);
        setPhoto(null);
    };
    const save = async ({ framing }) => {
        setBusy(true);
        try {
            await setProfileBanner(profile.id, { photo, framing });
            toast('Bannière enregistrée.', { tone: 'success' });
            close();
        } catch (err) {
            toast(err.message, { tone: 'error' });
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        setBusy(true);
        try {
            await setProfileBanner(profile.id, null);
            toast('Bannière retirée.', { tone: 'success' });
        } catch (err) {
            toast(err.message, { tone: 'error' });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className={`banner-field ${busy ? 'is-busy' : ''}`}>
            <div className="banner-field__preview">
                {profile.banner ? <Framed src={mediaUrl(profile, 'banner')} frame={profile.banner} /> : <span className="banner-field__empty">Pas de bannière</span>}
            </div>
            <div className="banner-field__actions">
                <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/*" hidden onChange={choose} />
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => inputRef.current?.click()} disabled={busy}>
                    <ImagePlus size={16} aria-hidden="true" />
                    {busy ? 'Envoi…' : profile.banner ? 'Changer la bannière' : 'Choisir une bannière'}
                </button>
                {profile.banner && (
                    <button type="button" className="btn btn--ghost btn--sm" onClick={remove} disabled={busy}>
                        Retirer
                    </button>
                )}
            </div>
            <p className="field__hint">Une image ou un GIF (5 Mo au maximum pour un GIF), affiché en format large en haut de ta page.</p>
            <PhotoCropper photo={photo} mode="banner" busy={busy} onCancel={close} onConfirm={save} />
        </div>
    );
}

// Trois places dans l'ordre, choisies parmi les titres de sa liste.
function TopEditor({ type, ids, onChange }) {
    const { library } = useApp();
    const [picking, setPicking] = useState(false);
    const [query, setQuery] = useState('');
    const items = library?.items || [];
    const chosen = ids.map((id) => items.find((it) => it.id === id)).filter(Boolean);

    const options = useMemo(() => {
        const q = query.trim().toLowerCase();
        return items
            .filter((it) => it.type === type && !ids.includes(it.id) && (!q || it.title.toLowerCase().includes(q)))
            .sort((a, b) => a.title.localeCompare(b.title, 'fr'))
            .slice(0, 30);
    }, [items, type, ids, query]);

    const move = (i, d) => {
        const next = [...ids];
        [next[i], next[i + d]] = [next[i + d], next[i]];
        onChange(next);
    };
    const pick = (id) => {
        onChange([...ids, id].slice(0, 3));
        setPicking(false);
        setQuery('');
    };

    return (
        <div className="top-edit">
            <ol className="top-edit__list">
                {chosen.map((it, i) => (
                    <li key={it.id} className="top-edit__row">
                        <span className="top-edit__rank">{i + 1}</span>
                        <Cover src={it.imageUrl} title={it.title} className="cover--thumb" />
                        <span className="top-edit__title">{it.title}</span>
                        <span className="top-edit__tools">
                            <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Monter ${it.title}`}>
                                <ArrowUp size={15} />
                            </button>
                            <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => move(i, 1)} disabled={i === chosen.length - 1} aria-label={`Descendre ${it.title}`}>
                                <ArrowDown size={15} />
                            </button>
                            <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => onChange(ids.filter((id) => id !== it.id))} aria-label={`Retirer ${it.title}`}>
                                <X size={15} />
                            </button>
                        </span>
                    </li>
                ))}
            </ol>

            {chosen.length < 3 &&
                (picking ? (
                    <div className="top-edit__picker">
                        <label className="search search--compact">
                            <Search size={16} aria-hidden="true" />
                            <input
                                className="search__input"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Escape') {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        setPicking(false);
                                    }
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        if (options[0]) pick(options[0].id);
                                    }
                                }}
                                placeholder={`Chercher dans tes ${type === 'Anime' ? 'animes' : 'mangas'}`}
                                aria-label={`Chercher dans tes ${type === 'Anime' ? 'animes' : 'mangas'}`}
                                autoFocus
                            />
                        </label>
                        <ul className="top-edit__options">
                            {options.length === 0 && <li className="muted top-edit__none">Aucun titre trouvé dans ta liste.</li>}
                            {options.map((it) => (
                                <li key={it.id}>
                                    <button type="button" className="top-edit__option" onClick={() => pick(it.id)}>
                                        <Cover src={it.imageUrl} title={it.title} className="cover--thumb" />
                                        <span>{it.title}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPicking(false)}>
                            Fermer
                        </button>
                    </div>
                ) : (
                    <button type="button" className="btn btn--secondary btn--sm top-edit__add" onClick={() => setPicking(true)}>
                        <Plus size={15} aria-hidden="true" />
                        Choisir le n° {chosen.length + 1}
                    </button>
                ))}
        </div>
    );
}
