// Infos sur les œuvres : titres, couvertures, nombre de chapitres/épisodes, saisons, sorties.
// Source principale : AniList (rapide et fiable). Secours : Jikan (MyAnimeList) si AniList ne répond pas.
// Toutes les fonctions renvoient le même format « fiche » quelle que soit la source :
// { malId, anilistId, title, type, total, status, imageUrl, year, synopsis, genres, score, scoreSource,
//   nextEpisode: { date, number } | null, magazine, weekly, source }

const ANILIST = 'https://graphql.anilist.co';
const JIKAN = 'https://api.jikan.moe/v4';
const TIMEOUT_MS = 9000;
const DOWN_FOR_MS = 3 * 60 * 1000;

const cache = new Map();
const downUntil = { anilist: 0, jikan: 0 };

export class MetaUnavailableError extends Error {
    constructor() {
        super('Les fiches ne répondent pas pour le moment. Réessaie dans quelques minutes.');
    }
}

// ---------- Réseau : file d'attente par source, délai maximum, nouvelles tentatives ----------

function makeQueue(spacingMs) {
    let chain = Promise.resolve();
    let last = 0;
    return (task) => {
        const run = chain.then(async () => {
            const wait = last + spacingMs - Date.now();
            if (wait > 0) await sleep(wait);
            last = Date.now();
            return task();
        });
        chain = run.catch(() => {});
        return run;
    };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const anilistQueue = makeQueue(2100); // AniList limite actuellement à 30 requêtes par minute
const jikanQueue = makeQueue(420);

async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

class SourceError extends Error {}

async function anilist(query, variables, { fresh = false } = {}) {
    const cacheKey = `al:${query}:${JSON.stringify(variables)}`;
    if (!fresh && cache.has(cacheKey)) return cache.get(cacheKey);
    if (Date.now() < downUntil.anilist) throw new SourceError('AniList indisponible');
    const data = await anilistQueue(async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
            let res;
            try {
                res = await fetchWithTimeout(ANILIST, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({ query, variables }),
                });
            } catch {
                downUntil.anilist = Date.now() + DOWN_FOR_MS;
                throw new SourceError('AniList injoignable');
            }
            if (res.status === 429) {
                const retry = Number(res.headers.get('Retry-After')) || 5 * (attempt + 1);
                await sleep(Math.min(retry, 30) * 1000);
                continue;
            }
            // AniList répond 404 quand une partie de la requête ne trouve rien : on garde le reste.
            if (res.ok || res.status === 404) {
                const json = await res.json().catch(() => null);
                if (json?.data) return json.data;
                if (res.status === 404) return {};
            }
            if (res.status >= 500) {
                downUntil.anilist = Date.now() + DOWN_FOR_MS;
                throw new SourceError(`AniList ${res.status}`);
            }
            throw new SourceError(`AniList ${res.status}`);
        }
        throw new SourceError('AniList : trop de requêtes');
    });
    cache.set(cacheKey, data);
    return data;
}

async function jikan(path, { fresh = false } = {}) {
    if (!fresh && cache.has(path)) return cache.get(path);
    if (Date.now() < downUntil.jikan) throw new SourceError('Jikan indisponible');
    const data = await jikanQueue(async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
            let res;
            try {
                res = await fetchWithTimeout(JIKAN + path);
            } catch {
                downUntil.jikan = Date.now() + DOWN_FOR_MS;
                throw new SourceError('Jikan injoignable');
            }
            if (res.status === 429) {
                await sleep(1200 * (attempt + 1));
                continue;
            }
            if (res.status === 404) return null;
            if (!res.ok) {
                if (res.status >= 500) downUntil.jikan = Date.now() + DOWN_FOR_MS;
                throw new SourceError(`Jikan ${res.status}`);
            }
            return (await res.json()).data ?? null;
        }
        throw new SourceError('Jikan : trop de requêtes');
    });
    cache.set(path, data);
    return data;
}

// Essaie AniList, puis Jikan. Les erreurs de programmation remontent telles quelles.
async function withFallback(primary, fallback) {
    try {
        return await primary();
    } catch (err) {
        if (!(err instanceof SourceError)) throw err;
    }
    try {
        return await fallback();
    } catch (err) {
        if (!(err instanceof SourceError)) throw err;
        throw new MetaUnavailableError();
    }
}

