// GET /api/activity                → fil d'activité de tous les profils, le plus récent d'abord
//     ?before=<horodatage>         → page suivante
// GET /api/activity?stats=1        → chiffres de chaque profil (épisodes vus, chapitres lus, séries finies…)
// Lecture libre, comme les listes en mode spectateur.
import { getKV } from './_lib/kv.js';
import { route, send } from './_lib/http.js';
import { keys, listProfiles } from './_lib/store.js';
import { activityKey, statsOf } from './_lib/activity.js';

const PAGE = 60;

export default route({
    async GET(req, res) {
        const kv = getKV();
        const profiles = await listProfiles(kv);
        const who = (p) => ({ id: p.id, name: p.name, avatar: p.avatarVersion || null });

        if (req.query?.stats) {
            const libraries = profiles.length ? await kv.mget(profiles.map((p) => keys.library(p.id))) : [];
            return send(res, 200, { profiles: profiles.map((p, i) => ({ ...who(p), ...statsOf(libraries[i]?.items || []) })) });
        }

        const before = Number(req.query?.before) || Infinity;
        const logs = profiles.length ? await kv.mget(profiles.map((p) => activityKey(p.id))) : [];
        const entries = profiles
            .flatMap((p, i) => (logs[i] || []).map((e) => ({ ...e, profile: who(p) })))
            .filter((e) => e.at < before)
            .sort((a, b) => b.at - a.at);
        send(res, 200, { entries: entries.slice(0, PAGE), more: entries.length > PAGE });
    },
});
