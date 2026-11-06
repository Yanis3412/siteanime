// GET  /api/profiles        → liste publique des profils (jamais de code PIN)
// POST /api/profiles        → crée un profil { name, pin } et renvoie une session
import crypto from 'node:crypto';
import { getKV } from './_lib/kv.js';
import { route, send, body, cleanString, HttpError } from './_lib/http.js';
import { keys, listProfiles, publicProfile, emptyLibrary, ensureMigrated } from './_lib/store.js';
import { hashPin, verifyPin, isValidNewPin, createSession } from './_lib/auth.js';

export default route({
    async GET(req, res) {
        const kv = getKV();
        await ensureMigrated(kv, hashPin, verifyPin);
        const profiles = await listProfiles(kv);
        send(res, 200, { profiles: profiles.map(publicProfile) });
    },

    async POST(req, res) {
        const kv = getKV();
        await ensureMigrated(kv, hashPin, verifyPin);
        const { name, pin } = body(req);
        const cleanName = cleanString(name, 40);
        if (!cleanName) throw new HttpError(400, 'Le nom du profil est obligatoire');
        if (!isValidNewPin(pin)) throw new HttpError(400, 'Le code doit faire entre 4 et 6 chiffres');

        const existing = await listProfiles(kv);
        if (existing.some((p) => p.name.toLowerCase() === cleanName.toLowerCase())) {
            throw new HttpError(409, 'Un profil porte déjà ce nom');
        }
        if (existing.length >= 50) throw new HttpError(400, 'Nombre maximum de profils atteint');

        const id = `profile_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        const profile = {
            id,
            name: cleanName,
            // Le tout premier profil d'une installation vide devient administrateur.
            isAdmin: existing.length === 0,
            pinHash: hashPin(pin),
            pinVersion: 1,
            itemCount: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        await kv.set(keys.profile(id), profile);
        await kv.set(keys.library(id), emptyLibrary());
        await kv.sadd(keys.profileIds, id);
        const token = await createSession(kv, profile);
        send(res, 201, { profile: publicProfile(profile), token });
    },
});
