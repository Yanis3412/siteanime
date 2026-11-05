// Appels vers les fonctions /api du site.

export class ApiError extends Error {
    constructor(status, message, data) {
        super(message);
        this.status = status;
        this.data = data;
    }
}

async function request(method, path, { token, body } = {}) {
    let res;
    try {
        res = await fetch(`/api/${path}`, {
            method,
            headers: {
                ...(body ? { 'Content-Type': 'application/json' } : {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
        });
    } catch {
        throw new ApiError(0, 'Connexion impossible. Vérifie ta connexion internet.');
    }
    let data = null;
    try {
        data = await res.json();
    } catch {
        data = null;
    }
    if (!res.ok) throw new ApiError(res.status, data?.error || `Erreur ${res.status}`, data);
    return data;
}

export const api = {
    listProfiles: () => request('GET', 'profiles'),
    createProfile: (name, pin) => request('POST', 'profiles', { body: { name, pin } }),
    updateProfile: (id, changes, token) => request('PATCH', `profile?id=${encodeURIComponent(id)}`, { body: changes, token }),
    deleteProfile: (id, token) => request('DELETE', `profile?id=${encodeURIComponent(id)}`, { token }),

    login: (profileId, pin) => request('POST', 'session', { body: { profileId, pin } }),
    checkSession: (token) => request('GET', 'session', { token }),
    logout: (token) => request('DELETE', 'session', { token }),

    getLibrary: (id) => request('GET', `library?id=${encodeURIComponent(id)}`),
    saveLibrary: (id, payload, token) => request('PUT', `library?id=${encodeURIComponent(id)}`, { body: payload, token }),
    getRecommendations: () => request('GET', 'library?recommended=1'),

    adminStatus: (token) => request('GET', 'admin', { token }),
    adminReimport: (token) => request('POST', 'admin', { body: { action: 'reimport' }, token }),
};
