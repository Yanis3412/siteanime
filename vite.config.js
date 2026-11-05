import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En local, sert aussi les fonctions /api (comme Vercel) pour pouvoir tout tester avec `npm run dev`.
function localApi() {
    return {
        name: 'local-api',
        configureServer(server) {
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