// ---------- Normalisation ----------

const FIELDS = `
    id idMal type format status episodes chapters
    title { romaji english }
    coverImage { extraLarge large }
    startDate { year month day }
    description(asHtml: false) genres averageScore
    nextAiringEpisode { airingAt episode }`;

const alType = (type) => (type === 'Anime' ? 'ANIME' : 'MANGA');

function cleanText(html) {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, '\n'), 'text/html');
    return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

function alStatus(status) {
    if (status === 'RELEASING') return 'ongoing';
    if (status === 'FINISHED' || status === 'CANCELLED') return 'completed';
    return 'unknown';
}

function fromAniList(m, type) {
    if (!m) return null;
    return {
        source: 'anilist',
        malId: m.idMal || null,
        anilistId: m.id,
        title: m.title?.romaji || m.title?.english || 'Sans titre',
        type,
        format: m.format,
        total: (type === 'Anime' ? m.episodes : m.chapters) || null,
        status: alStatus(m.status),
        imageUrl: m.coverImage?.extraLarge || m.coverImage?.large || null,
        year: m.startDate?.year || null,
        aired: m.startDate?.year ? Date.UTC(m.startDate.year, (m.startDate.month || 1) - 1, m.startDate.day || 1) : 0,
        synopsis: cleanText(m.description),
        genres: m.genres || [],
        score: m.averageScore ? m.averageScore / 10 : null,
        scoreSource: 'AniList',
        nextEpisode: m.nextAiringEpisode ? { date: new Date(m.nextAiringEpisode.airingAt * 1000), number: m.nextAiringEpisode.episode } : null,
        magazine: null,
        weekly: null,
    };
}

const WEEKLY = ['shonen jump', 'shounen jump', 'shonen magazine', 'shounen magazine', 'shonen sunday', 'shounen sunday', 'young jump'];

function jikanStatus(s) {
    if (s === 'Currently Airing' || s === 'Publishing') return 'ongoing';
    if (s === 'Finished Airing' || s === 'Finished') return 'completed';
    return 'unknown';
}

function fromJikan(e, type) {
    if (!e) return null;
    const from = e.aired?.from || e.published?.from;
    const serializations = e.serializations || [];
    return {
        source: 'jikan',
        malId: e.mal_id,
        anilistId: null,
        title: e.title,
        type,
        total: (type === 'Anime' ? e.episodes : e.chapters) || null,
        status: jikanStatus(e.status),
        imageUrl: e.images?.webp?.large_image_url || e.images?.jpg?.large_image_url || e.images?.jpg?.image_url || null,
        year: e.year || (from ? new Date(from).getFullYear() : null),
        aired: from ? new Date(from).getTime() : 0,
        synopsis: (e.synopsis || '').replace(/\s*\[Written by MAL Rewrite\]\s*$/i, ''),
        genres: (e.genres || []).map((g) => g.name),
        score: e.score || null,
        scoreSource: 'MAL',
        nextEpisode: jikanBroadcast(e),
        magazine: serializations[0]?.name || null,
        weekly: serializations.length ? serializations.some((s) => WEEKLY.some((w) => s.name.toLowerCase().includes(w))) : null,
        relations: e.relations || [],
    };
}

// Jikan ne donne que le jour et l'heure de diffusion au Japon : on en déduit la prochaine date.
function jikanBroadcast(e) {
    const b = e?.broadcast;
    if (!b?.day || e.status !== 'Currently Airing') return null;
    const days = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
    const dayIndex = days.findIndex((d) => d.toLowerCase().startsWith(String(b.day).toLowerCase()));
    if (dayIndex === -1) return null;
    const [h, m] = String(b.time || '00:00').split(':').map(Number);
    const JST = 9 * 3600e3;
    const now = new Date();
    const jstNow = new Date(now.getTime() + JST);
    const candidate = new Date(Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate(), h || 0, m || 0));
    candidate.setUTCDate(candidate.getUTCDate() + ((dayIndex - candidate.getUTCDay() + 7) % 7));
    let date = new Date(candidate.getTime() - JST);
    if (date <= now) date = new Date(date.getTime() + 7 * 86400e3);
    return { date, number: null };
}

