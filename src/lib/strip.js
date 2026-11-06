// Découpage en planches d'une capture de page web (GoFullPage, captures « page entière »…).
// La capture est une longue bande : en-tête du site, planches collées les unes aux autres, bas de page.
// On recolle les morceaux, on repère la colonne du manga et on propose des coupures que l'on peut ajuster.
import { loadPdfJs } from './importer.js';

const ANALYSIS_WIDTH = 400; // largeur de travail pour l'analyse de la colonne
const PAGE_RATIO = 1.45; // hauteur / largeur habituelle d'une planche
const MAX_PAGE_WIDTH = 1600;

const toBlob = (canvas, type = 'image/webp', quality = 0.95) =>
    new Promise((resolve) => canvas.toBlob(resolve, type, quality)).then(async (blob) => {
        if (blob?.type === type) return blob;
        return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
    });

function makeCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    return canvas;
}

// ---------- Détection ----------

// Un PDF produit par une extension de capture (GoFullPage utilise jsPDF).
export async function isCapturePdf(file) {
    try {
        const pdfjs = await loadPdfJs();
        const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
        const doc = await task.promise;
        const { info } = await doc.getMetadata().catch(() => ({ info: {} }));
        await task.destroy();
        return /jspdf|gofullpage|full ?page/i.test(`${info?.Producer || ''} ${info?.Creator || ''}`);
    } catch {
        return false;
    }
}

// Des images très hautes : sans doute une capture de page entière.
export async function hasTallImages(files) {
    for (const file of files.slice(0, 4)) {
        try {
            const bitmap = await createImageBitmap(file);
            const tall = bitmap.height / bitmap.width >= 2.2;
            bitmap.close?.();
            if (tall) return true;
        } catch {
            /* image illisible : ignorée */
        }
    }
    return false;
}

// ---------- Morceaux de la capture ----------

function imageDataToCanvas(img) {
    const canvas = makeCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    if (img.bitmap) {
        ctx.drawImage(img.bitmap, 0, 0);
        return canvas;
    }
    if (!img.data) return null;
    const out = ctx.createImageData(img.width, img.height);
    const src = img.data;
    const dst = out.data;
    const pixels = img.width * img.height;
    if (src.length === pixels * 4) dst.set(src);
    else if (src.length === pixels * 3) {
        for (let i = 0, j = 0; i < pixels; i++, j += 3) {
            dst[i * 4] = src[j];
            dst[i * 4 + 1] = src[j + 1];
            dst[i * 4 + 2] = src[j + 2];
            dst[i * 4 + 3] = 255;
        }
    } else return null;
    ctx.putImageData(out, 0, 0);
    return canvas;
}

function getPdfObject(page, id) {
    const store = id.startsWith('g_') ? page.commonObjs : page.objs;
    return new Promise((resolve) => {
        try {
            store.get(id, resolve);
        } catch {
            resolve(null);
        }
    });
}

// Récupère l'image de chaque page du PDF telle quelle (sans les marges blanches de la feuille).
async function slicesFromPdf(file, onStep) {
    const pdfjs = await loadPdfJs();
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    const doc = await task.promise;
    const slices = [];
    try {
        for (let i = 1; i <= doc.numPages; i++) {
            onStep?.(`Lecture de la capture : ${i} sur ${doc.numPages}`);
            const page = await doc.getPage(i);
            const ops = await page.getOperatorList();
            const ids = [];
            ops.fnArray.forEach((fn, k) => {
                if (fn === pdfjs.OPS.paintImageXObject) ids.push(ops.argsArray[k][0]);
            });
            let canvas = null;
            if (ids.length === 1) {
                const img = await getPdfObject(page, ids[0]);
                if (img) canvas = imageDataToCanvas(img);
            }
            if (!canvas) {
                // Page sans image unique : on la dessine entièrement.
                const base = page.getViewport({ scale: 1 });
                const viewport = page.getViewport({ scale: Math.min(3, 1800 / base.width) });
                canvas = makeCanvas(viewport.width, viewport.height);
                await page.render({ canvas, viewport }).promise;
            }
            slices.push({ blob: await toBlob(canvas), width: canvas.width, height: canvas.height });
            page.cleanup();
        }
    } finally {
        await task.destroy();
    }
    return slices;
}

