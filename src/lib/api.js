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

const qs = (params) => new URLSearchParams(params).toString();

export const api = {
    listProfiles: () => request('GET', 'profiles'),
    createProfile: (name, pin) => request('POST', 'profiles', { body: { name, pin } }),
    updateProfile: (id, changes, token) => request('PATCH', `profile?id=${encodeURIComponent(id)}`, { body: changes, token }),
    deleteProfile: (id, token) => request('DELETE', `profile?id=${encodeURIComponent(id)}`, { token }),
    setAvatar: (id, image, token) => request('PUT', `avatar?id=${encodeURIComponent(id)}`, { body: { image }, token }),
    removeAvatar: (id, token) => request('DELETE', `avatar?id=${encodeURIComponent(id)}`, { token }),

    login: (profileId, pin) => request('POST', 'session', { body: { profileId, pin } }),
    checkSession: (token) => request('GET', 'session', { token }),
    logout: (token) => request('DELETE', 'session', { token }),

    getLibrary: (id) => request('GET', `library?id=${encodeURIComponent(id)}`),
    saveLibrary: (id, payload, token) => request('PUT', `library?id=${encodeURIComponent(id)}`, { body: payload, token }),
    getRecommendations: () => request('GET', 'library?recommended=1'),

    chapters: {
        list: (profileId, itemId, token) => request('GET', `chapters?${qs({ profileId, itemId })}`, { token }),
        get: (profileId, itemId, num, token, variant = 'vo') => request('GET', `chapters?${qs({ profileId, itemId, num, variant })}`, { token }),
        prepare: (payload, token) => request('POST', 'chapters', { body: { action: 'prepare', ...payload }, token }),
        commit: (uploadId, token) => request('POST', 'chapters', { body: { action: 'commit', uploadId }, token }),
        abort: (uploadId, token) => request('POST', 'chapters', { body: { action: 'abort', uploadId }, token }),
        update: (payload, token) => request('PATCH', 'chapters', { body: payload, token }),
        remove: (profileId, itemId, num, token) => request('DELETE', `chapters?${qs({ profileId, itemId, num })}`, { token }),
        removeAll: (profileId, itemId, token) => request('DELETE', `chapters?${qs({ profileId, itemId, all: 1 })}`, { token }),
    },

    jobs: {
        list: (profileId, itemId, token) => request('GET', `jobs?${qs({ profileId, itemId })}`, { token }),
        request: (payload, token) => request('POST', 'jobs', { body: { action: 'request', ...payload }, token }),
        cancel: (jobId, token) => request('POST', 'jobs', { body: { action: 'cancel', jobId }, token }),
    },

    getSites: () => request('GET', 'sites'),
    saveSites: (groups, token) => request('PUT', 'sites', { body: { groups }, token }),
    backups: {
        list: (token) => request('GET', 'backup?list=1', { token }),
        show: (key, token) => request('GET', `backup?${qs({ show: key })}`, { token }),
        download: (key, token) => request('GET', `backup?${qs({ download: key })}`, { token }),
        create: (token) => request('POST', 'backup', { body: { action: 'create' }, token }),
        restore: (key, profileIds, token) => request('POST', 'backup', { body: { action: 'restore', key, profileIds }, token }),
    },
    adminStorage: (token) => request('GET', 'admin?storage=1', { token }),
    adminCleanupPreview: (token) => request('GET', 'admin?cleanup=1', { token }),
    adminCleanup: (token) => request('POST', 'admin', { body: { action: 'cleanup' }, token }),
};

// Adresse de la photo d'un profil, ou null s'il n'en a pas (on affiche alors ses initiales).
export function avatarUrl(profile) {
    if (!profile?.avatar) return null;
    return `/api/avatar?${qs({ id: profile.id, v: profile.avatar })}`;
}
