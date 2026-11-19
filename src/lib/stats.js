// Chiffres d'un profil.
export const EPISODE_MINUTES = 23;
// Temps passé devant les animes, à partir du nombre d'épisodes.
export function watchTime(episodes) {
    const hours = Math.round((episodes * EPISODE_MINUTES) / 60);
    if (hours < 1) return episodes ? 'moins d’1 h' : '0 h';
    if (hours < 48) return `${hours} h`;
    const days = Math.floor(hours / 24);
    const rest = hours % 24;
    return rest ? `${days} j ${rest} h` : `${days} j`;
}