const jikanKind = (type) => (type === 'Anime' ? 'anime' : 'manga');

// ---------- Fonctions publiques ----------

export async function search(query, type, limit = 8) {
    return withFallback(
        async () => {
            const data = await anilist(
                `query ($q: String, $type: MediaType, $n: Int) {
                    Page(perPage: $n) { media(search: $q, type: $type, sort: SEARCH_MATCH, isAdult: false) { ${FIELDS} } }
                }`,
                { q: query, type: alType(type), n: limit },
            );
            return (data.Page?.media || []).map((m) => fromAniList(m, type));
        },
        async () => {
            const list = await jikan(`/${jikanKind(type)}?q=${encodeURIComponent(query)}&limit=${limit}&sfw=true`);
            return (list || []).map((e) => fromJikan(e, type));
        },
    );
}

// Fiche d'une œuvre de la liste : par identifiant AniList ou MAL, sinon par son titre.
export async function findEntry(item, opts = {}) {
    const [entry] = await findEntries([item], opts);
    return entry;
}

const BATCH_QUERY = `query ($mal: [Int], $al: [Int], $type: MediaType, $n: Int) {
    byMal: Page(perPage: $n) { media(idMal_in: $mal, type: $type) { ${FIELDS} } }
    byId: Page(perPage: $n) { media(id_in: $al, type: $type) { ${FIELDS} } }
}`;

// Plusieurs fiches en une requête AniList par type (utile pour « Tout mettre à jour » et « Nouveautés »).
// Les identifiants inconnus sont simplement absents de la réponse.
export async function findEntries(items, { fresh = false } = {}) {
    if (!items.length) return [];
    return withFallback(
        async () => {
            const out = new Array(items.length).fill(null);
            for (const type of ['Manga', 'Anime']) {
                const list = items.map((it, i) => ({ it, i })).filter(({ it }) => it.type === type && (it.anilistId || it.malId));
                for (let start = 0; start < list.length; start += 50) {
                    const chunk = list.slice(start, start + 50);
                    const data = await anilist(
                        BATCH_QUERY,
                        {
                            mal: chunk.filter(({ it }) => !it.anilistId).map(({ it }) => Number(it.malId)),
                            al: chunk.filter(({ it }) => it.anilistId).map(({ it }) => Number(it.anilistId)),
                            type: alType(type),
                            n: 50,
                        },
                        { fresh },
                    );
                    const media = [...(data.byMal?.media || []), ...(data.byId?.media || [])];
                    for (const { it, i } of chunk) {
                        const m = it.anilistId ? media.find((x) => x.id === Number(it.anilistId)) : media.find((x) => x.idMal === Number(it.malId));
                        out[i] = fromAniList(m, type);
                    }
                }
            }
            // Titres sans identifiant (ou introuvables par identifiant) : recherche par titre.
            for (let i = 0; i < items.length; i++) {
                if (out[i]) continue;
                const [first] = await search(items[i].title, items[i].type, 1);
                out[i] = first || null;
            }
            return out;
        },
        async () => {
            const out = [];
            for (const it of items) {
                let id = it.malId;
                if (!id) {
                    const list = await jikan(`/${jikanKind(it.type)}?q=${encodeURIComponent(it.title)}&limit=1`);
                    id = list?.[0]?.mal_id;
                }
                out.push(id ? fromJikan(await jikan(`/${jikanKind(it.type)}/${id}/full`, { fresh }), it.type) : null);
            }
            return out;
        },
    );
}

// Résumé court utilisé pour remplir une œuvre de la liste.
export function summarize(entry) {
    if (!entry) return null;
    const { malId, anilistId, title, total, status, imageUrl, year } = entry;
    return { malId, anilistId, title, total, status, imageUrl, year };
}

export const coverOf = (entry) => entry?.imageUrl || null;

const SEASON_FORMATS = ['TV', 'TV_SHORT', 'ONA'];

