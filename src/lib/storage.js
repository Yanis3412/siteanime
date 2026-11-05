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

// Jetons de session, un par profil déverrouillé sur cet appareil.
export const tokens = {
    all: () => load('tokens', {}),
    get: (profileId) => load('tokens', {})[profileId] || null,
    set(profileId, token) {
        const all = load('tokens', {});
        if (token) all[profileId] = token;
        else delete all[profileId];
        save('tokens', all);
    },
};
