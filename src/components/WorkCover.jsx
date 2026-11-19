// Couverture d'un titre venant d'un autre profil, récupérée sur sa fiche si ce profil ne l'a pas.
import { useEffect, useState } from 'react';
import { Cover } from './ui/Cover.jsx';
import { findEntry, coverOf } from '../lib/meta.js';

export function WorkCover({ item, className = 'cover--thumb-lg' }) {
    const [src, setSrc] = useState(item.imageUrl);
    useEffect(() => {
        if (item.imageUrl || !(item.malId || item.anilistId)) return;
        let alive = true;
        findEntry(item)
            .then((e) => alive && setSrc(coverOf(e)))
            .catch(() => {});
        return () => {
            alive = false;
        };
    }, [item]);
    return <Cover src={src} title={item.title} className={className} />;
}