// Toutes les saisons d'un anime (suites et préquelles diffusées en série), dans l'ordre de diffusion.
export async function fetchSeasons(ref) {
    const start = typeof ref === 'object' ? ref : { malId: ref };
    return withFallback(
        async () => {
            const query = `query ($id: Int, $idMal: Int) {
                Media(id: $id, idMal: $idMal, type: ANIME) {
                    ${FIELDS}
                    relations { edges { relationType node { id type format } } }
                }
            }`;
            const seen = new Set();
            const toVisit = [start.anilistId ? { id: start.anilistId } : { idMal: start.malId }];
            const found = [];
            while (toVisit.length && found.length < 16) {
                const vars = toVisit.shift();
                const m = (await anilist(query, vars)).Media;
                if (!m || seen.has(m.id)) continue;
                seen.add(m.id);
                if (SEASON_FORMATS.includes(m.format) || found.length === 0) found.push(m);
                for (const edge of m.relations?.edges || []) {
                    const n = edge.node;
                    if ((edge.relationType === 'SEQUEL' || edge.relationType === 'PREQUEL') && n.type === 'ANIME' && SEASON_FORMATS.includes(n.format) && !seen.has(n.id)) {
                        toVisit.push({ id: n.id });
                    }
                }
            }
            return toSeasons(found.map((m) => fromAniList(m, 'Anime')));
        },
        async () => {
            const ids = new Set([start.malId]);
            const toVisit = [start.malId];
            const found = [];
            while (toVisit.length && found.length < 16) {
                const e = await jikan(`/anime/${toVisit.shift()}/full`);
                if (!e) continue;
                found.push(fromJikan(e, 'Anime'));
                for (const rel of e.relations || []) {
                    if (rel.relation !== 'Sequel' && rel.relation !== 'Prequel') continue;
                    for (const r of rel.entry || []) {
                        if (r.type === 'anime' && !ids.has(r.mal_id)) {
                            ids.add(r.mal_id);
                            toVisit.push(r.mal_id);
                        }
                    }
                }
            }
            return toSeasons(found);
        },
    );
}

function toSeasons(entries) {
    const seasons = entries.map((e) => ({
        malId: e.malId,
        anilistId: e.anilistId,
        name: e.title,
        episodes: e.total,
        aired: e.aired || 0,
        status: e.status === 'ongoing' ? 'ongoing' : 'completed',
        imageUrl: e.imageUrl,
    }));
    seasons.sort((a, b) => (a.aired || Infinity) - (b.aired || Infinity));
    seasons.forEach((s, i) => (s.seasonNumber = i + 1));
    return seasons;
}

// Prochain épisode d'un anime en cours de diffusion.
export const nextBroadcast = (entry) => entry?.nextEpisode?.date || null;

// Estimation de la prochaine sortie d'un manga, seulement si son rythme est connu (magazine hebdomadaire ou non).
export async function nextChapterEstimate(entry) {
    if (entry?.status !== 'ongoing' || entry.type !== 'Manga') return null;
    let { weekly, magazine } = entry;
    // AniList ne donne pas le magazine de prépublication : on tente MyAnimeList, sans bloquer si absent.
    if (weekly === null && entry.malId && Date.now() >= downUntil.jikan) {
        try {
            const e = fromJikan(await jikan(`/manga/${entry.malId}/full`), 'Manga');
            weekly = e?.weekly ?? null;
            magazine = e?.magazine ?? null;
        } catch {
            /* rythme inconnu */
        }
    }
    if (weekly === null) return null;
    const date = new Date();
    if (weekly) date.setDate(date.getDate() + ((7 - date.getDay()) % 7 || 7));
    else date.setDate(date.getDate() + 14);
    date.setHours(0, 0, 0, 0);
    return { date, weekly, magazine };
}

// Lien vers la fiche en ligne de l'œuvre.
export function externalLink(item) {
    const kind = item.type === 'Anime' ? 'anime' : 'manga';
    if (item.malId) return { label: 'Fiche MyAnimeList', url: `https://myanimelist.net/${kind}/${item.malId}` };
    if (item.anilistId) return { label: 'Fiche AniList', url: `https://anilist.co/${kind}/${item.anilistId}` };
    return null;
}