async function slicesFromImages(files) {
    const slices = [];
    for (const file of files) {
        const bitmap = await createImageBitmap(file);
        slices.push({ blob: file, width: bitmap.width, height: bitmap.height });
        bitmap.close?.();
    }
    return slices;
}

// ---------- Analyse ----------

function grayRows(ctx, width, height) {
    const { data } = ctx.getImageData(0, 0, width, height);
    const gray = new Uint8Array(width * height);
    for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (data[j] * 299 + data[j + 1] * 587 + data[j + 2] * 114) / 1000;
    return gray;
}

function median(values) {
    const sorted = Float64Array.from(values).sort();
    return sorted.length ? sorted[sorted.length >> 1] : 0;
}

// Repère la colonne du manga : la bande verticale qui se distingue du fond du site.
function findColumn(gray, w, h) {
    const edge = [];
    const band = Math.max(2, Math.round(w / 50));
    for (let y = 0; y < h; y += 2) {
        for (let x = 0; x < band; x++) edge.push(gray[y * w + x], gray[y * w + w - 1 - x]);
    }
    const bg = median(edge);
    const y0 = Math.floor(h * 0.1);
    const y1 = Math.ceil(h * 0.9);
    const frac = new Float64Array(w);
    for (let y = y0; y < y1; y++) {
        for (let x = 0; x < w; x++) if (Math.abs(gray[y * w + x] - bg) > 12) frac[x]++;
    }
    let best = [0, 0, w];
    for (let x = 0; x < w; ) {
        if (frac[x] / (y1 - y0) > 0.3) {
            const a = x;
            while (x < w && frac[x] / (y1 - y0) > 0.3) x++;
            if (x - a > best[0]) best = [x - a, a, x];
        } else x++;
    }
    // Rien de net : on garde toute la largeur.
    if (best[0] < w * 0.2) return { x0: 0, x1: w };
    return { x0: best[1], x1: best[2] };
}

function histMedian(row, hist) {
    hist.fill(0);
    for (let x = 0; x < row.length; x++) hist[row[x]]++;
    let n = 0;
    for (let v = 0; v < 256; v++) {
        n += hist[v];
        if (n * 2 >= row.length) return v;
    }
    return 255;
}

function rowFeatures(gray, w, h) {
    const mean = new Float32Array(h);
    const std = new Float32Array(h);
    const cover = new Float32Array(h);
    const diff = new Float32Array(h);
    const row = new Uint8Array(w);
    const hist = new Uint32Array(256);
    for (let y = 0; y < h; y++) {
        let s = 0;
        let s2 = 0;
        for (let x = 0; x < w; x++) {
            const v = gray[y * w + x];
            row[x] = v;
            s += v;
            s2 += v * v;
        }
        mean[y] = s / w;
        std[y] = Math.sqrt(Math.max(0, s2 / w - mean[y] * mean[y]));
        const med = histMedian(row, hist);
        let c = 0;
        for (let x = 0; x < w; x++) if (Math.abs(row[x] - med) > 35) c++;
        cover[y] = c / w;
        if (y > 0) {
            let d = 0;
            for (let x = 0; x < w; x++) d += Math.abs(gray[y * w + x] - gray[(y - 1) * w + x]);
            diff[y] = d / w;
        }
    }
    return { mean, std, cover, diff };
}

