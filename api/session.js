// POST   /api/session  → connexion { profileId, pin } : renvoie un jeton de session
// GET    /api/session  → vérifie le jeton envoyé (en-tête Authorization)
// DELETE /api/session  → déconnexion
import { getKV } from './_lib/kv.js';
import { route, send, body, cleanString, HttpError } from './_lib/http.js';
import { keys, publicProfile } from './_lib/store.js';
import {
    verifyPin,
    createSession,
    getSession,
    destroySession,
    checkLock,
    recordFail,
    clearFails,
} from './_lib/auth.js';

export default route({
    async POST(req, res) {
        const kv = getKV();
        const { profileId, pin } = body(req);
        const id = cleanString(profileId, 80);
        const profile = id ? await kv.get(keys.profile(id)) : null;
        if (!profile) throw new HttpError(404, 'Profil introuvable');

        await checkLock(kv, profile.id);
        if (!verifyPin(pin, profile.pinHash)) {
            const left = await recordFail(kv, profile.id);
            throw new HttpError(401, left > 0 ? 'Code incorrect' : 'Trop d’essais. Réessaie dans 15 minutes.');
        }
        await clearFails(kv, profile.id);
        const token = await createSession(kv, profile);
        send(res, 200, { token, profile: publicProfile(profile) });
    },

    async GET(req, res) {
        const kv = getKV();
        const session = await getSession(kv, req);
        if (!session) return send(res, 200, { valid: false });
        send(res, 200, { valid: true, profileId: session.profileId, isAdmin: session.isAdmin });
    },

    async DELETE(req, res) {
        const kv = getKV();
        await destroySession(kv, req);
        send(res, 200, { ok: true });
    },
});
