// POST /api/admin { action: 'reimport' } → réimporte les données de l'ancienne version
// (clé "anime-profiles") en les fusionnant avec les données actuelles. Réservé à l'administrateur.
// Utile une seule fois, au moment de la mise en ligne, pour récupérer les derniers changements.
import { getKV } from './_lib/kv.js';
import { route, send, body, HttpError } from './_lib/http.js';
import { migrateFromLegacy, readLegacyProfiles } from './_lib/store.js';
import { hashPin, verifyPin, requireAdmin } from './_lib/auth.js';

export default route({
    async GET(req, res) {
        const kv = getKV();
        await requireAdmin(kv, req);
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
        if (action !== 'reimport') throw new HttpError(400, 'Action inconnue');
        const legacy = await readLegacyProfiles(kv);
        if (!legacy.length) throw new HttpError(400, 'Aucune donnée de l’ancienne version à importer');
        const summary = await migrateFromLegacy(kv, { hashPin, verifyPin });
        send(res, 200, summary);
    },
});
