// File de traduction et de colorisation des chapitres.
// Les demandes viennent des profils ; le traducteur installé sur le PC de l'administrateur
// les traite une par une (il se connecte avec la session de l'administrateur).
//
// Profils (connectés à leur profil) :
//   GET  /api/jobs?profileId&itemId                       → demandes en cours pour ce manga + état du traducteur
//   POST /api/jobs { action: 'request', profileId, itemId, nums: [..], kind }
//   POST /api/jobs { action: 'cancel', jobId }
// Traducteur (session administrateur) :
//   POST /api/jobs { action: 'claim', worker }             → prochaine demande avec les liens des pages
//   POST /api/jobs { action: 'progress', jobId, done }
//   POST /api/jobs { action: 'complete', jobId }
//   POST /api/jobs { action: 'fail', jobId, error }
//   POST /api/jobs { action: 'release', jobId }            → remet la demande en attente (traducteur arrêté)
import crypto from 'node:crypto';
import { getKV } from './_lib/kv.js';
import { getBlob, storageLimit } from './_lib/blob.js';
import { route, send, body, cleanString, HttpError } from './_lib/http.js';
import { keys } from './_lib/store.js';
import { requireWrite, requireAdmin } from './_lib/auth.js';
import {
    chapterKeys,
    VARIANTS,
    parseNum,
    pageKey,
    chapterPageKeys,
    variantPageKeys,
    loadChapters,
    saveChapters,
    addUsage,
} from './_lib/chapters.js';

const jobKeys = {
    ids: 'v2:job-ids',
    job: (id) => `v2:job:${id}`,
    lock: (id) => `v2:job-lock:${id}`,
    worker: 'v2:worker',
};

const LEASE_MS = 20 * 60 * 1000; // sans nouvelles du traducteur pendant 20 min, la demande repart en attente
const ONLINE_MS = 2 * 60 * 1000;
const ERROR_TTL = 60 * 60 * 24 * 7;
const MAX_QUEUE = 300;
const UPLOAD_TTL = 60 * 60 * 6;

export const KIND_LABELS = { fr: 'traduction', color: 'colorisation', 'fr-color': 'traduction et colorisation' };

function publicJob(j) {
    return {
        id: j.id,
        num: j.num,
        kind: j.kind,
        status: j.status,
        done: j.done || 0,
        total: j.total || 0,
        error: j.error || null,
        createdAt: j.createdAt,
    };
}

async function allJobs(kv) {
    const ids = await kv.smembers(jobKeys.ids);
    if (!ids.length) return [];
    const records = await kv.mget(ids.map(jobKeys.job));
    const stale = ids.filter((_, i) => !records[i]);
    if (stale.length) await kv.srem(jobKeys.ids, ...stale);
    return records.filter(Boolean);
}

async function workerState(kv) {
    const w = await kv.get(jobKeys.worker);
    return { online: !!w && Date.now() - w.lastSeen < ONLINE_MS, lastSeen: w?.lastSeen || null };
}

async function loadJob(kv, id) {
    const jobId = cleanString(id, 40);
    const job = jobId ? await kv.get(jobKeys.job(jobId)) : null;
    if (!job) throw new HttpError(404, 'Demande introuvable');
    return job;
}

async function saveJob(kv, job, opts) {
    await kv.set(jobKeys.job(job.id), job, opts);
}

async function deleteJob(kv, job) {
    await kv.del(jobKeys.job(job.id), jobKeys.lock(job.id));
    await kv.srem(jobKeys.ids, job.id);
}

function outputKeys(job) {
    return Array.from({ length: job.total || 0 }, (_, i) => pageKey(job.outPrefix, i, 'webp'));
}

