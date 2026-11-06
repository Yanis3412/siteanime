// Appli installable (PWA) : service worker, bouton d'installation, détection des nouvelles versions.

let installEvent = null;
const listeners = new Set();

if (typeof window !== 'undefined') {
    // Android et ordinateur (Chrome, Edge) : le navigateur propose l'installation, on la garde pour le bouton.
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        installEvent = e;
        listeners.forEach((fn) => fn());
    });
    window.addEventListener('appinstalled', () => {
        installEvent = null;
        listeners.forEach((fn) => fn());
    });
}

export const onInstallChange = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
};

// Déjà ouvert comme une appli (depuis l'écran d'accueil).
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Chrome, Firefox ou Edge sur iPhone (le bouton Partager n'est pas au même endroit que dans Safari).
export const isIosOtherBrowser = () => isIos() && /CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);

export const canPromptInstall = () => !!installEvent;

export async function promptInstall() {
    if (!installEvent) return false;
    installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    installEvent = null;
    listeners.forEach((fn) => fn());
    return outcome === 'accepted';
}

export function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
}

// Prévient quand une nouvelle version du site a été mise en ligne pendant que l'appli était ouverte
// (sur iPhone, une appli rouverte depuis l'écran d'accueil ne se recharge pas forcément).
export function watchForUpdates(onUpdate) {
    if (!import.meta.env.PROD) return () => {};
    const current = document.querySelector('script[type="module"][src*="/assets/index-"]')?.getAttribute('src');
    if (!current) return () => {};
    let notified = false;
    const check = async () => {
        if (notified || document.visibilityState !== 'visible') return;
        try {
            const html = await (await fetch('/', { cache: 'no-store' })).text();
            const latest = /\/assets\/index-[^"']+\.js/.exec(html)?.[0];
            if (latest && !current.endsWith(latest)) {
                notified = true;
                onUpdate();
            }
        } catch {
            /* hors ligne */
        }
    };
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(check, 30 * 60 * 1000);
    return () => {
        document.removeEventListener('visibilitychange', onVisible);
        clearInterval(timer);
    };
}
