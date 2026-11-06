// Chapitres importés d'un manga. Toutes les actions demandent d'être connecté au profil
// (ou d'être l'administrateur) : les chapitres de chacun restent privés.
//
// GET    /api/chapters?profileId&itemId            → liste des chapitres + stockage utilisé
// GET    /api/chapters?profileId&itemId&num[&variant] → un chapitre avec les liens de lecture de ses pages
// POST   /api/chapters { action: 'prepare', … }    → liens d'envoi pour les pages d'un chapitre
// POST   /api/chapters { action: 'commit', uploadId }
// POST   /api/chapters { action: 'abort', uploadId }
// PATCH  /api/chapters { profileId, itemId, num, read?, lastPage? }
// DELETE /api/chapters?profileId&itemId&num  (ou &all=1 pour tous les chapitres de l'œuvre)
import crypto from 'node:crypto';
import { getKV } from './_lib/kv.js';
import { getBlob, storageLimit } from './_lib/blob.js';
import { route, send, body, cleanString, HttpError } from './_lib/http.js';
import { keys } from './_lib/store.js';
import { requireWrite } from './_lib/auth.js';
import {
    chapterKeys,
    MAX_PAGES,
    MAX_PAGE_BYTES,
    TYPES,
    parseNum,
    newPrefix,
    pageKey,
    chapterPageKeys,
    allChapterKeys,
    chapterBytes,
    variantPageKeys,
    VARIANTS,
    compactExts,
    publicChapter,
    loadChapters,
    saveChapters,
    addUsage,
} from './_lib/chapters.js';

const UPLOAD_SESSION_TTL = 60 * 60 * 6;

function ids(source) {
    const profileId = cleanString(source?.profileId, 80);
    const itemId = cleanString(source?.itemId, 64);
    if (!profileId || !itemId) throw new HttpError(400, 'Profil ou œuvre manquant');
    return { profileId, itemId };
}

function requireStorage(blob) {
    if (!blob.configured) {
        throw new HttpError(503, 'Stockage des chapitres non configuré : ajoute les variables R2 dans Vercel.');
    }
}

async function usage(kv, profileId) {
    const [mine, total] = await kv.mget([chapterKeys.usage(profileId), chapterKeys.usageTotal]);
    return { profileBytes: Number(mine) || 0, totalBytes: Number(total) || 0, limitBytes: storageLimit() };
}

// Limite le nombre de requêtes simultanées vers le stockage.
async function mapLimit(list, limit, fn) {
    const out = new Array(list.length);
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, list.length) }, async () => {
            while (next < list.length) {
                const i = next++;
                out[i] = await fn(list[i], i);
            }
        }),
    );
    return out;
}

