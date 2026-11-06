// Prépare une photo de profil : recadrage carré au centre, 256 × 256, WebP (ou JPEG si le navigateur
// ne sait pas encoder le WebP). Renvoie une adresse data: prête à envoyer.
const SIZE = 256;
const MAX_INPUT = 25 * 1024 * 1024;

export class AvatarImageError extends Error {}

async function decode(file) {
    if ('createImageBitmap' in window) {
        try {
            return await createImageBitmap(file, { imageOrientation: 'from-image' });
        } catch {
            /* on essaie avec un élément <img> */
        }
    }
    const url = URL.createObjectURL(file);
    try {
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
        await img.decode();
        return img;
    } finally {
        URL.revokeObjectURL(url);
    }
}

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

const toDataUrl = (blob) =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });

export async function makeAvatar(file) {
    if (!file.type.startsWith('image/')) throw new AvatarImageError('Ce fichier n’est pas une image.');
    if (file.size > MAX_INPUT) throw new AvatarImageError('Image trop lourde (25 Mo au maximum).');

    let source;
    try {
        source = await decode(file);
    } catch {
        throw new AvatarImageError('Format d’image non reconnu. Utilise une photo JPG, PNG ou WebP.');
    }
    const w = source.width || source.naturalWidth;
    const h = source.height || source.naturalHeight;
    if (!w || !h) throw new AvatarImageError('Image vide ou illisible.');

    const side = Math.min(w, h);
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, (w - side) / 2, (h - side) / 2, side, side, 0, 0, SIZE, SIZE);
    source.close?.();

    let blob = await toBlob(canvas, 'image/webp', 0.86);
    if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', 0.88);
    if (!blob) throw new AvatarImageError('Impossible de préparer cette image.');
    return toDataUrl(blob);
}
