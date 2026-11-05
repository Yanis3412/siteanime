// GET /api/library?id=…           → bibliothèque d'un profil (lecture publique, mode spectateur)
// GET /api/library?recommended=1  → œuvres recommandées par chaque profil
// PUT /api/library?id=…           → enregistre la bibliothèque { items, lastKnownTotals, baseVersion }
import { getKV } from './_lib/kv.js';
import { route, send, body, cleanString, HttpError } from './_lib/http.js';
import { keys, listProfiles, emptyLibrary, sanitizeItem, sanitizeTotals, MAX_ITEMS } from './_lib/store.js';
import { requireWrite } from './_lib/auth.js';

export default route({
    async GET(req, res) {
        const kv = getKV();

        if (req.query?.recommended) {
            const profiles = await listProfiles(kv);
            const libraries = await kv.mget(profiles.map((p) => keys.library(p.id)));
            const result = profiles.map((p, i) => ({
                id: p.id,
                name: p.name,
                items: (libraries[i]?.items || [])
                    .filter((it) => it.recommended)
                    .map(({ title, type, malId, imageUrl, total, status }) => ({ title, type, malId, imageUrl, total, status })),
            }));
            return send(res, 200, { profiles: result });
        }

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
        if (profile.itemCount !== clean.length) {
            await kv.set(keys.profile(id), { ...profile, itemCount: clean.length });
        }
        send(res, 200, { version: next.version, updatedAt: next.updatedAt });
    },
});
