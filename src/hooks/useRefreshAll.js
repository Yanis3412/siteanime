// « Tout mettre à jour » : recharge statut, total et couverture de chaque œuvre (AniList, MyAnimeList en secours).
import { useCallback } from 'react';
import { useApp } from '../state/app.jsx';
import { useUi } from '../state/ui.jsx';
import { findEntries, summarize } from '../lib/meta.js';

const CHUNK = 50;

export function useRefreshAll() {
    const { library, updateItem, setTask } = useApp();
    const { toast } = useUi();

    return useCallback(async () => {
        const items = library?.items || [];
        if (!items.length) return toast('Ta liste est vide.');
        let updated = 0;
        let missing = 0;
        setTask({ label: 'Mise à jour', done: 0, total: items.length });
        try {
            for (let start = 0; start < items.length; start += CHUNK) {
                const chunk = items.slice(start, start + CHUNK);
                const entries = await findEntries(chunk, { fresh: true });
                chunk.forEach((item, k) => {
                    const info = summarize(entries[k]);
                    if (!info) return missing++;
                    updated++;
                    updateItem(
                        item.id,
                        (it) => ({
                            ...it,
                            malId: it.malId || info.malId,
                            anilistId: info.anilistId || it.anilistId,
                            status: info.status,
                            total: it.seasons?.length ? it.total : info.total || it.total,
                            imageUrl: info.imageUrl || it.imageUrl,
                        }),
                        { touch: false },
                    );
                });
                setTask({ label: 'Mise à jour', done: Math.min(start + CHUNK, items.length), total: items.length });
            }
            toast(missing ? `${updated} titres mis à jour, ${missing} introuvables.` : `${updated} titres mis à jour.`, { tone: missing ? 'info' : 'success' });
        } catch (err) {
            toast(updated ? `${updated} titres mis à jour. ${err.message}` : err.message, { tone: 'error' });
        } finally {
            setTask(null);
        }
    }, [library, updateItem, setTask, toast]);
}
