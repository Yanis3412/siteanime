// Actions communes sur une œuvre (carte et page détail).
import { useCallback, useMemo } from 'react';
import { useApp } from '../state/app.jsx';
import { useUi } from '../state/ui.jsx';
import { fetchSeasons, findEntry, summarize } from '../lib/jikan.js';
import { api } from '../lib/api.js';

export function useItemActions() {
    const { updateItem, removeItem, session, writeTokenFor } = useApp();
    const { toast, confirm } = useUi();

    const refresh = useCallback(
        async (item) => {
            toast(`Actualisation de ${item.title}…`, { duration: 2500 });
            try {
                const info = summarize(await findEntry(item, { fresh: true }), item.type);
                if (!info) return toast(`Aucune fiche MyAnimeList trouvée pour ${item.title}.`, { tone: 'error' });
                let seasons = null;
                if (item.type === 'Anime') {
                    const list = await fetchSeasons(info.malId);
                    if (list.length > 1) seasons = list;
                }
                updateItem(
                    item.id,
                    (it) => {
                        const next = { ...it, malId: info.malId, status: info.status, imageUrl: info.imageUrl || it.imageUrl };
                        if (seasons) {
                            // On garde la progression déjà saisie, saison par saison.
                            next.seasons = seasons;
                            next.seasonProgress = seasons.map((_, i) => it.seasonProgress?.[i] || 0);
                        } else {
                            next.total = info.total || it.total;
                        }
                        return next;
                    },
                    { touch: false },
                );
                toast(seasons ? `${item.title} : ${seasons.length} saisons trouvées.` : `${item.title} est à jour.`, { tone: 'success' });
            } catch {
                toast('MyAnimeList ne répond pas. Réessaie dans un moment.', { tone: 'error' });
            }
        },
        [toast, updateItem],
    );

    const remove = useCallback(
        async (item) => {
            const ok = await confirm({
                title: `Supprimer ${item.title} ?`,
                message: 'Le titre et ta progression seront retirés de ta liste.',
                confirmLabel: 'Supprimer',
                danger: true,
            });
            if (ok) {
                removeItem(item.id);
                toast(`${item.title} supprimé.`);
                // Les chapitres importés pour ce titre sont effacés du stockage.
                if (item.type === 'Manga' && session) {
                    api.chapters.removeAll(session.profileId, item.id, writeTokenFor(session.profileId)).catch(() => {});
                }
            }
            return ok;
        },
        [confirm, removeItem, toast, session, writeTokenFor],
    );

    return useMemo(
        () => ({
            update: updateItem,
            refresh,
            remove,
            toggleWatchlist: (item) => {
                updateItem(item.id, { fav: !item.fav });
                toast(item.fav ? `${item.title} retiré de la watchlist.` : `${item.title} ajouté à la watchlist.`);
            },
            toggleRecommended: (item) => {
                updateItem(item.id, { recommended: !item.recommended });
                toast(item.recommended ? `Tu ne recommandes plus ${item.title}.` : `${item.title} est recommandé aux autres profils.`);
            },
        }),
        [updateItem, refresh, remove, toast],
    );
}
