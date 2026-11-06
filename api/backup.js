// Sauvegardes des listes de tous les profils, rangées dans R2 (dossier backups/), à part de la base de données.
// GET  /api/backup                         → appelé chaque lundi par Vercel (vercel.json, « crons ») :
//                                            sauvegarde si la dernière automatique a plus de 6 jours
// GET  /api/backup?list=1                  → liste des sauvegardes (administrateur)
// GET  /api/backup?show=<clé>              → contenu résumé d'une sauvegarde, profil par profil (administrateur)
// GET  /api/backup?download=<clé>          → lien de téléchargement du fichier (administrateur)
// POST /api/backup { action: 'create' }    → sauvegarde tout de suite (administrateur)
// POST /api/backup { action: 'restore', key, profileIds } → remet les listes choisies dans l'état de la
//                                            sauvegarde, après avoir sauvegardé l'état actuel (administrateur)
import { getKV } from './_lib/kv.js';
import { route, send, body, cleanString, HttpError } from './_lib/http.js';
import { keys, listProfiles, emptyLibrary, sanitizeItem, sanitizeTotals } from './_lib/store.js';
import { requireAdmin } from './_lib/auth.js';
import { getBlob } from './_lib/blob.js';

const PREFIX = 'backups/';
const KEEP = 10;
const AUTO_INTERVAL = 6 * 24 * 3600 * 1000;
const REASONS = { auto: 'auto', manual: 'manuelle', before: 'avant-restauration' };

// backups/2026-11-09T030000Z_auto_3p_245t.json : date, raison, profils, titres (pour lister sans tout lire).
function parseKey(key, size) {
    const m = /^backups\/(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})Z_([a-z-]+)_(\d+)p_(\d+)t\.json$/.exec(key);
    if (!m) return null;
    const reason = Object.keys(REASONS).find((r) => REASONS[r] === m[5]) || 'manual';
    return { key, size, createdAt: Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`), reason, profiles: Number(m[6]), items: Number(m[7]) };
}

function storage() {
    const blob = getBlob();
    if (!blob.configured || !blob.putJson) throw new HttpError(503, 'Stockage indisponible : les sauvegardes ont besoin de R2.');
    return blob;
}

async function listBackups(blob) {
    const files = await blob.list(PREFIX);
    return files
        .map((f) => parseKey(f.key, f.size))
        .filter(Boolean)
        .sort((a, b) => b.createdAt - a.createdAt);
}

export async function createBackup(kv, blob, reason) {
    const profiles = await listProfiles(kv);
    const libraries = profiles.length ? await kv.mget(profiles.map((p) => keys.library(p.id))) : [];
    const sites = await kv.get('v2:sites');
    const now = new Date();
    const data = {
        app: 'liste',
        format: 1,
        createdAt: now.getTime(),
        reason,
        profiles: profiles.map((p, i) => ({
            id: p.id,
            name: p.name,
            isAdmin: !!p.isAdmin,
            createdAt: p.createdAt || null,
            library: libraries[i] || emptyLibrary(),
        })),
        sites: sites || null,
    };
    const items = data.profiles.reduce((n, p) => n + (p.library.items?.length || 0), 0);
    const stamp = now.toISOString().replace(/[:]/g, '').replace(/\.\d+Z$/, 'Z');
    const key = `${PREFIX}${stamp}_${REASONS[reason]}_${data.profiles.length}p_${items}t.json`;
    await blob.putJson(key, data);

    // On garde les plus récentes.
    const all = await listBackups(blob);
    const old = all.slice(KEEP).map((b) => b.key);
    if (old.length) await blob.removeMany(old);
    return parseKey(key, JSON.stringify(data).length);
}

function checkKey(value) {
    const key = cleanString(value, 200);
    if (!parseKey(key, 0)) throw new HttpError(400, 'Sauvegarde inconnue');
    return key;
}

// Appel de la tâche planifiée de Vercel. Si CRON_SECRET est défini, il est exigé.
function isCron(req) {
    const secret = process.env.CRON_SECRET;
    if (secret) return req.headers?.authorization === `Bearer ${secret}`;
    return /vercel-cron/i.test(req.headers?.['user-agent'] || '');
}

export default route({
    async GET(req, res) {
        const kv = getKV();
        const q = req.query || {};

        if (!q.list && !q.show && !q.download) {
            if (!isCron(req)) throw new HttpError(403, 'Réservé à la tâche planifiée');
            const blob = storage();
            const last = (await listBackups(blob)).find((b) => b.reason === 'auto');
            if (last && Date.now() - last.createdAt < AUTO_INTERVAL) return send(res, 200, { skipped: true, last });
            return send(res, 200, { created: await createBackup(kv, blob, 'auto') });
        }

        await requireAdmin(kv, req);
        const blob = storage();
        if (q.list) return send(res, 200, { backups: await listBackups(blob), keep: KEEP });

        const key = checkKey(q.show || q.download);
        if (q.download) return send(res, 200, { url: await blob.signRead(key) });

        const data = await blob.getJson(key);
        if (!data) throw new HttpError(404, 'Sauvegarde introuvable');
        const current = await listProfiles(kv);
        send(res, 200, {
            createdAt: data.createdAt,
            reason: data.reason,
            profiles: data.profiles.map((p) => {
                const now = current.find((c) => c.id === p.id);
                return { id: p.id, name: p.name, items: p.library?.items?.length || 0, exists: !!now, currentName: now?.name || null, currentItems: now?.itemCount ?? null };
            }),
        });
    },

    async POST(req, res) {
        const kv = getKV();
        await requireAdmin(kv, req);
        const blob = storage();
        const { action, key: rawKey, profileIds } = body(req);

        if (action === 'create') return send(res, 200, { created: await createBackup(kv, blob, 'manual') });
        if (action !== 'restore') throw new HttpError(400, 'Action inconnue');

        const key = checkKey(rawKey);
        if (!Array.isArray(profileIds) || !profileIds.length) throw new HttpError(400, 'Choisis au moins un profil');
        const data = await blob.getJson(key);
        if (!data) throw new HttpError(404, 'Sauvegarde introuvable');

        // Filet de sécurité : l'état actuel est sauvegardé avant d'être remplacé.
        const safety = await createBackup(kv, blob, 'before');

        let restored = 0;
        for (const id of profileIds.map((v) => cleanString(v, 80))) {
            const saved = data.profiles.find((p) => p.id === id);
            const profile = saved && (await kv.get(keys.profile(id)));
            if (!profile) continue;
            const current = (await kv.get(keys.library(id))) || emptyLibrary();
            const seen = new Set();
            const items = (saved.library?.items || []).map(sanitizeItem).filter((it) => it && !seen.has(it.id) && seen.add(it.id));
            await kv.set(keys.library(id), {
                version: current.version + 1,
                updatedAt: Date.now(),
                items,
                lastKnownTotals: sanitizeTotals(saved.library?.lastKnownTotals),
            });
            await kv.set(keys.profile(id), { ...profile, itemCount: items.length });
            restored++;
        }
        send(res, 200, { restored, safety });
    },
});