export default route({
    async GET(req, res) {
        const kv = getKV();
        const profileId = cleanString(req.query?.profileId, 80);
        const itemId = cleanString(req.query?.itemId, 64);
        if (!profileId || !itemId) throw new HttpError(400, 'Profil ou œuvre manquant');
        await requireWrite(kv, req, profileId);
        const jobs = (await allJobs(kv)).filter((j) => j.profileId === profileId && j.itemId === itemId);
        send(res, 200, { jobs: jobs.map(publicJob), worker: await workerState(kv) });
    },

    async POST(req, res) {
        const kv = getKV();
        const data = body(req);

        // ----- Demandes des profils -----

        if (data.action === 'request') {
            const profileId = cleanString(data.profileId, 80);
            const itemId = cleanString(data.itemId, 64);
            if (!profileId || !itemId) throw new HttpError(400, 'Profil ou œuvre manquant');
            await requireWrite(kv, req, profileId);
            if (!VARIANTS.includes(data.kind)) throw new HttpError(400, 'Type de demande inconnu');
            if (!getBlob().configured) throw new HttpError(503, 'Stockage des chapitres non configuré');

            const library = await kv.get(keys.library(profileId));
            const item = library?.items?.find((it) => it.id === itemId);
            if (!item) throw new HttpError(404, 'Œuvre introuvable');
            const chapters = await loadChapters(kv, profileId, itemId);
            const nums = (Array.isArray(data.nums) ? data.nums : []).map(parseNum).filter((n) => n !== null);
            const wanted = chapters.filter((c) => nums.includes(c.num));
            if (!wanted.length) throw new HttpError(400, 'Aucun chapitre à traiter');

            const jobs = await allJobs(kv);
            if (jobs.length + wanted.length > MAX_QUEUE) throw new HttpError(429, 'La file d’attente est pleine. Réessaie plus tard.');
            const created = [];
            for (const c of wanted) {
                const existing = jobs.find((j) => j.profileId === profileId && j.itemId === itemId && j.num === c.num && j.kind === data.kind);
                if (existing && existing.status !== 'error') continue;
                if (existing) await deleteJob(kv, existing);
                const job = {
                    id: crypto.randomBytes(9).toString('base64url'),
                    profileId,
                    itemId,
                    itemTitle: item.title,
                    num: c.num,
                    kind: data.kind,
                    status: 'queued',
                    createdAt: Date.now() + created.length, // garde l'ordre des chapitres
                };
                await saveJob(kv, job);
                await kv.sadd(jobKeys.ids, job.id);
                created.push(job);
            }
            return send(res, 200, { jobs: created.map(publicJob), worker: await workerState(kv) });
        }

        if (data.action === 'cancel') {
            const job = await loadJob(kv, data.jobId);
            await requireWrite(kv, req, job.profileId);
            if (job.status === 'running') throw new HttpError(409, 'Le traducteur travaille déjà sur ce chapitre.');
            await deleteJob(kv, job);
            return send(res, 200, { ok: true });
        }

        // ----- Traducteur -----

        await requireAdmin(kv, req);
        const blob = getBlob();
        if (!blob.configured) throw new HttpError(503, 'Stockage des chapitres non configuré');

        if (data.action === 'claim') {
            await kv.set(jobKeys.worker, { lastSeen: Date.now(), name: cleanString(data.worker, 60) });
            const now = Date.now();
            const candidates = (await allJobs(kv))
                .filter((j) => j.status === 'queued' || (j.status === 'running' && (j.leaseUntil || 0) < now))
                .sort((a, b) => a.createdAt - b.createdAt);

            for (const job of candidates) {
                if (!(await kv.set(jobKeys.lock(job.id), now, { nx: true, ex: 30 }))) continue;
                const chapters = await loadChapters(kv, job.profileId, job.itemId);
                const chapter = chapters.find((c) => c.num === job.num);
                if (!chapter) {
                    await deleteJob(kv, job); // chapitre supprimé entre-temps
                    continue;
                }
                const [total] = await kv.mget([chapterKeys.usageTotal]);
                if ((Number(total) || 0) + (chapter.bytes || 0) * 1.5 > storageLimit()) {
                    Object.assign(job, { status: 'error', error: 'Stockage plein : supprime des chapitres pour faire de la place.' });
                    await saveJob(kv, job, { ex: ERROR_TTL });
                    await kv.del(jobKeys.lock(job.id));
                    continue;
                }
                // Si une demande précédente a été interrompue, ses pages partielles sont effacées.
                if (job.outPrefix) await blob.removeMany(outputKeys(job));
                Object.assign(job, {
                    status: 'running',
                    startedAt: now,
                    leaseUntil: now + LEASE_MS,
                    done: 0,
                    total: chapter.pages,
                    error: null,
                    sourcePrefix: chapter.prefix,
                    outPrefix: `${chapter.prefix}-${job.kind}-${crypto.randomBytes(3).toString('hex')}`,
                });
                await saveJob(kv, job);
                await kv.del(jobKeys.lock(job.id));
                const [pages, uploads] = await Promise.all([
                    Promise.all(chapterPageKeys(chapter).map((k) => blob.signRead(k))),
                    Promise.all(outputKeys(job).map((k) => blob.signUpload(k, UPLOAD_TTL))),
                ]);
                return send(res, 200, {
                    job: { id: job.id, kind: job.kind, num: job.num, itemTitle: job.itemTitle, pages, uploads },
                });
            }
            return send(res, 200, { job: null });
        }

        const job = await loadJob(kv, data.jobId);

        if (data.action === 'progress') {
            await kv.set(jobKeys.worker, { lastSeen: Date.now(), name: cleanString(data.worker, 60) });
            const done = Math.floor(Number(data.done));
            if (Number.isFinite(done)) job.done = Math.max(0, Math.min(done, job.total || 0));
            job.leaseUntil = Date.now() + LEASE_MS;
            await saveJob(kv, job);
            return send(res, 200, { ok: true });
        }

        if (data.action === 'release') {
            if (job.outPrefix) await blob.removeMany(outputKeys(job));
            Object.assign(job, { status: 'queued', done: 0, leaseUntil: 0, outPrefix: null });
            await saveJob(kv, job);
            return send(res, 200, { ok: true });
        }

        if (data.action === 'fail') {
            if (job.outPrefix) await blob.removeMany(outputKeys(job));
            Object.assign(job, { status: 'error', error: cleanString(data.error, 300) || 'Échec du traitement', outPrefix: null });
            await saveJob(kv, job, { ex: ERROR_TTL });
            return send(res, 200, { ok: true });
        }

        if (data.action === 'complete') {
            if (job.status !== 'running' || !job.outPrefix) throw new HttpError(409, 'Cette demande n’est plus en cours');
            const out = outputKeys(job);
            const sizes = [];
            for (let i = 0; i < out.length; i += 8) {
                sizes.push(...(await Promise.all(out.slice(i, i + 8).map((k) => blob.size(k)))));
            }
            const missing = sizes.filter((s) => s === null).length;
            if (missing) throw new HttpError(400, `${missing} page(s) traduite(s) n’ont pas été reçues`);
            const bytes = sizes.reduce((n, s) => n + s, 0);

            const chapters = await loadChapters(kv, job.profileId, job.itemId);
            const chapter = chapters.find((c) => c.num === job.num);
            if (!chapter || chapter.prefix !== job.sourcePrefix) {
                // Chapitre supprimé ou remplacé pendant le traitement : le résultat ne sert plus.
                await blob.removeMany(out);
                await deleteJob(kv, job);
                return send(res, 200, { ok: true, discarded: true });
            }
            const previous = chapter.variants?.[job.kind];
            if (previous) {
                await blob.removeMany(variantPageKeys(chapter, job.kind));
                await addUsage(kv, job.profileId, -(previous.bytes || 0));
            }
            chapter.variants = {
                ...(chapter.variants || {}),
                [job.kind]: { prefix: job.outPrefix, ext: 'webp', pages: job.total, bytes, at: Date.now() },
            };
            await saveChapters(kv, job.profileId, job.itemId, chapters);
            await addUsage(kv, job.profileId, bytes);
            await deleteJob(kv, job);
            return send(res, 200, { ok: true });
        }

        throw new HttpError(400, 'Action inconnue');
    },
});
