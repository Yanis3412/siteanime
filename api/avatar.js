// Photo de profil et médias de la page de profil.
// Photo fixe (partout sur le site), réduite à 256 × 256 dans le navigateur : quelques dizaines de Ko, gardée en base.
//   GET    /api/avatar?id=…&v=…            → la photo. L'adresse change à chaque nouvelle photo (v) : cache très long.
//   PUT    /api/avatar?id=…                → { image: 'data:image/webp;base64,…' } remplace la photo (et retire le GIF)
//   DELETE /api/avatar?id=…                → retire la photo et le GIF (retour aux initiales)
// Médias de la page de profil, rangés dans R2 (jusqu'à 15 Mo) avec leur cadrage :
// « anim » = photo en GIF (animée seulement sur la page de profil), « banner » = bannière (image ou GIF).
//   GET    /api/avatar?id=…&kind=…&v=…     → redirige vers le fichier (lien signé) ; &still=1 : image fixe de la bannière GIF
//   POST   /api/avatar?id=… { action: 'prepare', kind, type, size, stillType?, stillSize? } → liens d'envoi
//   POST   /api/avatar?id=… { action: 'commit', kind, key, stillKey?, frame: { x, y, s } } → enregistre
//   DELETE /api/avatar?id=…&kind=…         → retire ce média
import { getKV } from './_lib/kv.js';
import { route, send, body, cleanString, HttpError } from './_lib/http.js';
import { keys, publicProfile } from './_lib/store.js';
import { requireWrite } from './_lib/auth.js';
import { getBlob } from './_lib/blob.js';

const MAX_BYTES = 200 * 1024;
const MEDIA_MAX = 15 * 1024 * 1024;
const DATA_URL = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/;
const MEDIA_KINDS = ['anim', 'banner'];
const EXT = { 'image/gif': 'gif', 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };
const STILL_EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg' };

// Vérifie le contenu réel du fichier, pas seulement ce qu'annonce le navigateur.
function sniff(buf) {
    if (!buf) return null;
    if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
    if (buf.length > 6 && /^GIF8[79]a$/.test(buf.toString('ascii', 0, 6))) return 'image/gif';
    return null;
}

async function loadProfile(kv, req) {
    const id = cleanString(req.query?.id, 80);
    const profile = id ? await kv.get(keys.profile(id)) : null;
    if (!profile) throw new HttpError(404, 'Profil introuvable');
    return profile;
}

function storage() {
    const blob = getBlob();
    if (!blob.configured) throw new HttpError(503, 'Stockage indisponible pour les GIF et les bannières.');
    return blob;
}

function mediaKind(value) {
    if (!MEDIA_KINDS.includes(value)) throw new HttpError(400, 'Média inconnu');
    return value;
}

const clamp = (v, min, max) => Math.round(Math.min(max, Math.max(min, Number(v) || 0)) * 10000) / 10000;

async function removeMedia(blob, media) {
    const old = [media?.key, media?.still].filter(Boolean);
    if (!old.length) return;
    try {
        await blob.removeMany(old);
    } catch {
        /* fichier déjà parti : sans conséquence */
    }
}

// Le fichier envoyé doit être à ce profil, à sa place, du bon format et pas trop lourd.
async function checkUpload(blob, key, pattern, allowed) {
    if (!pattern.test(key)) throw new HttpError(400, 'Fichier inconnu');
    const size = await blob.size(key);
    if (size === null) throw new HttpError(400, 'Le fichier n’est pas arrivé. Réessaie.');
    if (size > MEDIA_MAX) throw new HttpError(413, 'Fichier trop lourd (15 Mo au maximum).');
    const type = sniff(await blob.readStart(key, 16));
    const ext = key.split('.').pop();
    if (!type || !allowed.includes(type) || EXT[type] !== ext) throw new HttpError(400, 'Format non reconnu.');
}

