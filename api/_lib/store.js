// Modèle de données v2 : un enregistrement par profil + une bibliothèque par profil.
// L'ancienne clé "anime-profiles" (v1) n'est jamais modifiée : elle sert de sauvegarde.
import crypto from 'node:crypto';
import { cleanString } from './http.js';

export const keys = {
    profileIds: 'v2:profile-ids',
    profile: (id) => `v2:profile:${id}`,
    library: (id) => `v2:library:${id}`,
    session: (token) => `v2:session:${token}`,
    fails: (id) => `v2:fails:${id}`,
    migrated: 'v2:migrated',
    migrationLock: 'v2:migration-lock',
    legacy: 'anime-profiles',
};

export const MAX_ITEMS = 3000;

export function publicProfile(p) {
    return {
        id: p.id,
        name: p.name,
        isAdmin: !!p.isAdmin,
        hasPin: !!p.pinHash,
        itemCount: p.itemCount || 0,
        createdAt: p.createdAt || 0,
    };
}

export async function listProfiles(kv) {
    const ids = await kv.smembers(keys.profileIds);
    const records = await kv.mget(ids.map(keys.profile));
    return records.filter(Boolean).sort((a, b) => (b.isAdmin - a.isAdmin) || (a.createdAt - b.createdAt));
}

export function emptyLibrary() {
    return { version: 1, updatedAt: Date.now(), items: [], lastKnownTotals: {} };
}

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

const url = (v) => {
    const s = cleanString(v, 600);
    return /^https:\/\//.test(s) ? s : null;
};

// Nettoie une œuvre reçue du navigateur (types, tailles, champs connus seulement).
export function sanitizeItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const title = cleanString(raw.title, 200);
    if (!title) return null;
    const type = raw.type === 'Anime' ? 'Anime' : 'Manga';
    const status = ['ongoing', 'completed', 'unknown'].includes(raw.status) ? raw.status : 'unknown';
    const item = {
        id: cleanString(raw.id, 64) || crypto.randomUUID(),
        title,
        type,
        current: num(raw.current) ?? 0,
        total: num(raw.total) || null,
        malId: num(raw.malId) || null,
        status,
        fav: !!raw.fav,
        recommended: !!raw.recommended,
        note: cleanString(raw.note, 4000),
        imageUrl: url(raw.imageUrl),
        officialUrl: url(raw.officialUrl),
        addedAt: num(raw.addedAt) || Date.now(),
        updatedAt: num(raw.updatedAt) || Date.now(),
    };
    if (Array.isArray(raw.seasons) && raw.seasons.length) {
        item.seasons = raw.seasons.slice(0, 60).map((s, i) => ({
            malId: num(s?.malId) || null,
            name: cleanString(s?.name, 200) || `Saison ${i + 1}`,
            episodes: num(s?.episodes) || null,
            aired: num(s?.aired) || 0,
            status: s?.status === 'ongoing' ? 'ongoing' : 'completed',
            imageUrl: url(s?.imageUrl),
            seasonNumber: num(s?.seasonNumber) || i + 1,
        }));
        const progress = Array.isArray(raw.seasonProgress) ? raw.seasonProgress : [];
        item.seasonProgress = item.seasons.map((_, i) => num(progress[i]) ?? 0);
    }
    return item;
}

export function sanitizeTotals(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [k, v] of Object.entries(raw).slice(0, MAX_ITEMS)) {
        const n = num(v);
        if (n !== null) out[cleanString(k, 220)] = n;
    }
    return out;
}

// ---------- Migration v1 → v2 ----------

function convertLegacyItem(item, imageCache) {
    if (!item?.title) return null;
    return sanitizeItem({
        ...item,
        id: crypto.randomUUID(),
        imageUrl: imageCache?.[`${item.title}-${item.type}`] || null,
        addedAt: Date.now(),
        updatedAt: Date.now(),
    });
}

export async function readLegacyProfiles(kv) {
    let raw = await kv.get(keys.legacy);
    if (typeof raw === 'string') {
        try {
            raw = JSON.parse(raw);
        } catch {
            raw = null;
        }
    }
    const profiles = raw?.profiles && typeof raw.profiles === 'object' ? raw.profiles : {};
    return Object.values(profiles).filter((p) => p && p.id && p.name && p.name !== 'undefined' && p.name.trim());
}

// Importe les profils v1. Avec force=true, remplace les données v2 existantes.
export async function migrateFromLegacy(kv, { force = false, hashPin } = {}) {
    if (force) {
        const ids = await kv.smembers(keys.profileIds);
        if (ids.length) {
            await kv.del(...ids.map(keys.profile), ...ids.map(keys.library), keys.profileIds);
        }
    }

    const legacy = await readLegacyProfiles(kv);
    let itemCount = 0;
    for (const old of legacy) {
        const id = cleanString(old.id, 64) || `profile_${Date.now()}`;
        const items = (Array.isArray(old.library) ? old.library : [])
            .map((it) => convertLegacyItem(it, old.imageCache))
            .filter(Boolean)
            .slice(0, MAX_ITEMS);
        itemCount += items.length;

        const profile = {
            id,
            name: cleanString(old.name, 40),
            isAdmin: !!old.isAdmin,
            pinHash: old.password ? hashPin(String(old.password)) : null,
            pinVersion: 1,
            itemCount: items.length,
            createdAt: id === 'default' ? 0 : Number(String(id).replace(/\D/g, '')) || Date.now(),
            updatedAt: Date.now(),
        };
        const library = {
            version: 1,
            updatedAt: Date.now(),
            items,
            lastKnownTotals: sanitizeTotals(old.lastKnownTotals),
        };
        await kv.set(keys.profile(id), profile);
        await kv.set(keys.library(id), library);
        await kv.sadd(keys.profileIds, id);
    }

    const summary = { at: Date.now(), profiles: legacy.length, items: itemCount };
    await kv.set(keys.migrated, summary);
    return summary;
}

// Lance la migration une seule fois, au premier appel.
export async function ensureMigrated(kv, hashPin) {
    if (await kv.get(keys.migrated)) return;
    const gotLock = await kv.set(keys.migrationLock, Date.now(), { nx: true, ex: 60 });
    if (!gotLock) {
        // Une autre requête migre déjà : on attend qu'elle termine.
        for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 300));
            if (await kv.get(keys.migrated)) return;
        }
        return;
    }
    try {
        await migrateFromLegacy(kv, { hashPin });
    } finally {
        await kv.del(keys.migrationLock);
    }
}
