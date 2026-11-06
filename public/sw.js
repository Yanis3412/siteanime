// Service worker de Liste : démarrage plus rapide et écran correct sans connexion.
// Les données (API, chapitres, couvertures) ne passent jamais par ici : elles sont toujours à jour.
const VERSION = 'v1';
const SHELL = `liste-shell-${VERSION}`; // la page de l'appli (index.html)
const ASSETS = `liste-assets-${VERSION}`; // code, styles, polices et icônes (noms uniques à chaque version)
const MAX_ASSETS = 80;

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(SHELL)
            .then((cache) => cache.add(new Request('/', { cache: 'no-store' })))
            .catch(() => {})
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            for (const key of await caches.keys()) if (key !== SHELL && key !== ASSETS) await caches.delete(key);
            await self.clients.claim();
        })(),
    );
});

async function trim(cache) {
    const keys = await cache.keys();
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(key);
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    // Autres sites (stockage des chapitres, AniList…) et API : le navigateur s'en occupe directement.
    if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/__blob/')) return;

    // Pages : toujours la dernière version en ligne ; la copie ne sert que sans connexion.
    if (req.mode === 'navigate') {
        event.respondWith(
            (async () => {
                try {
                    const res = await fetch(url.href, { cache: 'no-store', credentials: 'same-origin' });
                    if (res.ok) (await caches.open(SHELL)).put('/', res.clone());
                    return res;
                } catch {
                    return (await caches.match('/', { cacheName: SHELL })) || Response.error();
                }
            })(),
        );
        return;
    }

    // Fichiers dont le nom change à chaque version : on les garde.
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
        event.respondWith(
            (async () => {
                const cached = await caches.match(req, { cacheName: ASSETS });
                if (cached) return cached;
                const res = await fetch(req);
                if (res.ok) {
                    const cache = await caches.open(ASSETS);
                    await cache.put(req, res.clone());
                    trim(cache);
                }
                return res;
            })(),
        );
    }
});
