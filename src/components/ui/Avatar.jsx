// Pastille d'un profil : sa photo s'il en a une, sinon ses initiales.
// La teinte dépend du nom, pour reconnaître chacun même sans photo.
// anim = { src, frame } : GIF cadré, affiché à la place de la photo (page de profil).
import { useState } from 'react';
import { Framed } from './Framed.jsx';

export function Avatar({ name = '', src = null, size = 'md', anim = null }) {
    const [failed, setFailed] = useState(null);
    const initials = name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w.charAt(0).toUpperCase())
        .join('');
    let hash = 0;
    for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const hue = hash % 360;
    const showPhoto = src && failed !== src;
    return (
        <span className={`avatar avatar--${size}${showPhoto || anim ? ' avatar--photo' : ''}`} style={{ '--avatar-hue': hue }} aria-hidden="true">
            {anim ? (
                <Framed src={anim.src} frame={anim.frame} className="avatar__anim" />
            ) : showPhoto ? (
                <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(src)} />
            ) : (
                initials || '?'
            )}
        </span>
    );
}
