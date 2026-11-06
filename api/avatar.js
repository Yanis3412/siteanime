// GET    /api/avatar?id=…&v=…  → photo du profil. L'adresse change à chaque nouvelle photo (v),
//                                 l'image peut donc être gardée en cache très longtemps.
// PUT    /api/avatar?id=…      → { image: 'data:image/webp;base64,…' } remplace la photo
// DELETE /api/avatar?id=…      → retire la photo (retour aux initiales)
// Les photos sont réduites à 256 × 256 dans le navigateur avant l'envoi : quelques dizaines de Ko.
import { getKV } from './_lib/kv.js';
import { route, send, body, cleanString, HttpError } from './_lib/http.js';
import { keys, publicProfile } from './_lib/store.js';
import { requireWrite } from './_lib/auth.js';

const MAX_BYTES = 200 * 1024;
const DATA_URL = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/;

// Vérifie le contenu réel du fichier, pas seulement ce qu'annonce le navigateur.
function sniff(buf) {
    if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
    return null;
}

async function loadProfile(kv, req) {
    const id = cleanString(req.query?.id, 80);
    const profile = id ? await kv.get(keys.profile(id)) : null;
    if (!profile) throw new HttpError(404, 'Profil introuvable');
    return profile;
}

export default route({
    async GET(req, res) {
        const kv = getKV();
        const id = cleanString(req.query?.id, 80);
        const record = id ? await kv.get(keys.avatar(id)) : null;
        if (!record?.data) throw new HttpError(404, 'Pas de photo');
        const buf = Buffer.from(record.data, 'base64');
        res.statusCode = 200;
        res.setHeader('Content-Type', record.type);
        res.setHeader('Content-Length', buf.length);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader(
            'Cache-Control',
            req.query?.v ? 'public, max-age=31536000, s-maxage=31536000, immutable' : 'no-cache',
        );
        res.end(buf);
    },

    async PUT(req, res) {
        const kv = getKV();
        const profile = await loadProfile(kv, req);
        await requireWrite(kv, req, profile.id);
        const match = DATA_URL.exec(String(body(req).image || ''));
        if (!match) throw new HttpError(400, 'Image invalide : utilise une photo JPG, PNG ou WebP.');
        const buf = Buffer.from(match[2], 'base64');
        if (buf.length > MAX_BYTES) throw new HttpError(413, 'Photo trop lourde.');
        const type = sniff(buf);
        if (!type || type !== match[1]) throw new HttpError(400, 'Image invalide : utilise une photo JPG, PNG ou WebP.');

        await kv.set(keys.avatar(profile.id), { type, data: match[2] });
        profile.avatarVersion = Date.now();
        profile.updatedAt = Date.now();
        await kv.set(keys.profile(profile.id), profile);
        send(res, 200, { profile: publicProfile(profile) });
    },

    async DELETE(req, res) {
        const kv = getKV();
        const profile = await loadProfile(kv, req);
        await requireWrite(kv, req, profile.id);
        await kv.del(keys.avatar(profile.id));
        delete profile.avatarVersion;
        profile.updatedAt = Date.now();
        await kv.set(keys.profile(profile.id), profile);
        send(res, 200, { profile: publicProfile(profile) });
    },
});
