// GET /api/sites            → liens de la page Sites (lecture libre)
// PUT /api/sites { groups } → remplace la liste (administrateur seulement)
// Tant que rien n'a été enregistré, le site affiche ses liens de départ (src/data/defaultSites.js).
import { getKV } from './_lib/kv.js';
import { route, send, body, cleanString, HttpError } from './_lib/http.js';
import { requireAdmin } from './_lib/auth.js';

const KEY = 'v2:sites';
const MAX_GROUPS = 8;
const MAX_SITES = 60;

function cleanUrl(value) {
    let url = cleanString(value, 400);
    if (!url) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
    try {
        const u = new URL(url);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
        return u.href;
    } catch {
        return null;
    }
}

export function cleanGroups(input) {
    if (!Array.isArray(input)) throw new HttpError(400, 'Liste de sites invalide');
    if (input.length > MAX_GROUPS) throw new HttpError(400, `${MAX_GROUPS} catégories au maximum`);
    return input.map((g, i) => {
        const title = cleanString(g?.title, 40);
        if (!title) throw new HttpError(400, `La catégorie ${i + 1} n’a pas de nom`);
        const sites = Array.isArray(g.sites) ? g.sites : [];
        if (sites.length > MAX_SITES) throw new HttpError(400, `${MAX_SITES} sites au maximum par catégorie`);
        return {
            title,
            sites: sites.map((s) => {
                const url = cleanUrl(s?.url);
                if (!url) throw new HttpError(400, `Adresse invalide dans « ${title} » : ${cleanString(s?.url, 80) || 'vide'}`);
                const name = cleanString(s?.name, 60) || new URL(url).hostname.replace(/^www\./, '');
                return { name, url };
            }),
        };
    });
}

export default route({
    async GET(req, res) {
        const saved = await getKV().get(KEY);
        res.setHeader?.('Cache-Control', 'no-store');
        send(res, 200, { groups: saved?.groups || null, updatedAt: saved?.updatedAt || null });
    },

    async PUT(req, res) {
        const kv = getKV();
        await requireAdmin(kv, req);
        const groups = cleanGroups(body(req).groups);
        const record = { groups, updatedAt: Date.now() };
        await kv.set(KEY, record);
        send(res, 200, record);
    },
});
