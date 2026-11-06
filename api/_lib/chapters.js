// Chapitres importés : métadonnées dans Redis, images dans le stockage (R2).
// Une entrée par œuvre : v2:chapters:<profil>:<œuvre> → { chapters: [...] }
import crypto from 'node:crypto';

export const chapterKeys = {
    list: (profileId, itemId) => `v2:chapters:${profileId}:${itemId}`,
    items: (profileId) => `v2:chapter-items:${profileId}`,
    upload: (id) => `v2:upload:${id}`,
    usage: (profileId) => `v2:usage:${profileId}`,
    usageTotal: 'v2:usage:total',
};

export const MAX_PAGES = 600;
export const MAX_PAGE_BYTES = 30 * 1024 * 1024;
export const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif' };

const safe = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '');

// Numéro de chapitre : entier ou décimal (ex. 1180.5), positif.
export function parseNum(value) {
    const n = Number(String(value).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > 1e6) return null;
    return Math.round(n * 100) / 100;
}

export function newPrefix(profileId, itemId, num) {
    const slug = String(num).replace('.', '-');
    return `u/${safe(profileId)}/${safe(itemId)}/c${slug}-${crypto.randomBytes(4).toString('hex')}`;
}

export function pageKey(prefix, index, ext) {
    return `${prefix}/${String(index + 1).padStart(3, '0')}.${ext}`;
}

// Liste des clés des pages d'un chapitre (ext : une extension pour toutes les pages ou une par page).
export function chapterPageKeys(chapter) {
    return Array.from({ length: chapter.pages }, (_, i) =>
        pageKey(chapter.prefix, i, Array.isArray(chapter.ext) ? chapter.ext[i] : chapter.ext),
    );
}

export function compactExts(exts) {
    return exts.every((e) => e === exts[0]) ? exts[0] : exts;
}

// Versions produites par le traducteur : traduite, colorisée, ou les deux.
export const VARIANTS = ['fr', 'color', 'fr-color'];

export function variantPageKeys(chapter, variant) {
    const v = chapter.variants?.[variant];
    return v ? chapterPageKeys(v) : [];
}

// Toutes les pages stockées pour un chapitre (original + versions).
export function allChapterKeys(chapter) {
    return [...chapterPageKeys(chapter), ...Object.keys(chapter.variants || {}).flatMap((v) => variantPageKeys(chapter, v))];
}

export function chapterBytes(chapter) {
    return (chapter.bytes || 0) + Object.values(chapter.variants || {}).reduce((n, v) => n + (v.bytes || 0), 0);
}

export function publicChapter(c) {
    return {
        num: c.num,
        title: c.title || '',
        pages: c.pages,
        bytes: chapterBytes(c),
        addedAt: c.addedAt,
        read: c.read ?? null,
        lastPage: c.lastPage || 0,
        readAt: c.readAt || null,
        variants: Object.keys(c.variants || {}),
    };
}

export async function loadChapters(kv, profileId, itemId) {
    const data = await kv.get(chapterKeys.list(profileId, itemId));
    return Array.isArray(data?.chapters) ? data.chapters : [];
}

export async function saveChapters(kv, profileId, itemId, chapters) {
    chapters.sort((a, b) => a.num - b.num);
    if (chapters.length) {
        await kv.set(chapterKeys.list(profileId, itemId), { chapters });
        await kv.sadd(chapterKeys.items(profileId), itemId);
    } else {
        await kv.del(chapterKeys.list(profileId, itemId));
        await kv.srem(chapterKeys.items(profileId), itemId);
    }
}

export async function addUsage(kv, profileId, bytes) {
    if (!bytes) return;
    await kv.incrby(chapterKeys.usage(profileId), bytes);
    await kv.incrby(chapterKeys.usageTotal, bytes);
}

// Supprime tous les chapitres d'un profil (utilisé à la suppression du profil).
export async function removeAllForProfile(kv, blob, profileId) {
    const itemIds = await kv.smembers(chapterKeys.items(profileId));
    let freed = 0;
    for (const itemId of itemIds) {
        const chapters = await loadChapters(kv, profileId, itemId);
        if (blob.configured) await blob.removeMany(chapters.flatMap(allChapterKeys));
        freed += chapters.reduce((n, c) => n + chapterBytes(c), 0);
        await kv.del(chapterKeys.list(profileId, itemId));
    }
    await kv.del(chapterKeys.items(profileId), chapterKeys.usage(profileId));
    if (freed) await kv.incrby(chapterKeys.usageTotal, -freed);
}
