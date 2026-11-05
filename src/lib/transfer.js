// Export / import d'un profil en fichier JSON.
// L'import accepte les fichiers de la nouvelle version comme ceux de l'ancienne.
import { newItem } from './items.js';

export function buildExport(profileName, library) {
    return {
        format: 'liste-anime-manga',
        version: 2,
        profileName,
        exportDate: new Date().toISOString(),
        items: library.items,
        lastKnownTotals: library.lastKnownTotals || {},
    };
}

export function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

// Renvoie { profileName, items, lastKnownTotals } ou lève une erreur lisible.
export function parseImport(text) {
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error('Ce fichier n’est pas un JSON valide.');
    }

    if (data?.format === 'liste-anime-manga' && Array.isArray(data.items)) {
        return { profileName: data.profileName || 'Profil', items: data.items, lastKnownTotals: data.lastKnownTotals || {} };
    }

    // Ancienne version : { profileName, profile: { library, imageCache, … } } ou le profil seul.
    const legacy = data?.profile && data?.profileName ? data.profile : data?.library !== undefined && data?.name ? data : null;
    if (legacy && Array.isArray(legacy.library)) {
        const items = legacy.library
            .filter((it) => it?.title)
            .map((it) => ({
                ...newItem({ title: it.title, type: it.type === 'Anime' ? 'Anime' : 'Manga' }),
                ...it,
                id: crypto.randomUUID(),
                imageUrl: legacy.imageCache?.[`${it.title}-${it.type}`] || null,
            }));
        return { profileName: data.profileName || legacy.name, items, lastKnownTotals: legacy.lastKnownTotals || {} };
    }

    throw new Error('Ce fichier ne ressemble pas à un export de profil.');
}
