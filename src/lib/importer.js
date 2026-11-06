// Import de chapitres depuis l'ordinateur : CBZ/ZIP, PDF, images ou dossiers d'images.
// Tout se fait dans le navigateur : extraction, optimisation des images, puis envoi direct au stockage.
import { unzip } from 'fflate';
import { api } from './api.js';

const IMAGE_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', bmp: 'image/bmp' };
const KEEP_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']);
const MAX_SIDE = 2600;

const extOf = (name) => (name.split('.').pop() || '').toLowerCase();
const isImageName = (name) => !!IMAGE_EXT[extOf(name)] && !/(^|\/)(__MACOSX|\.)/.test(name);
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const baseName = (p) => p.split('/').pop();

// Devine le numéro de chapitre à partir d'un nom de fichier ou de dossier.
// "One Piece - Chapitre 1180.cbz", "OP_v105_c1180", "[Team] One Piece 1180 [1080p]" → 1180
export function detectNumber(name) {
    const base = name
        .replace(/\.[a-z0-9]{2,4}$/i, '')
        // Captures GoFullPage : « screencapture-site-com-…-2026-11-06-21_20_41 » : on retire la date et l'heure.
        .replace(/^screencapture[-_ ]/i, '')
        .replace(/[-_ ](?:19|20)\d{2}-\d{2}-\d{2}(?:[-_ ]\d{2}[-_]\d{2}(?:[-_]\d{2})?)?$/, '')
        .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
        .replace(/_/g, ' ');
    const explicit = base.match(/(?:^|[^a-z])(?:chap(?:itre|ter)?|ch|c)\.?\s*[#-]?\s*(\d+(?:[.,]\d+)?)/i);
    if (explicit) return parseFloat(explicit[1].replace(',', '.'));
    const withoutVolumes = base.replace(/(?:^|[^a-z])(?:vol(?:ume)?|tome|t|v)\.?\s*\d+/gi, ' ');
    const numbers = withoutVolumes.match(/\d+(?:[.,]\d+)?/g);
    return numbers ? parseFloat(numbers[numbers.length - 1].replace(',', '.')) : null;
}

// Parcourt un dossier déposé par glisser-déposer.
async function readEntry(entry, prefix = '') {
    if (entry.isFile) {
        const file = await new Promise((res, rej) => entry.file(res, rej));
        return [{ file, path: prefix + file.name }];
    }
    if (entry.isDirectory) {
        const reader = entry.createReader();
        const entries = [];
        for (;;) {
            const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
            if (!batch.length) break;
            entries.push(...batch);
        }
        const nested = await Promise.all(entries.map((e) => readEntry(e, `${prefix}${entry.name}/`)));
        return nested.flat();
    }
    return [];
}

export async function filesFromDrop(dataTransfer) {
    const entries = [...(dataTransfer.items || [])].map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
    if (entries.length) return (await Promise.all(entries.map((e) => readEntry(e)))).flat();
    return [...dataTransfer.files].map((file) => ({ file, path: file.name }));
}

export const filesFromInput = (fileList) => [...fileList].map((file) => ({ file, path: file.webkitRelativePath || file.name }));

// Regroupe les fichiers en chapitres : une archive ou un PDF = un chapitre,
// des images = un chapitre par dossier.
export function groupIntoChapters(entries) {
    const chapters = [];
    const unsupported = [];
    const folders = new Map();

    for (const { file, path } of entries) {
        const ext = extOf(file.name);
        if (ext === 'cbz' || ext === 'zip') {
            chapters.push({ id: crypto.randomUUID(), label: file.name, kind: 'archive', files: [file], size: file.size, num: detectNumber(file.name) });
        } else if (ext === 'pdf') {
            chapters.push({ id: crypto.randomUUID(), label: file.name, kind: 'pdf', files: [file], size: file.size, num: detectNumber(file.name) });
        } else if (isImageName(path)) {
            const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
            if (!folders.has(dir)) folders.set(dir, []);
            folders.get(dir).push({ file, path });
        } else if (ext === 'cbr' || ext === 'rar' || ext === '7z' || ext === 'cb7') {
            unsupported.push(file.name);
        }
    }

    for (const [dir, list] of folders) {
        list.sort((a, b) => natural(a.path, b.path));
        const label = dir ? baseName(dir) : list.length === 1 ? list[0].file.name : 'Images sélectionnées';
        chapters.push({
            id: crypto.randomUUID(),
            label,
            kind: 'images',
            files: list.map((x) => x.file),
            pages: list.length,
            size: list.reduce((n, x) => n + x.file.size, 0),
            num: detectNumber(dir ? baseName(dir) : list[0].file.name),
        });
    }

    chapters.sort((a, b) => (a.num ?? Infinity) - (b.num ?? Infinity) || natural(a.label, b.label));
    return { chapters, unsupported };
}

// ---------- Extraction des pages ----------

function unzipAsync(data) {
    return new Promise((resolve, reject) =>
        unzip(data, { filter: (f) => isImageName(f.name) }, (err, files) => (err ? reject(err) : resolve(files))),
    );
}

async function pagesFromArchive(file) {
    const files = await unzipAsync(new Uint8Array(await file.arrayBuffer()));
    return Object.keys(files)
        .sort(natural)
        .map((name) => new Blob([files[name]], { type: IMAGE_EXT[extOf(name)] }));
}

let pdfjsPromise = null;
export function loadPdfJs() {
    // Chargé seulement si on importe un PDF (bibliothèque lourde).
    pdfjsPromise ||= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([lib, worker]) => {
        lib.GlobalWorkerOptions.workerSrc = worker.default;
        return lib;
    });
    return pdfjsPromise;
}

async function pagesFromPdf(file, onPage) {
    const pdfjs = await loadPdfJs();
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    const doc = await task.promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(3, 1800 / base.width);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        await page.render({ canvas, viewport }).promise;
        pages.push(await canvasToBlob(canvas));
        page.cleanup();
        onPage?.(i, doc.numPages);
    }
    await task.destroy();
    return pages;
}

