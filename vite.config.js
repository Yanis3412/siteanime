import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs/promises';
import path from 'node:path';

// En local, sert aussi les fonctions /api (comme Vercel) pour pouvoir tout tester avec `npm run dev`.
function localApi() {
    return {
        name: 'local-api',
        configureServer(server) {
            // Faux stockage des pages de chapitres (remplace Cloudflare R2 en local).
            server.middlewares.use('/__blob', async (req, res) => {
                const key = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
                if (!/^[\w./-]+$/.test(key) || key.includes('..')) {
                    res.statusCode = 400;
                    return res.end();
                }
                const file = path.resolve('.dev-blobs', key);
                if (req.method === 'PUT') {
                    const chunks = [];
                    for await (const chunk of req) chunks.push(chunk);
                    await fs.mkdir(path.dirname(file), { recursive: true });
                    await fs.writeFile(file, Buffer.concat(chunks));
                    res.statusCode = 200;
                    return res.end();
                }
                try {
                    const data = await fs.readFile(file);
                    const ext = path.extname(file).slice(1);
                    res.setHeader('Content-Type', { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif' }[ext] || 'application/octet-stream');
                    res.end(data);
                } catch {
                    res.statusCode = 404;
                    res.end();
                }
            });

            server.middlewares.use('/api', async (req, res, next) => {
                const url = new URL(req.url, 'http://localhost');
                const name = url.pathname.replace(/^\/+|\/+$/g, '');
                if (!/^[a-z-]+$/.test(name)) return next();

                let mod;
                try {
                    mod = await server.ssrLoadModule(`/api/${name}.js`);
                } catch {
                    return next();
                }

                const chunks = [];
                for await (const chunk of req) chunks.push(chunk);
                const raw = Buffer.concat(chunks).toString('utf8');

                req.query = Object.fromEntries(url.searchParams);
                req.body = raw ? JSON.parse(raw) : undefined;
                res.status = (code) => {
                    res.statusCode = code;
                    return res;
                };
                res.json = (data) => {
                    res.setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(data));
                };
                await mod.default(req, res);
            });
        },
    };
}

export default defineConfig({
    plugins: [react(), localApi()],
    server: { port: 5173 },
});
