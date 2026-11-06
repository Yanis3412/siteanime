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

const sameTitle = (a, b) =>
    a.type === b.type && ((a.malId && b.malId && Number(a.malId) === Number(b.malId)) || a.title.trim().toLowerCase() === b.title.trim().toLowerCase());

// Fusionne une liste de l'ancien site dans une liste v2 existante.
// La progression de l'ancien site fait foi ; les identifiants v2 sont conservés
// (les chapitres importés restent rattachés à leur titre).
function mergeItems(legacyItems, imageCache, currentItems, { keepIds, migratedAt }) {
    const used = new Set();
    const merged = [];
    for (const raw of legacyItems) {
        if (!raw?.title) continue;
        const match = currentItems.find((it) => !used.has(it.id) && sameTitle(it, { ...raw, type: raw.type === 'Anime' ? 'Anime' : 'Manga' }));
        if (!match) {
            const created = convertLegacyItem(raw, imageCache);
            if (created) merged.push(created);
            continue;
        }
        used.add(match.id);
        const hasSeasons = Array.isArray(raw.seasons) && raw.seasons.length > 0;
        const item = sanitizeItem({
            ...match,
            title: raw.title,
            current: raw.current,
            total: raw.total,
            malId: raw.malId || match.malId,
            status: raw.status || match.status,
            fav: raw.fav,
            recommended: raw.recommended,
            note: raw.note ?? match.note,
            seasons: hasSeasons ? raw.seasons : match.seasons,
            seasonProgress: hasSeasons ? raw.seasonProgress : match.seasonProgress,
            imageUrl: match.imageUrl || imageCache?.[`${raw.title}-${raw.type}`] || null,
            updatedAt: Date.now(),
        });
        if (item) merged.push(item);
    }
    // Titres présents seulement dans la nouvelle version : gardés s'ils y ont été ajoutés
    // après la première migration ou s'ils ont des chapitres importés.
    for (const it of currentItems) {
        if (!used.has(it.id) && (keepIds.has(it.id) || (it.addedAt || 0) > migratedAt)) merged.push(it);
    }
    return merged.slice(0, MAX_ITEMS);
}

// Importe les profils de l'ancien site. Sans données v2, c'est une simple copie ;
// sinon (réimport), les listes sont fusionnées sans perdre les chapitres ni les ajouts récents.
export async function migrateFromLegacy(kv, { hashPin, verifyPin } = {}) {
    const previous = await kv.get(keys.migrated);
    const migratedAt = previous?.at || 0;
    const legacy = await readLegacyProfiles(kv);
    let itemCount = 0;

    for (const old of legacy) {
        const id = cleanString(old.id, 64) || `profile_${Date.now()}`;
        const legacyItems = Array.isArray(old.library) ? old.library : [];
        const existing = await kv.get(keys.profile(id));
        const currentLib = existing ? (await kv.get(keys.library(id))) || emptyLibrary() : null;
        const keepIds = new Set(existing ? await kv.smembers(`v2:chapter-items:${id}`) : []);

        const items = currentLib
            ? mergeItems(legacyItems, old.imageCache, currentLib.items || [], { keepIds, migratedAt })
            : legacyItems.map((it) => convertLegacyItem(it, old.imageCache)).filter(Boolean).slice(0, MAX_ITEMS);
        itemCount += items.length;

        // Code : celui de l'ancien site fait foi. S'il n'a pas changé, les sessions restent valides.
        let pinHash = old.password ? hashPin(String(old.password)) : null;
        let pinVersion = existing?.pinVersion || 1;
        if (existing) {
            const unchanged = old.password ? existing.pinHash && verifyPin(String(old.password), existing.pinHash) : !existing.pinHash;
            if (unchanged) pinHash = existing.pinHash;
            else pinVersion += 1;
        }

        const profile = {
            id,
            name: cleanString(old.name, 40),
            isAdmin: !!old.isAdmin || !!existing?.isAdmin,
            pinHash,
            pinVersion,
            itemCount: items.length,
            createdAt: existing?.createdAt ?? (id === 'default' ? 0 : Number(String(id).replace(/\D/g, '')) || Date.now()),
            updatedAt: Date.now(),
        };
        const library = {
            version: (currentLib?.version || 0) + 1,
            updatedAt: Date.now(),
            items,
            lastKnownTotals: { ...(currentLib?.lastKnownTotals || {}), ...sanitizeTotals(old.lastKnownTotals) },
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
export async function ensureMigrated(kv, hashPin, verifyPin) {
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
        await migrateFromLegacy(kv, { hashPin, verifyPin });
    } finally {
        await kv.del(keys.migrationLock);
    }
}