// Début et fin du chapitre : le plus long bloc de dessin, en ignorant l'en-tête et le bas de page du site.
function findContent({ std, cover }, w, h) {
    const art = (y) => std[y] > 28 && cover[y] > 0.25;
    const gap = Math.round(0.15 * w);
    let best = null;
    for (let y = 0; y < h; ) {
        if (!art(y)) {
            y++;
            continue;
        }
        const a = y;
        let last = y;
        let count = 0;
        while (y < h && (art(y) || y - last <= gap)) {
            if (art(y)) {
                last = y;
                count++;
            }
            y++;
        }
        if (!best || count > best.count) best = { start: a, end: last + 1, count };
    }
    if (!best) return { start: 0, end: h };
    // Retire les petits morceaux isolés aux extrémités (boutons du site, titres).
    const parts = [];
    for (let y = best.start; y < best.end; ) {
        if (!art(y)) {
            y++;
            continue;
        }
        const a = y;
        let last = y;
        while (y < best.end && (art(y) || y - last <= 6)) {
            if (art(y)) last = y;
            y++;
        }
        parts.push([a, last + 1]);
    }
    while (parts.length > 1 && parts[0][1] - parts[0][0] < 0.1 * w) parts.shift();
    while (parts.length > 1 && parts[parts.length - 1][1] - parts[parts.length - 1][0] < 0.1 * w) parts.pop();
    let start = parts[0][0];
    let end = parts[parts.length - 1][1];
    // Les bords des planches sombres se confondent avec le fond : on remonte tant que la ligne n'est pas unie.
    while (start > 0 && std[start - 1] > 3) start--;
    while (end < h && std[end] > 3) end++;
    return { start, end };
}

// Endroits où une coupure est probable : bandes unies (marges, espaces entre planches)
// et raccords nets entre deux images différentes.
function findCandidates({ std, diff }, w, start, end) {
    const out = [];
    for (let y = start + 1; y < end; ) {
        if (std[y] < 6) {
            const a = y;
            while (y < end && std[y] < 6) y++;
            const len = y - a;
            if (len >= 2) out.push({ y: Math.round((a + y) / 2), strength: Math.min(1, 0.35 + len / (0.05 * w)) });
        } else y++;
    }
    for (let y = start + 3; y < end - 3; y++) {
        if (std[y - 2] < 15 || std[y - 1] < 15 || std[y] < 15 || std[y + 1] < 15) continue;
        const near = Math.max(diff[y - 2], diff[y - 1], diff[y + 1], diff[y + 2]);
        if (diff[y] > 2.2 * near && diff[y] > 40) out.push({ y, strength: 0.75 });
    }
    return out.sort((a, b) => a.y - b.y);
}

// Choisit les coupures : des planches de hauteur régulière, coupées de préférence aux endroits probables.
function proposeCuts(candidates, w, start, end) {
    const T = PAGE_RATIO * w;
    const points = [...candidates];
    // Points neutres pour pouvoir couper même sans indice.
    for (let y = start + T / 4; y < end - T / 8; y += T / 4) points.push({ y: Math.round(y), strength: 0 });
    points.sort((a, b) => a.y - b.y);
    const nodes = [{ y: start, strength: 0 }, ...points.filter((p) => p.y > start + 0.3 * T && p.y < end - 0.3 * T), { y: end, strength: 0 }];
    const cost = (h) => {
        const r = h / T;
        if (r < 0.3) return Infinity;
        if (r >= 0.75) return 160 * Math.abs(r - 1) + (r > 1.8 ? 400 * (r - 1.8) : 0);
        return 160 * Math.abs(2 * r - 1) + 50; // double page affichée en largeur
    };
    const best = new Float64Array(nodes.length).fill(-Infinity);
    const prev = new Int32Array(nodes.length).fill(-1);
    best[0] = 0;
    for (let j = 1; j < nodes.length; j++) {
        const gain = j === nodes.length - 1 ? 0 : 100 * nodes[j].strength;
        for (let i = j - 1; i >= 0; i--) {
            const h = nodes[j].y - nodes[i].y;
            if (h > 3 * T) break;
            if (best[i] === -Infinity) continue;
            const v = best[i] + gain - cost(h);
            if (v > best[j]) {
                best[j] = v;
                prev[j] = i;
            }
        }
    }
    const cuts = [];
    let j = prev[nodes.length - 1];
    while (j > 0) {
        cuts.push(nodes[j].y);
        j = prev[j];
    }
    return cuts.reverse();
}

// ---------- Point d'entrée ----------

