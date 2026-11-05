// Calculs sur les œuvres de la bibliothèque.

export const unitLabel = (type, n = 2) =>
    type === 'Anime' ? (n > 1 ? 'épisodes' : 'épisode') : n > 1 ? 'chapitres' : 'chapitre';

// Progression globale, saisons comprises.
export function progressOf(item) {
    if (item.seasons?.length) {
        const total = item.seasons.reduce((n, s) => n + (s.episodes || 0), 0);
        const current = (item.seasonProgress || []).reduce((n, p) => n + (p || 0), 0);
        return { current, total: total || null };
    }
    return { current: item.current || 0, total: item.total || null };
}

export function percentOf(item) {
    const { current, total } = progressOf(item);
    if (!total) return null;
    return Math.min(100, Math.round((current / total) * 100));
}

export function statusOf(item) {
    const { current, total } = progressOf(item);
    if (item.seasons?.length) {
        if (item.seasons[item.seasons.length - 1]?.status === 'ongoing') return 'ongoing';
    } else if (item.status === 'ongoing') return 'ongoing';
    if (item.status === 'completed' || (total && current >= total)) return 'completed';
    return 'unknown';
}

// À jour = on a vu/lu tout ce qui est sorti.
export function isCaughtUp(item) {
    const { current, total } = progressOf(item);
    return !!total && current >= total;
}

export const statusLabel = { ongoing: 'En cours de parution', completed: 'Terminé', unknown: 'Statut inconnu' };

// +1 / −1 sur une œuvre. Pour un anime à saisons : avance la première saison non terminée,
// recule la dernière saison entamée.
export function stepProgress(item, delta) {
    if (item.seasons?.length) {
        const progress = item.seasons.map((_, i) => item.seasonProgress?.[i] || 0);
        if (delta > 0) {
            const i = item.seasons.findIndex((s, idx) => !s.episodes || progress[idx] < s.episodes);
            const idx = i === -1 ? item.seasons.length - 1 : i;
            const max = item.seasons[idx].episodes;
            if (max && progress[idx] >= max) return item;
            progress[idx] += 1;
        } else {
            let idx = progress.length - 1;
            while (idx > 0 && progress[idx] === 0) idx--;
            if (progress[idx] === 0) return item;
            progress[idx] -= 1;
        }
        return { ...item, seasonProgress: progress };
    }
    const current = Math.max(0, (item.current || 0) + delta);
    let total = item.total;
    // Si on dépasse le total connu, c'est que de nouveaux chapitres/épisodes sont sortis.
    if (total && current > total) total = current;
    return { ...item, current, total };
}

export function setCurrent(item, value) {
    let current = Math.max(0, parseInt(value, 10) || 0);
    if (item.total && current > item.total) current = item.total;
    return { ...item, current };
}

export function setTotal(item, value) {
    const total = value === '' || value === null ? null : Math.max(1, parseInt(value, 10) || 0) || null;
    const current = total && item.current > total ? total : item.current;
    return { ...item, total, current };
}

export function setSeasonProgress(item, seasonIndex, value) {
    const progress = item.seasons.map((_, i) => item.seasonProgress?.[i] || 0);
    const max = item.seasons[seasonIndex]?.episodes;
    let v = Math.max(0, parseInt(value, 10) || 0);
    if (max && v > max) v = max;
    progress[seasonIndex] = v;
    return { ...item, seasonProgress: progress };
}

export const sameWork = (a, b) =>
    a.type === b.type && ((a.malId && b.malId && a.malId === b.malId) || a.title.toLowerCase() === b.title.toLowerCase());

export const totalsKey = (item) => String(item.malId || `${item.title}-${item.type}`);

export function newItem(fields) {
    const now = Date.now();
    return {
        id: crypto.randomUUID(),
        title: fields.title,
        type: fields.type,
        current: 0,
        total: fields.total || null,
        malId: fields.malId || null,
        status: fields.status || 'unknown',
        fav: false,
        recommended: false,
        note: '',
        imageUrl: fields.imageUrl || null,
        officialUrl: null,
        addedAt: now,
        updatedAt: now,
    };
}

export function relativeDate(date) {
    if (!date) return 'Date inconnue';
    const now = new Date();
    const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((startOf(date) - startOf(now)) / 86400000);
    const hasTime = date.getHours() !== 0 || date.getMinutes() !== 0;
    const time = hasTime ? ` à ${String(date.getHours()).padStart(2, '0')}h${String(date.getMinutes()).padStart(2, '0')}` : '';
    if (days === 0) return `Aujourd’hui${time}`;
    if (days === 1) return `Demain${time}`;
    const label = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const cap = label.charAt(0).toUpperCase() + label.slice(1);
    return days > 1 && days < 7 ? `${cap}${time}, dans ${days} jours` : `${cap}${time}`;
}
