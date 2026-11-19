// Avis publics des profils : recommandations (« reco ») et titres « Meh » (« meh »),
// avec la raison écrite et les pouces des autres profils (d'accord / pas d'accord).
// Les pouces sont rangés à part de la liste de chaque profil (v2:votes:<profil>),
// pour qu'un vote ne touche jamais à la liste de quelqu'un d'autre.
import { keys, listProfiles } from './store.js';
import { progressOf } from './activity.js';

export const votesKey = (ownerId) => `v2:votes:${ownerId}`;

export const KINDS = {
    reco: { flag: 'recommended', reason: 'recommendedReason', at: 'recommendedAt' },
    meh: { flag: 'disliked', reason: 'dislikedReason', at: 'dislikedAt' },
};

// { up: [profils d'accord], down: [profils pas d'accord] }, sans les profils supprimés.
export function votesOf(doc, kind, itemId, alive) {
    const entry = doc?.[`${kind}:${itemId}`] || {};
    const up = [];
    const down = [];
    for (const [voter, value] of Object.entries(entry)) {
        if (alive && !alive.has(voter)) continue;
        if (value === 1) up.push(voter);
        else if (value === -1) down.push(voter);
    }
    return { up, down };
}

// Avis de chaque profil pour un type d'avis.
export async function listOpinions(kv, kind) {
    const { flag, reason, at } = KINDS[kind];
    const profiles = await listProfiles(kv);
    if (!profiles.length) return [];
    const [libraries, votes] = await Promise.all([kv.mget(profiles.map((p) => keys.library(p.id))), kv.mget(profiles.map((p) => votesKey(p.id)))]);
    const alive = new Set(profiles.map((p) => p.id));
    return profiles.map((p, i) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatarVersion || null,
        items: (libraries[i]?.items || [])
            .filter((it) => it[flag])
            .map((it) => ({
                id: it.id,
                title: it.title,
                type: it.type,
                malId: it.malId,
                anilistId: it.anilistId,
                imageUrl: it.imageUrl,
                status: it.status,
                total: progressOf(it).total,
                reason: it[reason] || '',
                at: it[at] || it.updatedAt || 0,
                votes: votesOf(votes[i], kind, it.id, alive),
            })),
    }));
}

// Pouce d'un profil sur l'avis d'un autre : 1 (d'accord), -1 (pas d'accord), 0 (retire son pouce).
// Renvoie null si l'avis n'existe plus.
export async function castVote(kv, { owner, itemId, kind, voter, value }) {
    const library = await kv.get(keys.library(owner));
    const items = library?.items || [];
    const item = items.find((it) => it.id === itemId);
    if (!item || !item[KINDS[kind].flag]) return null;

    const doc = (await kv.get(votesKey(owner))) || {};
    // On en profite pour oublier les pouces des avis retirés depuis.
    const valid = new Set();
    for (const it of items) for (const [k, { flag }] of Object.entries(KINDS)) if (it[flag]) valid.add(`${k}:${it.id}`);
    for (const key of Object.keys(doc)) if (!valid.has(key)) delete doc[key];

    const key = `${kind}:${itemId}`;
    const entry = { ...(doc[key] || {}) };
    if (value === 0) delete entry[voter];
    else entry[voter] = value;
    if (Object.keys(entry).length) doc[key] = entry;
    else delete doc[key];
    await kv.set(votesKey(owner), doc);

    const alive = new Set((await listProfiles(kv)).map((p) => p.id));
    return votesOf(doc, kind, itemId, alive);
}
