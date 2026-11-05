// PATCH  /api/profile?id=…  → renommer { name } et/ou changer le code { pin }
// DELETE /api/profile?id=…  → supprimer le profil et sa bibliothèque
import { getKV } from './_lib/kv.js';
import { route, send, body, cleanString, HttpError } from './_lib/http.js';
import { keys, listProfiles, publicProfile } from './_lib/store.js';
import { hashPin, isValidNewPin, requireWrite, createSession } from './_lib/auth.js';

async function loadProfile(kv, req) {
    const id = cleanString(req.query?.id, 80);
    const profile = id ? await kv.get(keys.profile(id)) : null;
    if (!profile) throw new HttpError(404, 'Profil introuvable');
    return profile;
}

export default route({
    async PATCH(req, res) {
        const kv = getKV();
        const profile = await loadProfile(kv, req);
        const session = await requireWrite(kv, req, profile.id);
        const { name, pin } = body(req);
        let token = null;

        if (name !== undefined) {
            const cleanName = cleanString(name, 40);
            if (!cleanName) throw new HttpError(400, 'Le nom ne peut pas être vide');
            const others = await listProfiles(kv);
            if (others.some((p) => p.id !== profile.id && p.name.toLowerCase() === cleanName.toLowerCase())) {
                throw new HttpError(409, 'Un profil porte déjà ce nom');
            }
            profile.name = cleanName;
        }

        if (pin !== undefined) {
            if (!isValidNewPin(pin)) throw new HttpError(400, 'Le code doit faire entre 4 et 6 chiffres');
            profile.pinHash = hashPin(pin);
            // Déconnecte les autres appareils de ce profil.
            profile.pinVersion = (profile.pinVersion || 1) + 1;
        }

        profile.updatedAt = Date.now();
        await kv.set(keys.profile(profile.id), profile);

        // Si on vient de changer son propre code, on renvoie une nouvelle session.
        if (pin !== undefined && session.profileId === profile.id) {
            token = await createSession(kv, profile);
        }
        send(res, 200, { profile: publicProfile(profile), token });
    },

    async DELETE(req, res) {
        const kv = getKV();
        const profile = await loadProfile(kv, req);
        await requireWrite(kv, req, profile.id);
        if (profile.isAdmin) throw new HttpError(400, 'Le profil administrateur ne peut pas être supprimé');
        await kv.del(keys.profile(profile.id), keys.library(profile.id), keys.fails(profile.id));
        await kv.srem(keys.profileIds, profile.id);
        send(res, 200, { ok: true });
    },
});
