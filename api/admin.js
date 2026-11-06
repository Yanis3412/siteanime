// Réservé à l'administrateur.
// GET  /api/admin                       → état de l'ancienne version (pour la réimportation)
// GET  /api/admin?cleanup=1             → aperçu du nettoyage : chapitres importés il y a plus de 2 mois
// POST /api/admin { action: 'reimport' } → réimporte les données de l'ancienne version (clé "anime-profiles")
//                                         en les fusionnant avec les données actuelles
// POST /api/admin { action: 'cleanup' }  → supprime, pour tous les profils, les chapitres importés il y a
//                                         plus de 2 mois (pages, versions couleur). Travaille par tranches :
//                                         renvoie done: false tant qu'il en reste.
import { getKV } from './_lib/kv.js';
import { route, send, body, HttpError } from './_lib/http.js';
import { listProfiles, migrateFromLegacy, readLegacyProfiles } from './_lib/store.js';
import { hashPin, verifyPin, requireAdmin } from './_lib/auth.js';
import { getBlob } from './_lib/blob.js';
import { allChapterKeys, chapterBytes, chapterKeys, loadChapters, saveChapters } from './_lib/chapters.js';

export const CLEANUP_MONTHS = 2;
const TIME_BUDGET_MS = 7000;

export function cleanupCutoff(now = new Date()) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - CLEANUP_MONTHS);
    return d.getTime();
}

// Un chapitre sans date d'import connue n'est jamais supprimé.
const isOld = (chapter, cutoff) => Number.isFinite(chapter.addedAt) && chapter.addedAt < cutoff;

async function* chapterLists(kv) {
    for (const profile of await listProfiles(kv)) {
        const itemIds = await kv.smembers(chapterKeys.items(profile.id));
        for (const itemId of itemIds) {
            yield { profile, itemId, chapters: await loadChapters(kv, profile.id, itemId) };
        }
    }
}

async function cleanupPreview(kv) {
    const cutoff = cleanupCutoff();
    const perProfile = new Map();
    let chapters = 0;
    let bytes = 0;
    for await (const { profile, chapters: list } of chapterLists(kv)) {
        const old = list.filter((c) => isOld(c, cutoff));
        if (!old.length) continue;
        chapters += old.length;
        bytes += old.reduce((n, c) => n + chapterBytes(c), 0);
        perProfile.set(profile.id, { name: profile.name, chapters: (perProfile.get(profile.id)?.chapters || 0) + old.length });
    }
    return { months: CLEANUP_MONTHS, cutoff, chapters, bytes, profiles: [...perProfile.values()] };
}

async function cleanupRun(kv, blob) {
    const cutoff = cleanupCutoff();
    const started = Date.now();
    let removed = 0;
    let freed = 0;
    for await (const { profile, itemId, chapters } of chapterLists(kv)) {
        const old = chapters.filter((c) => isOld(c, cutoff));
        if (!old.length) continue;
        if (Date.now() - started > TIME_BUDGET_MS) return { removed, freed, done: false };
        if (blob.configured) await blob.removeMany(old.flatMap(allChapterKeys));
        await saveChapters(kv, profile.id, itemId, chapters.filter((c) => !isOld(c, cutoff)));
        const bytes = old.reduce((n, c) => n + chapterBytes(c), 0);
        if (bytes) {
            await kv.incrby(chapterKeys.usage(profile.id), -bytes);
            await kv.incrby(chapterKeys.usageTotal, -bytes);
        }
        removed += old.length;
        freed += bytes;
    }
    return { removed, freed, done: true };
}

export default route({
    async GET(req, res) {
        const kv = getKV();
        await requireAdmin(kv, req);
        if (req.query?.cleanup) return send(res, 200, await cleanupPreview(kv));
        const legacy = await readLegacyProfiles(kv);
        const migrated = await kv.get('v2:migrated');
        send(res, 200, {
            legacyProfiles: legacy.length,
            legacyItems: legacy.reduce((n, p) => n + (p.library?.length || 0), 0),
            migrated,
        });
    },

    async POST(req, res) {
        const kv = getKV();
        await requireAdmin(kv, req);
        const { action } = body(req);
        if (action === 'cleanup') return send(res, 200, await cleanupRun(kv, getBlob()));
        if (action !== 'reimport') throw new HttpError(400, 'Action inconnue');
        const legacy = await readLegacyProfiles(kv);
        if (!legacy.length) throw new HttpError(400, 'Aucune donnée de l’ancienne version à importer');
        const summary = await migrateFromLegacy(kv, { hashPin, verifyPin });
        send(res, 200, summary);
    },
});
