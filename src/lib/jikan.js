// Accès à l'API Jikan (données MyAnimeList).
// Toutes les requêtes passent par une file d'attente pour respecter la limite de débit
// (environ 3 requêtes par seconde) et sont mises en cache pendant la session.

const BASE = 'https://api.jikan.moe/v4';
const SPACING_MS = 420;
const cache = new Map();
let queue = Promise.resolve();
let lastCall = 0;

function schedule(task) {
    const run = queue.then(async () => {
        const wait = lastCall + SPACING_MS - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        lastCall = Date.now();
        return task();
    });
    queue = run.catch(() => {});
    return run;
}

export async function jikan(path, { fresh = false } = {}) {
    if (!fresh && cache.has(path)) return cache.get(path);
    const data = await schedule(async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
            const res = await fetch(BASE + path);
            if (res.status === 429) {
                await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
                continue;
            }
            if (res.status === 404) return null;
            if (!res.ok) throw new Error(`Jikan ${res.status}`);
            return (await res.json()).data ?? null;
        }
        throw new Error('Jikan indisponible (trop de requêtes)');
    });
    cache.set(path, data);
    return data;
}

const kind = (type) => (type === 'Anime' ? 'anime' : 'manga');

export function toStatus(malStatus) {
    if (malStatus === 'Currently Airing' || malStatus === 'Publishing') return 'ongoing';
    if (malStatus === 'Finished Airing' || malStatus === 'Finished') return 'completed';
    return 'unknown';
}

export function coverOf(entry) {
    return entry?.images?.webp?.large_image_url || entry?.images?.jpg?.large_image_url || entry?.images?.jpg?.image_url || null;
}

// Résumé utile d'une fiche MAL.
export function summarize(entry, type) {
    if (!entry) return null;
    return {
        malId: entry.mal_id,
        title: entry.title,
        total: (type === 'Anime' ? entry.episodes : entry.chapters) || null,
        status: toStatus(entry.status),
        imageUrl: coverOf(entry),
        year: entry.year || (entry.aired?.from || entry.published?.from ? new Date(entry.aired?.from || entry.published?.from).getFullYear() : null),
    };
}

export async function search(query, type, limit = 8) {
    const list = await jikan(`/${kind(type)}?q=${encodeURIComponent(query)}&limit=${limit}&sfw=true`);
    return Array.isArray(list) ? list : [];
}

export async function getEntry(type, malId, opts) {
    return jikan(`/${kind(type)}/${malId}/full`, opts);
}

// Fiche MAL d'une œuvre : par identifiant si connu, sinon par recherche du titre.
export async function findEntry(item, opts) {
    if (item.malId) return getEntry(item.type, item.malId, opts);
    const results = await search(item.title, item.type, 1);
    if (!results[0]) return null;
    return getEntry(item.type, results[0].mal_id, opts);
}

const SEASON_RELATIONS = ['Sequel', 'Prequel', 'Parent story', 'Side story'];

// Reconstitue toutes les saisons d'un anime en suivant ses relations sur MAL.
export async function fetchSeasons(malId) {
    // La fiche "full" contient à la fois les infos et les relations : un seul appel par saison.
    const ids = new Set([malId]);
    const toVisit = [malId];
    const entries = [];
    while (toVisit.length && entries.length < 16) {
        const id = toVisit.shift();
        const a = await jikan(`/anime/${id}/full`);
        if (!a) continue;
        entries.push(a);
        for (const rel of a.relations || []) {
            if (!SEASON_RELATIONS.includes(rel.relation)) continue;
            for (const e of rel.entry || []) {
                if (e.type === 'anime' && !ids.has(e.mal_id)) {
                    ids.add(e.mal_id);
                    toVisit.push(e.mal_id);
                }
            }
        }
    }

    const seasons = [];
    for (const a of entries) {
        seasons.push({
            malId: a.mal_id,
            name: a.title,
            episodes: a.episodes || null,
            aired: a.aired?.from ? new Date(a.aired.from).getTime() : 0,
            status: a.status === 'Currently Airing' ? 'ongoing' : 'completed',
            imageUrl: coverOf(a),
        });
    }
    seasons.sort((a, b) => (a.aired || Infinity) - (b.aired || Infinity));
    seasons.forEach((s, i) => (s.seasonNumber = i + 1));
    return seasons;
}

// Prochaine diffusion d'un anime en cours (d'après le jour/heure de diffusion au Japon).
export function nextBroadcast(entry) {
    const b = entry?.broadcast;
    if (!b?.day || entry.status !== 'Currently Airing') return null;
    const days = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
    const dayIndex = days.findIndex((d) => d.toLowerCase().startsWith(String(b.day).toLowerCase()));
    if (dayIndex === -1) return null;
    const [h, m] = String(b.time || '00:00').split(':').map(Number);
    // Le jour et l'heure sont donnés à l'heure de Tokyo (UTC+9) : on calcule dans ce fuseau
    // puis on revient à un instant absolu, affiché ensuite à l'heure locale.
    const JST = 9 * 3600e3;
    const now = new Date();
    const jstNow = new Date(now.getTime() + JST);
    const candidate = new Date(Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate(), h || 0, m || 0));
    candidate.setUTCDate(candidate.getUTCDate() + ((dayIndex - candidate.getUTCDay() + 7) % 7));
    let target = new Date(candidate.getTime() - JST);
    if (target <= now) target = new Date(target.getTime() + 7 * 86400e3);
    return target;
}

const WEEKLY = ['shonen jump', 'shounen jump', 'shonen magazine', 'shounen magazine', 'shonen sunday', 'shounen sunday', 'young jump'];

// Estimation de la prochaine sortie d'un manga (hebdomadaire ou mensuel selon le magazine).
export function nextChapterEstimate(entry) {
    if (entry?.status !== 'Publishing') return null;
    const magazine = entry.serializations?.[0]?.name || null;
    const weekly = (entry.serializations || []).some((s) => WEEKLY.some((w) => s.name.toLowerCase().includes(w)));
    const date = new Date();
    if (weekly) {
        date.setDate(date.getDate() + ((7 - date.getDay()) % 7 || 7)); // dimanche suivant
    } else {
        date.setDate(date.getDate() + 14);
    }
    date.setHours(0, 0, 0, 0);
    return { date, weekly, magazine };
}
