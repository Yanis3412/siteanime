// « Tout mettre à jour » : recharge statut, total et couverture de chaque œuvre depuis MyAnimeList.
import { useCallback } from 'react';
import { useApp } from '../state/app.jsx';
import { useUi } from '../state/ui.jsx';
import { findEntry, summarize } from '../lib/jikan.js';

export function useRefreshAll() {
    const { library, updateItem, setTask } = useApp();
    const { toast } = useUi();

    return useCallback(async () => {
        const items = library?.items || [];
        if (!items.length) return toast('Ta liste est vide.');
        let updated = 0;
        let failed = 0;
        setTask({ label: 'Mise à jour', done: 0, total: items.length });
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            try {
                const info = summarize(await findEntry(item, { fresh: true }), item.type);
                if (info) {
                    updateItem(
                        item.id,
                        (it) => ({
                            ...it,
                            malId: info.malId,
                            status: info.status,
                            total: it.seasons?.length ? it.total : info.total || it.total,
                            imageUrl: info.imageUrl || it.imageUrl,
                        }),
                        { touch: false },
                    );
                    updated++;
                } else {
                    failed++;
                }
            } catch {
                failed++;
            }
            setTask({ label: 'Mise à jour', done: i + 1, total: items.length });
        }
        setTask(null);
        toast(
            failed
                ? `${updated} titres mis à jour, ${failed} introuvables ou en erreur.`
                : `${updated} titres mis à jour.`,
            { tone: failed ? 'info' : 'success' },
        );
    }, [library, updateItem, setTask, toast]);
}
