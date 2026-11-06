// Accès au localStorage protégé (navigation privée, stockage bloqué…).
const PREFIX = 'liste.';

export function load(key, fallback = null) {
    try {
        const raw = localStorage.getItem(PREFIX + key);
        return raw === null ? fallback : JSON.parse(raw);
    } catch {
        return fallback;
    }
}

export function save(key, value) {
    try {
        if (value === undefined || value === null) localStorage.removeItem(PREFIX + key);
        else localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
        /* stockage indisponible : on ignore */
    }
}
