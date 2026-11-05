// Accès au stockage clé-valeur.
// En production : Upstash Redis (variables UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN).
// En local sans ces variables : un faux stockage dans le fichier .dev-kv.json.
import { Redis } from '@upstash/redis';
import fs from 'node:fs';
import path from 'node:path';

let client = null;

export function getKV() {
    if (client) return client;
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (url && token) {
        client = upstashAdapter(new Redis({ url, token }));
    } else if (process.env.VERCEL) {
        throw Object.assign(
            new Error('Base de données non configurée : ajoute UPSTASH_REDIS_REST_URL et UPSTASH_REDIS_REST_TOKEN dans les variables d’environnement Vercel.'),
            { status: 503, expose: true },
        );
    } else {
        client = fileAdapter(path.resolve(process.cwd(), '.dev-kv.json'));
    }
    return client;
}

function upstashAdapter(redis) {
    return {
        get: (key) => redis.get(key),
        mget: (keys) => (keys.length ? redis.mget(...keys) : Promise.resolve([])),
        async set(key, value, opts = {}) {
            const options = {};
            if (opts.ex) options.ex = opts.ex;
            if (opts.nx) options.nx = true;
            const res = await redis.set(key, value, options);
            return res === 'OK';
        },
        del: (...keys) => (keys.length ? redis.del(...keys) : Promise.resolve(0)),
        incr: (key) => redis.incr(key),
        incrby: (key, n) => redis.incrby(key, n),
        expire: (key, seconds) => redis.expire(key, seconds),
        sadd: (key, ...members) => redis.sadd(key, members[0], ...members.slice(1)),
        srem: (key, ...members) => redis.srem(key, ...members),
        smembers: (key) => redis.smembers(key),
    };
}

// Faux Redis minimal pour le développement local.
function fileAdapter(file) {
    let data = {};
    try {
        data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        data = {};
    }
    const persist = () => fs.writeFileSync(file, JSON.stringify(data, null, 2));
    const alive = (key) => {
        const entry = data[key];
        if (!entry) return null;
        if (entry.exp && entry.exp < Date.now()) {
            delete data[key];
            return null;
        }
        return entry;
    };
    const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

    return {
        async get(key) {
            const entry = alive(key);
            if (!entry) return null;
            // Imite Upstash : une chaîne JSON est renvoyée déjà décodée.
            if (typeof entry.value === 'string') {
                try {
                    return JSON.parse(entry.value);
                } catch {
                    return entry.value;
                }
            }
            return clone(entry.value);
        },
        async mget(keys) {
            return Promise.all(keys.map((k) => this.get(k)));
        },
        async set(key, value, opts = {}) {
            if (opts.nx && alive(key)) return false;
            data[key] = { value: clone(value), exp: opts.ex ? Date.now() + opts.ex * 1000 : null };
            persist();
            return true;
        },
        async del(...keys) {
            let n = 0;
            for (const k of keys) if (data[k]) { delete data[k]; n++; }
            persist();
            return n;
        },
        async incr(key) {
            const entry = alive(key);
            const next = (entry ? Number(entry.value) : 0) + 1;
            data[key] = { value: next, exp: entry?.exp ?? null };
            persist();
            return next;
        },
        async incrby(key, n) {
            const entry = alive(key);
            const next = (entry ? Number(entry.value) : 0) + n;
            data[key] = { value: next, exp: entry?.exp ?? null };
            persist();
            return next;
        },
        async expire(key, seconds) {
            const entry = alive(key);
            if (!entry) return 0;
            entry.exp = Date.now() + seconds * 1000;
            persist();
            return 1;
        },
        async sadd(key, ...members) {
            const set = new Set(alive(key)?.value || []);
            members.forEach((m) => set.add(m));
            data[key] = { value: [...set], exp: null };
            persist();
            return members.length;
        },
        async srem(key, ...members) {
            const set = new Set(alive(key)?.value || []);
            members.forEach((m) => set.delete(m));
            data[key] = { value: [...set], exp: null };
            persist();
            return members.length;
        },
        async smembers(key) {
            return [...(alive(key)?.value || [])];
        },
    };
}
