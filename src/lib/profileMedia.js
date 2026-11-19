// Envoi des médias de la page de profil (photo en GIF, bannière) : le fichier part directement
// vers le stockage par un lien signé, puis le serveur vérifie et enregistre le cadrage.
import { api } from './api.js';
import { encodeStill } from './avatarImage.js';

async function putFile(url, blob) {
    let res;
    try {
        res = await fetch(url, { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type } });
    } catch {
        throw new Error('Envoi impossible. Vérifie ta connexion internet.');
    }
    if (!res.ok) throw new Error(`Envoi refusé (${res.status})`);
}

// file : le fichier envoyé tel quel ; still : image fixe facultative (bannière en GIF).
export async function uploadMedia(profileId, kind, { file, still = null }, framing, token) {
    const prep = await api.media.prepare(profileId, { kind, type: file.type, size: file.size, stillType: still?.type, stillSize: still?.size }, token);
    await putFile(prep.url, file);
    if (prep.stillUrl && still) await putFile(prep.stillUrl, still);
    return api.media.commit(profileId, { kind, key: prep.key, stillKey: prep.stillUrl && still ? prep.stillKey : undefined, frame: framing }, token);
}

// Bannière : un GIF part tel quel (avec sa première image à part) ; une image fixe est réduite avant l'envoi.
export async function bannerFiles(photo) {
    if (photo.animated) return { file: photo.file, still: await encodeStill(photo, 1600) };
    return { file: await encodeStill(photo, 2400) };
}