// Charge la capture et propose un découpage. Toutes les positions sont en pixels de la bande d'origine.
export async function loadStrip(row, onStep) {
    const slices = row.kind === 'pdf' ? await slicesFromPdf(row.files[0], onStep) : await slicesFromImages(row.files);
    if (!slices.length) throw new Error('Aucune image dans ce fichier');
    const width = Math.max(...slices.map((s) => s.width));
    let top = 0;
    for (const s of slices) {
        s.scale = width / s.width;
        s.top = top;
        s.h = Math.round(s.height * s.scale);
        top += s.h;
    }
    const height = top;

    onStep?.('Recherche des planches…');
    // 1. Colonne du manga, sur une version réduite de toute la largeur.
    const k1 = Math.min(1, 300 / width);
    const w1 = Math.round(width * k1);
    const h1 = Math.round(height * k1);
    const c1 = makeCanvas(w1, h1);
    const ctx1 = c1.getContext('2d', { willReadFrequently: true });
    for (const s of slices) {
        const bitmap = await createImageBitmap(s.blob);
        ctx1.drawImage(bitmap, 0, Math.round(s.top * k1), w1, Math.ceil(s.h * k1));
        bitmap.close?.();
    }
    const col = findColumn(grayRows(ctx1, w1, h1), w1, h1);
    const x0 = Math.max(0, Math.floor(col.x0 / k1));
    const x1 = Math.min(width, Math.ceil(col.x1 / k1));
    const colWidth = x1 - x0;

    // 2. Lignes de la colonne, à une largeur de travail fixe.
    const k2 = Math.min(1, ANALYSIS_WIDTH / colWidth);
    const w2 = Math.round(colWidth * k2);
    const h2 = Math.round(height * k2);
    const c2 = makeCanvas(w2, h2);
    const ctx2 = c2.getContext('2d', { willReadFrequently: true });
    for (const s of slices) {
        const bitmap = await createImageBitmap(s.blob);
        ctx2.drawImage(bitmap, x0 / s.scale, 0, colWidth / s.scale, s.height, 0, Math.round(s.top * k2), w2, Math.ceil(s.h * k2));
        bitmap.close?.();
    }
    const features = rowFeatures(grayRows(ctx2, w2, h2), w2, h2);
    const { start, end } = findContent(features, w2, h2);
    const candidates = findCandidates(features, w2, start, end);
    const cuts = proposeCuts(candidates, w2, start, end);

    const up = (v) => Math.round(v / k2);
    return {
        slices,
        width,
        height,
        x0,
        x1,
        start: up(start),
        end: up(end),
        cuts: cuts.map(up),
        // Positions vers lesquelles un clic est attiré (marges, raccords).
        snaps: candidates.filter((c) => c.strength >= 0.35).map((c) => up(c.y)),
    };
}

// Fabrique les planches à partir des coupures.
export async function renderPages(strip, { start, end, cuts }, onStep) {
    const bounds = [start, ...cuts.filter((c) => c > start && c < end).sort((a, b) => a - b), end];
    const colWidth = strip.x1 - strip.x0;
    const scale = Math.min(1, MAX_PAGE_WIDTH / colWidth);
    const pages = [];
    let cache = { index: -1, bitmap: null };
    const bitmapOf = async (i) => {
        if (cache.index !== i) {
            cache.bitmap?.close?.();
            cache = { index: i, bitmap: await createImageBitmap(strip.slices[i].blob) };
        }
        return cache.bitmap;
    };
    try {
        for (let p = 0; p < bounds.length - 1; p++) {
            onStep?.(`Planche ${p + 1} sur ${bounds.length - 1}`);
            const a = bounds[p];
            const b = bounds[p + 1];
            if (b - a < 8) continue;
            if ((b - a) * scale > 16000) throw new Error(`La planche ${p + 1} est trop haute : ajoute une coupure.`);
            const canvas = makeCanvas(colWidth * scale, (b - a) * scale);
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingQuality = 'high';
            for (let i = 0; i < strip.slices.length; i++) {
                const s = strip.slices[i];
                const top = Math.max(a, s.top);
                const bottom = Math.min(b, s.top + s.h);
                if (bottom <= top) continue;
                const bitmap = await bitmapOf(i);
                ctx.drawImage(
                    bitmap,
                    strip.x0 / s.scale,
                    (top - s.top) / s.scale,
                    colWidth / s.scale,
                    (bottom - top) / s.scale,
                    0,
                    (top - a) * scale,
                    canvas.width,
                    (bottom - top) * scale,
                );
            }
            pages.push(await toBlob(canvas, 'image/webp', 0.9));
        }
    } finally {
        cache.bitmap?.close?.();
    }
    return pages;
}
