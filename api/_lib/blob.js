// Stockage des pages de chapitres.
// En production : Cloudflare R2 (compatible S3), avec des liens signés à durée limitée :
// le navigateur envoie et lit les images directement chez R2, sans passer par Vercel.
// En local sans configuration R2 : fichiers dans .dev-blobs/, servis par le serveur de dev.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AwsClient } from 'aws4fetch';

const UPLOAD_TTL = 60 * 30; // 30 min pour envoyer les pages
const READ_TTL = 60 * 60 * 3; // 3 h pour lire un chapitre

let storage = null;

export function getBlob() {
    if (storage) return storage;
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
    if (R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET) {
        storage = r2Storage({ accountId: R2_ACCOUNT_ID, accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, bucket: R2_BUCKET });
    } else if (process.env.VERCEL) {
        storage = { configured: false };
    } else {
        storage = devStorage(path.resolve(process.cwd(), '.dev-blobs'));
    }
    return storage;
}

// Limite totale du stockage (par défaut 9,5 Go pour rester dans l'offre gratuite de R2).
export function storageLimit() {
    const n = Number(process.env.R2_MAX_BYTES);
    return Number.isFinite(n) && n > 0 ? n : 9.5e9;
}

function r2Storage({ accountId, accessKeyId, secretAccessKey, bucket }) {
    const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
    const base = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;
    const objectUrl = (key) => `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;

    async function presign(key, method, ttl) {
        const url = new URL(objectUrl(key));
        url.searchParams.set('X-Amz-Expires', String(ttl));
        const signed = await client.sign(new Request(url, { method }), { aws: { signQuery: true } });
        return signed.url;
    }

    return {
        configured: true,
        signUpload: (key, ttl = UPLOAD_TTL) => presign(key, 'PUT', ttl),
        signRead: (key) => presign(key, 'GET', READ_TTL),
        async size(key) {
            const res = await client.fetch(objectUrl(key), { method: 'HEAD' });
            if (res.status === 404) return null;
            if (!res.ok) throw new Error(`R2 HEAD ${res.status}`);
            return Number(res.headers.get('content-length') || 0);
        },
        // Petits fichiers écrits par le serveur lui-même (sauvegardes).
        async putJson(key, data) {
            const res = await client.fetch(objectUrl(key), {
                method: 'PUT',
                body: JSON.stringify(data),
                headers: { 'Content-Type': 'application/json' },
            });
            if (!res.ok) throw new Error(`R2 PUT ${res.status}`);
        },
        async getJson(key) {
            const res = await client.fetch(objectUrl(key));
            if (res.status === 404) return null;
            if (!res.ok) throw new Error(`R2 GET ${res.status}`);
            return res.json();
        },
        // Liste les fichiers d'un dossier (ListObjectsV2), jusqu'à 1000.
        async list(prefix) {
            const url = new URL(base);
            url.searchParams.set('list-type', '2');
            url.searchParams.set('prefix', prefix);
            const res = await client.fetch(url.toString());
            if (!res.ok) throw new Error(`R2 LIST ${res.status}`);
            const xml = await res.text();
            return [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(([, c]) => ({
                key: unescapeXml(/<Key>([\s\S]*?)<\/Key>/.exec(c)?.[1] || ''),
                size: Number(/<Size>(\d+)<\/Size>/.exec(c)?.[1] || 0),
            }));
        },
        // Suppression par lots de 1000 (DeleteObjects).
        async removeMany(keys) {
            for (let i = 0; i < keys.length; i += 1000) {
                const batch = keys.slice(i, i + 1000);
                const xml =
                    '<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>' +
                    batch.map((k) => `<Object><Key>${escapeXml(k)}</Key></Object>`).join('') +
                    '</Delete>';
                const md5 = crypto.createHash('md5').update(xml).digest('base64');
                const res = await client.fetch(`${base}?delete`, {
                    method: 'POST',
                    body: xml,
                    headers: { 'Content-Type': 'application/xml', 'Content-MD5': md5 },
                });
                if (!res.ok) throw new Error(`R2 DeleteObjects ${res.status}`);
            }
        },
    };
}

function devStorage(dir) {
    const file = (key) => path.join(dir, ...key.split('/'));
    return {
        configured: true,
        dev: true,
        signUpload: async (key) => `/__blob/${key}`,
        signRead: async (key) => `/__blob/${key}`,
        async size(key) {
            try {
                return (await fs.stat(file(key))).size;
            } catch {
                return null;
            }
        },
        async removeMany(keys) {
            await Promise.all(keys.map((k) => fs.rm(file(k), { force: true })));
        },
        async putJson(key, data) {
            await fs.mkdir(path.dirname(file(key)), { recursive: true });
            await fs.writeFile(file(key), JSON.stringify(data));
        },
        async getJson(key) {
            try {
                return JSON.parse(await fs.readFile(file(key), 'utf8'));
            } catch {
                return null;
            }
        },
        async list(prefix) {
            const folder = file(prefix.replace(/\/$/, ''));
            try {
                const names = await fs.readdir(folder);
                return Promise.all(names.map(async (n) => ({ key: `${prefix.replace(/\/?$/, '/')}${n}`, size: (await fs.stat(path.join(folder, n))).size })));
            } catch {
                return [];
            }
        },
    };
}

function unescapeXml(s) {
    return s.replace(/&(lt|gt|amp|apos|quot);/g, (_, e) => ({ lt: '<', gt: '>', amp: '&', apos: "'", quot: '"' })[e]);
}

function escapeXml(s) {
    return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
}
