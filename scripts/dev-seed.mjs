// Crée de fausses données "ancienne version" dans .dev-kv.json pour tester la migration en local.
// Usage : npm run seed:dev   (puis npm run dev)
// Codes de test : Admin = 1111, Sam = 2222
import fs from 'node:fs';

const legacy = {
    profiles: {
        default: {
            id: 'default',
            name: 'Admin',
            password: '1111',
            isAdmin: true,
            library: [
                { title: 'One Piece', type: 'Manga', current: 1150, total: 1165, malId: 13, status: 'ongoing', note: 'Arc Elbaf en cours' },
                { title: 'Vagabond', type: 'Manga', current: 120, total: 327, malId: 656, status: 'completed' },
                { title: 'Frieren: Beyond Journey’s End', type: 'Manga', current: 40, total: null, malId: 126287, status: 'ongoing', fav: true },
                {
                    title: 'Shingeki no Kyojin', type: 'Anime', current: 0, total: null, malId: 16498, status: 'completed', recommended: true,
                    seasons: [
                        { malId: 16498, name: 'Shingeki no Kyojin', episodes: 25, aired: 1365206400000, status: 'completed', seasonNumber: 1 },
                        { malId: 25777, name: 'Shingeki no Kyojin Season 2', episodes: 12, aired: 1491004800000, status: 'completed', seasonNumber: 2 },
                        { malId: 35760, name: 'Shingeki no Kyojin Season 3', episodes: 12, aired: 1532217600000, status: 'completed', seasonNumber: 3 },
                    ],
                    seasonProgress: [25, 12, 4],
                },
                { title: 'Sousou no Frieren', type: 'Anime', current: 28, total: 28, malId: 52991, status: 'completed', recommended: true },
                { title: 'Dandadan', type: 'Anime', current: 5, total: 12, malId: 57334, status: 'ongoing' },
            ],
            imageCache: {
                'One Piece-Manga': 'https://cdn.myanimelist.net/images/manga/2/253146l.jpg',
                'Vagabond-Manga': 'https://cdn.myanimelist.net/images/manga/1/259070l.jpg',
                'Shingeki no Kyojin-Anime': 'https://cdn.myanimelist.net/images/anime/10/47347l.jpg',
                'Sousou no Frieren-Anime': 'https://cdn.myanimelist.net/images/anime/1015/138006l.jpg',
            },
            malInfoCache: {},
            lastUpdateCheck: 0,
            lastKnownTotals: { 13: 1165 },
        },
        profile_1700000000000: {
            id: 'profile_1700000000000',
            name: 'Sam',
            password: '2222',
            isAdmin: false,
            library: [
                { title: 'Berserk', type: 'Manga', current: 370, total: null, malId: 2, status: 'ongoing', recommended: true },
                { title: 'Chainsaw Man', type: 'Anime', current: 12, total: 12, malId: 44511, status: 'completed', recommended: true },
            ],
            imageCache: {},
        },
        broken: { id: 'broken', name: 'undefined' },
    },
};

const store = { 'anime-profiles': { value: JSON.stringify(legacy), exp: null } };
fs.writeFileSync('.dev-kv.json', JSON.stringify(store, null, 2));
console.log('Données de test créées dans .dev-kv.json');