export default route({
    async GET(req, res) {
        const kv = getKV();
        const blob = getBlob();
        const { profileId, itemId } = ids(req.query);
        await requireWrite(kv, req, profileId);
        const chapters = await loadChapters(kv, profileId, itemId);

        if (req.query.num === undefined) {
            return send(res, 200, {
                configured: !!blob.configured,
                chapters: chapters.map(publicChapter),
                usage: await usage(kv, profileId),
            });
        }

        requireStorage(blob);
        const num = parseNum(req.query.num);
        const index = chapters.findIndex((c) => c.num === num);
        if (index === -1) throw new HttpError(404, 'Chapitre introuvable');
        const chapter = chapters[index];
        // ?variant=fr | color | fr-color : version traduite ou colorisée si elle existe.
        const variant = VARIANTS.includes(req.query.variant) && chapter.variants?.[req.query.variant] ? req.query.variant : 'vo';
        const keys = variant === 'vo' ? chapterPageKeys(chapter) : variantPageKeys(chapter, variant);
        const pages = await Promise.all(keys.map((k) => blob.signRead(k)));
        send(res, 200, {
            chapter: publicChapter(chapter),
            variant,
            pages,
            prev: chapters[index - 1]?.num ?? null,
            next: chapters[index + 1]?.num ?? null,
        });
    },

    async POST(req, res) {
        const kv = getKV();
        const blob = getBlob();
        requireStorage(blob);
        const data = body(req);

        if (data.action === 'prepare') {
            const { profileId, itemId } = ids(data);
            await requireWrite(kv, req, profileId);
            const library = await kv.get(keys.library(profileId));
            if (!library?.items?.some((it) => it.id === itemId)) throw new HttpError(404, 'Œuvre introuvable');

            const num = parseNum(data.num);
            if (num === null) throw new HttpError(400, 'Numéro de chapitre invalide');
            const pages = Array.isArray(data.pages) ? data.pages : [];
            if (!pages.length) throw new HttpError(400, 'Aucune page à envoyer');
            if (pages.length > MAX_PAGES) throw new HttpError(400, `Un chapitre ne peut pas dépasser ${MAX_PAGES} pages`);
            const exts = pages.map((p) => TYPES[p?.type]);
            if (exts.some((e) => !e)) throw new HttpError(400, 'Format d’image non pris en charge');
            const declared = pages.reduce((n, p) => n + (Number(p?.size) || 0), 0);
            if (pages.some((p) => !(Number(p?.size) > 0) || Number(p.size) > MAX_PAGE_BYTES)) {
                throw new HttpError(400, 'Une page est vide ou trop lourde (30 Mo maximum)');
            }
            const { totalBytes, limitBytes } = await usage(kv, profileId);
            if (totalBytes + declared > limitBytes) {
                throw new HttpError(507, 'Le stockage est plein. Supprime des chapitres déjà lus pour faire de la place.');
            }

            const prefix = newPrefix(profileId, itemId, num);
            const uploadId = crypto.randomBytes(12).toString('base64url');
            const urls = await Promise.all(exts.map((ext, i) => blob.signUpload(pageKey(prefix, i, ext))));
            await kv.set(
                chapterKeys.upload(uploadId),
                { profileId, itemId, num, title: cleanString(data.title, 120), prefix, exts, createdAt: Date.now() },
                { ex: UPLOAD_SESSION_TTL },
            );
            return send(res, 200, { uploadId, urls });
        }

        if (data.action === 'commit' || data.action === 'abort') {
            const uploadId = cleanString(data.uploadId, 40);
            const pending = uploadId ? await kv.get(chapterKeys.upload(uploadId)) : null;
            if (!pending) throw new HttpError(404, 'Envoi expiré. Recommence l’import de ce chapitre.');
            await requireWrite(kv, req, pending.profileId);
            const pageKeys = pending.exts.map((ext, i) => pageKey(pending.prefix, i, ext));

            if (data.action === 'abort') {
                await blob.removeMany(pageKeys);
                await kv.del(chapterKeys.upload(uploadId));
                return send(res, 200, { ok: true });
            }

            // Vérifie que toutes les pages sont bien arrivées et mesure leur vrai poids.
            const sizes = await mapLimit(pageKeys, 8, (k) => blob.size(k));
            const missing = sizes.filter((s) => s === null).length;
            if (missing) throw new HttpError(400, `${missing} page(s) n’ont pas été reçues. Réessaie.`);
            const bytes = sizes.reduce((n, s) => n + s, 0);

            const chapters = await loadChapters(kv, pending.profileId, pending.itemId);
            const existing = chapters.find((c) => c.num === pending.num);
            if (existing) {
                // Remplacement : on supprime l'ancienne version du chapitre et ses traductions.
                await blob.removeMany(allChapterKeys(existing));
                await addUsage(kv, pending.profileId, -chapterBytes(existing));
            }
            const chapter = {
                num: pending.num,
                title: pending.title || existing?.title || '',
                prefix: pending.prefix,
                ext: compactExts(pending.exts),
                pages: pending.exts.length,
                bytes,
                addedAt: Date.now(),
                read: existing?.read ?? null,
                lastPage: 0,
                readAt: existing?.readAt || null,
            };
            const next = chapters.filter((c) => c.num !== pending.num).concat(chapter);
            await saveChapters(kv, pending.profileId, pending.itemId, next);
            await addUsage(kv, pending.profileId, bytes);
            await kv.del(chapterKeys.upload(uploadId));
            return send(res, 200, { chapter: publicChapter(chapter), replaced: !!existing });
        }

        throw new HttpError(400, 'Action inconnue');
    },

    async PATCH(req, res) {
        const kv = getKV();
        const data = body(req);
        const { profileId, itemId } = ids(data);
        await requireWrite(kv, req, profileId);
        const num = parseNum(data.num);
        const chapters = await loadChapters(kv, profileId, itemId);
        const chapter = chapters.find((c) => c.num === num);
        if (!chapter) throw new HttpError(404, 'Chapitre introuvable');

        if (data.read !== undefined) {
            chapter.read = data.read === null ? null : !!data.read;
            if (chapter.read) chapter.readAt = Date.now();
        }
        if (data.lastPage !== undefined) {
            const page = Math.floor(Number(data.lastPage));
            if (Number.isFinite(page)) chapter.lastPage = Math.max(0, Math.min(page, chapter.pages - 1));
        }
        await saveChapters(kv, profileId, itemId, chapters);
        send(res, 200, { chapter: publicChapter(chapter) });
    },

    async DELETE(req, res) {
        const kv = getKV();
        const blob = getBlob();
        const { profileId, itemId } = ids(req.query);
        await requireWrite(kv, req, profileId);
        const chapters = await loadChapters(kv, profileId, itemId);
        const all = !!req.query.all;
        const num = parseNum(req.query.num);
        const removed = all ? chapters : chapters.filter((c) => c.num === num);
        if (!removed.length) return send(res, 200, { removed: 0 });
        if (blob.configured) await blob.removeMany(removed.flatMap(allChapterKeys));
        await saveChapters(kv, profileId, itemId, all ? [] : chapters.filter((c) => c.num !== num));
        await addUsage(kv, profileId, -removed.reduce((n, c) => n + chapterBytes(c), 0));
        send(res, 200, { removed: removed.length, usage: await usage(kv, profileId) });
    },
});
