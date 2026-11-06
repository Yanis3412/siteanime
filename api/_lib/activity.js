// Journal d'activité de chaque profil (page « Activité ») : ajouts, progression, séries terminées,
// watchlist, recommandations, chapitres importés. Un journal par profil (100 entrées au plus),
// pour que les enregistrements de deux amis ne se marchent pas dessus.
import crypto from 'node:crypto';
import { keys } from './store.js';

const MAX_ENTRIES = 100;
const MERGE_WINDOW = 6 * 3600 * 1000; // une séance de lecture = une seule ligne
const BULK = 10; // au-delà, c'est un import de liste ou une grosse mise à jour

export const activityKey = (profileId) => `v2:activity:${profileId}`;

export function progressOf(item) {
    if (item.seasons?.length) {
        const total = item.seasons.reduce((n, s) => n + (s.episodes || 0), 0);
        const current = (item.seasonProgress || []).reduce((n, p) => n + (p || 0), 0);
        return { current, total: total || null };
    }
    return { current: item.current || 0, total: item.total || null };
}

// Fini = tout vu ou lu, et l'œuvre elle-même est terminée.
export function isFinished(item) {
    const { current, total } = progressOf(item);
    const ongoing = item.seasons?.length ? item.seasons[item.seasons.length - 1]?.status === 'ongoing' : item.status === 'ongoing';
    return !!total && current >= total && !ongoing;
}

const base = (item) => ({ itemId: item.id, title: item.title, type: item.type, imageUrl: item.imageUrl || null });

// Compare la liste avant et après un enregistrement.
function diff(before, after) {
    const old = new Map(before.map((it) => [it.id, it]));
    const events = [];
    for (const it of after) {
        const prev = old.get(it.id);
        if (!prev) {
            events.push({ kind: 'added', ...base(it), fav: !!it.fav });
            continue;
        }
        const a = progressOf(prev).current;
        const b = progressOf(it).current;
        if (!isFinished(prev) && isFinished(it)) events.push({ kind: 'finished', ...base(it) });
        else if (b > a) events.push({ kind: 'progress', ...base(it), from: a, to: b, seasons: !!it.seasons?.length });
        if (!prev.fav && it.fav) events.push({ kind: 'watchlist', ...base(it) });
        if (!prev.recommended && it.recommended) events.push({ kind: 'recommended', ...base(it) });
    }
    return events;
}

async function append(kv, profileId, events) {
    if (!events.length) return;
    const now = Date.now();
    let log = (await kv.get(activityKey(profileId))) || [];
    for (const ev of events) {
        // Progression ou import sur le même titre peu de temps avant : on prolonge la même ligne.
        const i = log.findIndex((e) => e.kind === ev.kind && e.itemId === ev.itemId && now - e.at < MERGE_WINDOW);
        if ((ev.kind === 'progress' || ev.kind === 'imported') && i !== -1) {
            const prev = log[i];
            const merged =
                ev.kind === 'progress'
                    ? { ...prev, to: ev.to, title: ev.title, imageUrl: ev.imageUrl, at: now }
                    : { ...prev, nums: [...new Set([...prev.nums, ...ev.nums])].sort((x, y) => x - y), at: now };
            log = [merged, ...log.slice(0, i), ...log.slice(i + 1)];
            continue;
        }
        // Une série terminée remplace la ligne de progression de la même séance.
        if (ev.kind === 'finished' && i === -1) {
            const p = log.findIndex((e) => e.kind === 'progress' && e.itemId === ev.itemId && now - e.at < MERGE_WINDOW);
            if (p !== -1) log.splice(p, 1);
        }
        log.unshift({ id: crypto.randomUUID(), at: now, ...ev });
    }
    await kv.set(activityKey(profileId), log.slice(0, MAX_ENTRIES));
}

export async function recordLibraryChanges(kv, profileId, before, after) {
    try {
        const events = diff(before || [], after || []);
        if (events.length > BULK) await append(kv, profileId, [{ kind: 'bulk', count: events.length }]);
        else await append(kv, profileId, events);
    } catch {
        /* le journal ne doit jamais empêcher d'enregistrer la liste */
    }
}

export async function recordImport(kv, profileId, itemId, num) {
    try {
        const library = await kv.get(keys.library(profileId));
        const item = library?.items?.find((it) => it.id === itemId);
        if (!item) return;
        await append(kv, profileId, [{ kind: 'imported', ...base(item), nums: [num] }]);
    } catch {
        /* sans conséquence */
    }
}

// Chiffres d'un profil à partir de sa liste.
export function statsOf(items) {
    const s = { episodes: 0, chapters: 0, finishedAnime: 0, finishedManga: 0, inProgress: 0, watchlist: 0, titles: items.length };
    for (const it of items) {
        const { current } = progressOf(it);
        if (it.type === 'Anime') s.episodes += current;
        else s.chapters += current;
        if (it.fav) s.watchlist++;
        else if (isFinished(it)) it.type === 'Anime' ? s.finishedAnime++ : s.finishedManga++;
        else if (current > 0) s.inProgress++;
    }
    return s;
}
