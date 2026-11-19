// GET /api/library?id=…           → bibliothèque d'un profil (lecture publique, mode spectateur)
// GET /api/library?recommended=1  → œuvres recommandées par chaque profil, avec la raison et les pouces
// GET /api/library?disliked=1     → titres « Meh » de chaque profil, avec la raison et les pouces
// PUT /api/library?id=…           → enregistre la bibliothèque { items, lastKnownTotals, baseVersion }
// POST /api/library?vote=1        → pouce sur l'avis d'un autre profil { owner, itemId, kind, value }
import { getKV } from './_lib/kv.js';
import { route, send, body, cleanString, HttpError } from './_lib/http.js';
import { keys, listProfiles, emptyLibrary, sanitizeItem, sanitizeTotals, MAX_ITEMS } from './_lib/store.js';
import { requireWrite, getSession } from './_lib/auth.js';
import { recordLibraryChanges } from './_lib/activity.js';
import { listOpinions, castVote, KINDS } from './_lib/opinions.js';

export default route({
    async GET(req, res) {
        const kv = getKV();

        if (req.query?.recommended) return send(res, 200, { profiles: await listOpinions(kv, 'reco') });
        if (req.query?.disliked) return send(res, 200, { profiles: await listOpinions(kv, 'meh') });

        const id = cleanString(req.query?.id, 80);
        const profile = id ? await kv.get(keys.profile(id)) : null;
        if (!profile) throw new HttpError(404, 'Profil introuvable');
        const library = (await kv.get(keys.library(id))) || emptyLibrary();
        send(res, 200, library);
    },

    async PUT(req, res) {
        const kv = getKV();
        const id = cleanString(req.query?.id, 80);
        const profile = id ? await kv.get(keys.profile(id)) : null;
        if (!profile) throw new HttpError(404, 'Profil introuvable');
        await requireWrite(kv, req, id);

        const { items, lastKnownTotals, baseVersion } = body(req);
        if (!Array.isArray(items)) throw new HttpError(400, 'Liste invalide');
        if (items.length > MAX_ITEMS) throw new HttpError(400, 'Trop d’éléments');

        const current = (await kv.get(keys.library(id))) || emptyLibrary();
        // Protection contre l'écrasement : si un autre appareil a enregistré entre-temps,
        // on renvoie la version à jour au lieu d'écraser.
        if (Number(baseVersion) !== current.version) {
            throw new HttpError(409, 'Ta liste a été modifiée ailleurs', { library: current });
        }

        const seen = new Set();
        const clean = items
            .map(sanitizeItem)
            .filter((it) => it && !seen.has(it.id) && seen.add(it.id));
        const next = {
            version: current.version + 1,
            updatedAt: Date.now(),
            items: clean,
            lastKnownTotals: sanitizeTotals(lastKnownTotals ?? current.lastKnownTotals),
        };
        await kv.set(keys.library(id), next);
        await recordLibraryChanges(kv, id, current.items, clean);
        if (profile.itemCount !== clean.length) {
            await kv.set(keys.profile(id), { ...profile, itemCount: clean.length });
        }
        send(res, 200, { version: next.version, updatedAt: next.updatedAt });
    },

    async POST(req, res) {
        const kv = getKV();
        if (!req.query?.vote) throw new HttpError(400, 'Action inconnue');
        const session = await getSession(kv, req);
        if (!session) throw new HttpError(401, 'Connexion requise');
        const { owner: rawOwner, itemId: rawItem, kind, value } = body(req);
        const owner = cleanString(rawOwner, 80);
        const itemId = cleanString(rawItem, 80);
        if (!Object.hasOwn(KINDS, kind) || ![1, -1, 0].includes(value)) throw new HttpError(400, 'Vote invalide');
        if (owner === session.profileId) throw new HttpError(400, 'Tu ne peux pas voter pour ton propre avis');
        const votes = await castVote(kv, { owner, itemId, kind, voter: session.profileId, value });
        if (!votes) throw new HttpError(404, 'Cet avis n’existe plus');
        send(res, 200, { votes });
    },
});
