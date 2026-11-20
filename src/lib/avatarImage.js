// Photo de profil : lecture de l'image choisie, puis rendu du cadrage choisi en 256 × 256,
// WebP (ou JPEG si le navigateur ne sait pas encoder le WebP). Renvoie une adresse data: prête à envoyer.
const SIZE = 256;
const MAX_INPUT = 25 * 1024 * 1024;

export class AvatarImageError extends Error {}

// Lit l'image (orientation de l'appareil photo respectée) pour l'éditeur de cadrage.
// Un GIF est gardé tel quel (pour son animation) : 15 Mo au maximum ; bitmap = sa première image.
export const GIF_MAX = 15 * 1024 * 1024;

export async function readPhoto(file) {
    if (!file.type.startsWith('image/')) throw new AvatarImageError('Ce fichier n’est pas une image.');
    if (file.size > MAX_INPUT) throw new AvatarImageError('Image trop lourde (25 Mo au maximum).');
    const animated = file.type === 'image/gif';
    if (animated && file.size > GIF_MAX) throw new AvatarImageError('GIF trop lourd (15 Mo au maximum).');
    let bitmap;
    try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
        throw new AvatarImageError('Format d’image non reconnu. Utilise une image JPG, PNG, WebP ou GIF.');
    }
    if (!bitmap.width || !bitmap.height) throw new AvatarImageError('Image vide ou illisible.');
    return { bitmap, url: URL.createObjectURL(file), width: bitmap.width, height: bitmap.height, animated, file };
}

export function releasePhoto(photo) {
    photo?.bitmap?.close?.();
    if (photo?.url) URL.revokeObjectURL(photo.url);
}

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

const toDataUrl = (blob) =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });

// Dessine le cadrage tel qu'il est affiché dans l'éditeur (carré de côté `view` pixels).
// crop = { x, y } décalage du centre de l'image, { scale } taille, { rotation } en degrés.
export async function renderAvatar(photo, crop, view) {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    const k = SIZE / view;
    ctx.translate(SIZE / 2 + crop.x * k, SIZE / 2 + crop.y * k);
    ctx.rotate((crop.rotation * Math.PI) / 180);
    ctx.scale(crop.scale * k, crop.scale * k);
    ctx.drawImage(photo.bitmap, -photo.width / 2, -photo.height / 2);

    let blob = await toBlob(canvas, 'image/webp', 0.86);
    if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', 0.88);
    if (!blob) throw new AvatarImageError('Impossible de préparer cette image.');
    return toDataUrl(blob);
}

// Image entière réduite (côté le plus long ≤ maxSide), pour une bannière ou l'image fixe d'un GIF.
export async function encodeStill(photo, maxSide = 2400) {
    const k = Math.min(1, maxSide / Math.max(photo.width, photo.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(photo.width * k);
    canvas.height = Math.round(photo.height * k);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(photo.bitmap, 0, 0, canvas.width, canvas.height);
    let blob = await toBlob(canvas, 'image/webp', 0.86);
    if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', 0.88);
    if (!blob) throw new AvatarImageError('Impossible de préparer cette image.');
    return blob;
}
