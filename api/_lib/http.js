// Petits utilitaires communs aux fonctions /api.

export class HttpError extends Error {
    constructor(status, message, extra = {}) {
        super(message);
        this.status = status;
        this.extra = extra;
    }
}

export function send(res, status, data) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(status).json(data);
}

export function body(req) {
    if (!req.body) return {};
    if (typeof req.body === 'string') {
        try {
            return JSON.parse(req.body);
        } catch {
            throw new HttpError(400, 'Corps de requête invalide');
        }
    }
    return req.body;
}

// Enveloppe un handler : routage par méthode HTTP + gestion des erreurs.
export function route(handlers) {
    return async function handler(req, res) {
        const fn = handlers[req.method];
        if (!fn) return send(res, 405, { error: 'Méthode non autorisée' });
        try {
            await fn(req, res);
        } catch (err) {
            const status = err.status || 500;
            if (status >= 500) console.error(err);
            const message = status >= 500 && !err.expose ? 'Erreur serveur' : err.message;
            send(res, status, { error: message, ...(err.extra || {}) });
        }
    };
}

export function cleanString(value, max) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, max);
}
