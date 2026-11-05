// Codes PIN (hachés avec scrypt), sessions et limitation des essais.
import crypto from 'node:crypto';
import { HttpError } from './http.js';
import { keys } from './store.js';

const SESSION_TTL = 60 * 60 * 24 * 60; // 60 jours
const MAX_FAILS = 8;
const LOCK_SECONDS = 15 * 60;

export function hashPin(pin) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(String(pin), salt, 32);
    return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPin(pin, stored) {
    if (!stored) return true; // profil sans code
    const [algo, saltHex, hashHex] = String(stored).split('$');
    if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(String(pin ?? ''), Buffer.from(saltHex, 'hex'), expected.length);
    return crypto.timingSafeEqual(expected, actual);
}

export function isValidNewPin(pin) {
    return typeof pin === 'string' && /^\d{4,6}$/.test(pin);
}

export async function createSession(kv, profile) {
    const token = crypto.randomBytes(32).toString('base64url');
    await kv.set(
        keys.session(token),
        { profileId: profile.id, isAdmin: !!profile.isAdmin, pinVersion: profile.pinVersion || 1, createdAt: Date.now() },
        { ex: SESSION_TTL },
    );
    return token;
}

function tokenFrom(req) {
    const header = req.headers?.authorization || req.headers?.Authorization || '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    return match ? match[1] : null;
}

// Renvoie la session valide liée à la requête, ou null.
export async function getSession(kv, req) {
    const token = tokenFrom(req);
    if (!token) return null;
    const session = await kv.get(keys.session(token));
    if (!session) return null;
    const profile = await kv.get(keys.profile(session.profileId));
    // Profil supprimé ou code changé depuis : la session n'est plus valable.
    if (!profile || (profile.pinVersion || 1) !== (session.pinVersion || 1)) return null;
    return { ...session, isAdmin: !!profile.isAdmin, token };
}

export async function destroySession(kv, req) {
    const token = tokenFrom(req);
    if (token) await kv.del(keys.session(token));
}

export async function requireWrite(kv, req, profileId) {
    const session = await getSession(kv, req);
    if (!session) throw new HttpError(401, 'Connexion requise');
    if (session.profileId !== profileId && !session.isAdmin) {
        throw new HttpError(403, "Tu n'as pas accès à ce profil");
    }
    return session;
}

export async function requireAdmin(kv, req) {
    const session = await getSession(kv, req);
    if (!session?.isAdmin) throw new HttpError(403, 'Réservé à l’administrateur');
    return session;
}

// Bloque un profil 15 minutes après trop de codes faux.
export async function checkLock(kv, profileId) {
    const fails = Number((await kv.get(keys.fails(profileId))) || 0);
    if (fails >= MAX_FAILS) {
        throw new HttpError(429, 'Trop d’essais. Réessaie dans 15 minutes.');
    }
}

export async function recordFail(kv, profileId) {
    const n = await kv.incr(keys.fails(profileId));
    if (n === 1) await kv.expire(keys.fails(profileId), LOCK_SECONDS);
    return MAX_FAILS - n;
}

export async function clearFails(kv, profileId) {
    await kv.del(keys.fails(profileId));
}