function encode(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function canvasToBlob(canvas) {
    const webp = await encode(canvas, 'image/webp', 0.88);
    if (webp?.type === 'image/webp') return webp;
    return encode(canvas, 'image/jpeg', 0.9);
}

// Réduit les pages trop lourdes (PNG, très grandes images) en WebP, sans toucher aux autres.
async function optimize(blob) {
    const heavy = blob.type === 'image/png' || blob.type === 'image/bmp' || blob.size > 2.5 * 1024 * 1024;
    if (!heavy || blob.type === 'image/gif') return blob;
    try {
        const bitmap = await createImageBitmap(blob);
        const ratio = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * ratio);
        canvas.height = Math.round(bitmap.height * ratio);
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close?.();
        const out = await canvasToBlob(canvas);
        if (out && (out.size < blob.size || !KEEP_TYPES.has(blob.type))) return out;
    } catch {
        /* image illisible par le navigateur : on garde l'originale */
    }
    return blob;
}

export async function extractPages(chapter, onStep) {
    let pages;
    if (chapter.splitPages?.length) pages = [];
    else if (chapter.kind === 'archive') pages = await pagesFromArchive(chapter.files[0]);
    else if (chapter.kind === 'pdf') pages = await pagesFromPdf(chapter.files[0], (i, n) => onStep?.(`Page ${i} sur ${n}`));
    else pages = chapter.files.map((f) => (f.type ? f : new Blob([f], { type: IMAGE_EXT[extOf(f.name)] })));
    // Capture de page web déjà découpée en planches dans l'éditeur.
    if (chapter.splitPages?.length) pages = chapter.splitPages;
    if (!pages.length) throw new Error('Aucune image trouvée dans ce fichier');
    const out = [];
    for (let i = 0; i < pages.length; i++) {
        onStep?.(`Préparation de la page ${i + 1} sur ${pages.length}`);
        const page = await optimize(pages[i]);
        if (!KEEP_TYPES.has(page.type)) throw new Error('Format d’image non pris en charge');
        out.push(page);
    }
    return out;
}

// ---------- Envoi ----------

async function putWithRetry(url, blob) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const res = await fetch(url, { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type } });
            if (res.ok) return;
            if (res.status < 500) throw new Error(`Envoi refusé (${res.status})`);
        } catch (err) {
            if (attempt === 2) throw err;
        }
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
    throw new Error('Envoi impossible');
}

export async function uploadChapter({ profileId, itemId, num, title, pages, token, onProgress }) {
    const { uploadId, urls } = await api.chapters.prepare(
        { profileId, itemId, num, title, pages: pages.map((p) => ({ type: p.type, size: p.size })) },
        token,
    );
    let done = 0;
    try {
        let next = 0;
        await Promise.all(
            Array.from({ length: Math.min(4, pages.length) }, async () => {
                while (next < pages.length) {
                    const i = next++;
                    await putWithRetry(urls[i], pages[i]);
                    onProgress?.(++done, pages.length);
                }
            }),
        );
        return await api.chapters.commit(uploadId, token);
    } catch (err) {
        api.chapters.abort(uploadId, token).catch(() => {});
        throw err;
    }
}

export function formatBytes(n) {
    if (!n) return '0 Mo';
    if (n < 1e6) return `${Math.max(1, Math.round(n / 1e3))} Ko`;
    if (n < 1e9) return `${(n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: n < 1e7 ? 1 : 0 })} Mo`;
    return `${(n / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go`;
}

export const formatNum = (num) => String(num).replace('.', ',');