export default route({
    async GET(req, res) {
        const kv = getKV();
        const id = cleanString(req.query?.id, 80);

        if (req.query?.kind) {
            const kind = mediaKind(req.query.kind);
            const profile = id ? await kv.get(keys.profile(id)) : null;
            const media = profile?.media?.[kind];
            if (!media) throw new HttpError(404, 'Pas de média');
            const url = await storage().signRead(req.query.still && media.still ? media.still : media.key);
            // Le lien signé reste valable 3 h : la redirection est gardée 40 min.
            res.statusCode = 302;
            res.setHeader('Location', url);
            res.setHeader('Cache-Control', req.query?.v ? 'public, max-age=2400, s-maxage=2400' : 'no-cache');
            return res.end();
        }

        const record = id ? await kv.get(keys.avatar(id)) : null;
        if (!record?.data) throw new HttpError(404, 'Pas de photo');
        const buf = Buffer.from(record.data, 'base64');
        res.statusCode = 200;
        res.setHeader('Content-Type', record.type);
        res.setHeader('Content-Length', buf.length);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', req.query?.v ? 'public, max-age=31536000, s-maxage=31536000, immutable' : 'no-cache');
        res.end(buf);
    },

    async PUT(req, res) {
        const kv = getKV();
        const profile = await loadProfile(kv, req);
        await requireWrite(kv, req, profile.id);
        const match = DATA_URL.exec(String(body(req).image || ''));
        if (!match) throw new HttpError(400, 'Image invalide : utilise une photo JPG, PNG, WebP ou GIF.');
        const buf = Buffer.from(match[2], 'base64');
        if (buf.length > MAX_BYTES) throw new HttpError(413, 'Photo trop lourde.');
        const type = sniff(buf);
        if (!type || type !== match[1]) throw new HttpError(400, 'Image invalide : utilise une photo JPG, PNG, WebP ou GIF.');

        await kv.set(keys.avatar(profile.id), { type, data: match[2] });
        // Nouvelle photo : l'ancien GIF ne correspond plus (un nouveau GIF est enregistré juste après, le cas échéant).
        if (profile.media?.anim) {
            await removeMedia(getBlob(), profile.media.anim);
            delete profile.media.anim;
        }
        profile.avatarVersion = Date.now();
        profile.updatedAt = Date.now();
        await kv.set(keys.profile(profile.id), profile);
        send(res, 200, { profile: publicProfile(profile) });
    },

    async POST(req, res) {
        const kv = getKV();
        const profile = await loadProfile(kv, req);
        await requireWrite(kv, req, profile.id);
        const blob = storage();
        const input = body(req);
        const kind = mediaKind(input.kind);
        const allowed = kind === 'anim' ? ['image/gif'] : Object.keys(EXT);

        if (input.action === 'prepare') {
            const type = String(input.type || '');
            if (!allowed.includes(type)) throw new HttpError(400, kind === 'anim' ? 'Seuls les GIF sont acceptés ici.' : 'Utilise une image JPG, PNG, WebP ou GIF.');
            if (!(Number(input.size) > 0) || Number(input.size) > MEDIA_MAX) throw new HttpError(413, 'Fichier trop lourd (15 Mo au maximum).');
            const stamp = `${Date.now()}`;
            const key = `profiles/${profile.id}/${kind}-${stamp}.${EXT[type]}`;
            const result = { key, url: await blob.signUpload(key) };
            // Bannière en GIF : une image fixe à part, pour ceux qui préfèrent sans animation.
            if (kind === 'banner' && type === 'image/gif' && STILL_EXT[input.stillType]) {
                if (!(Number(input.stillSize) > 0) || Number(input.stillSize) > MEDIA_MAX) throw new HttpError(413, 'Fichier trop lourd (15 Mo au maximum).');
                result.stillKey = `profiles/${profile.id}/${kind}-${stamp}-still.${STILL_EXT[input.stillType]}`;
                result.stillUrl = await blob.signUpload(result.stillKey);
            }
            return send(res, 200, result);
        }

        if (input.action !== 'commit') throw new HttpError(400, 'Action inconnue');
        const prefix = `profiles/${profile.id}/${kind}-`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const key = cleanString(input.key, 200);
        await checkUpload(blob, key, new RegExp(`^${prefix}\\d+\\.(gif|webp|jpg|png)$`), allowed);
        let still = null;
        if (input.stillKey) {
            still = cleanString(input.stillKey, 200);
            await checkUpload(blob, still, new RegExp(`^${prefix}\\d+-still\\.(webp|jpg)$`), ['image/webp', 'image/jpeg']);
        }
        const frame = input.frame || {};
        const previous = profile.media?.[kind];
        profile.media = { ...profile.media, [kind]: { key, still, v: Date.now(), x: clamp(frame.x, -5, 5), y: clamp(frame.y, -5, 5), s: clamp(frame.s, 1, 10) } };
        profile.updatedAt = Date.now();
        await kv.set(keys.profile(profile.id), profile);
        if (previous && previous.key !== key) await removeMedia(blob, previous);
        send(res, 200, { profile: publicProfile(profile) });
    },

    async DELETE(req, res) {
        const kv = getKV();
        const profile = await loadProfile(kv, req);
        await requireWrite(kv, req, profile.id);
        if (req.query?.kind) {
            const kind = mediaKind(req.query.kind);
            await removeMedia(getBlob(), profile.media?.[kind]);
            if (profile.media) delete profile.media[kind];
        } else {
            await kv.del(keys.avatar(profile.id));
            delete profile.avatarVersion;
            await removeMedia(getBlob(), profile.media?.anim);
            if (profile.media) delete profile.media.anim;
        }
        profile.updatedAt = Date.now();
        await kv.set(keys.profile(profile.id), profile);
        send(res, 200, { profile: publicProfile(profile) });
    },
});
