// Initialisation du state
let library = [];
let selectedIndex = null;
let imageCache = {};
let malInfoCache = {};
let lastUpdateCheck = 0;
let currentView = 'manga'; // 'manga' ou 'anime'
let currentDetailIndex = null; // Index de l'élément affiché dans le panneau
let lastKnownTotals = {}; // Pour suivre les totaux connus (chapitres/épisodes)
const API_URL = '/api/data';

// Charger les données au démarrage
async function loadData() {
    try {
        const response = await fetch(API_URL);
        if (response.ok) {
            const data = await response.json();
            library = data.library || [];
            imageCache = data.imageCache || {};
            malInfoCache = data.malInfoCache || {};
            lastUpdateCheck = data.lastUpdateCheck || 0;
            console.log('✅ Données chargées depuis le serveur');
        } else {
            throw new Error('Erreur de chargement');
        }
    } catch (error) {
        console.error('⚠️ Erreur lors du chargement, utilisation du localStorage:', error);
        // Fallback au localStorage en cas d'erreur
        library = JSON.parse(localStorage.getItem('viegoList')) || [];
        imageCache = JSON.parse(localStorage.getItem('imageCache')) || {};
        malInfoCache = JSON.parse(localStorage.getItem('malInfoCache')) || {};
        lastUpdateCheck = parseInt(localStorage.getItem('lastUpdateCheck')) || 0;
    }
    renderList();
    checkForUpdates();
}

// Sauvegarder les données
async function saveData() {
    try {
        const data = {
            library,
            imageCache,
            malInfoCache,
            lastUpdateCheck
        };
        
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            throw new Error('Erreur lors de la sauvegarde');
        }

        console.log('✅ Données sauvegardées sur le serveur');
    } catch (error) {
        console.error('⚠️ Erreur lors de la sauvegarde, utilisation du localStorage:', error);
        // Fallback au localStorage
        localStorage.setItem('viegoList', JSON.stringify(library));
        localStorage.setItem('imageCache', JSON.stringify(imageCache));
        localStorage.setItem('malInfoCache', JSON.stringify(malInfoCache));
        localStorage.setItem('lastUpdateCheck', lastUpdateCheck.toString());
    }
}

function switchView(view) {
    currentView = view;
    document.getElementById('mangaToggle').classList.toggle('active', view === 'manga');
    document.getElementById('animeToggle').classList.toggle('active', view === 'anime');
    renderList();
}

async function saveAndRender() {
    await saveData();
    renderList();
}

// Vérifie et met à jour les totaux au chargement (max 1 fois par heure)
async function checkForUpdates() {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    
    if (now - lastUpdateCheck < oneHour) {
        console.log('Mise à jour déjà effectuée récemment');
        return;
    }
    
    console.log('Vérification des mises à jour...');
    let hasUpdates = false;
    
    for (let i = 0; i < library.length; i++) {
        const item = library[i];
        // Ne vérifie que les séries en cours (pas de total ou marquées ongoing)
        if (item.status === 'completed') continue;
        
        try {
            // Attendre un peu entre chaque requête pour éviter le rate limit
            await new Promise(resolve => setTimeout(resolve, 350));
            
            const info = await fetchMalInfo(item.title, item.type, item.malId);
            if (info) {
                // Mettre à jour le malId si on ne l'a pas
                if (!item.malId && info.malId) {
                    library[i].malId = info.malId;
                    hasUpdates = true;
                }
                
                // Mettre à jour le statut
                if (item.status !== info.status) {
                    library[i].status = info.status;
                    hasUpdates = true;
                }
                
                // Mettre à jour le total si différent et qu'on a une nouvelle valeur
                if (info.total && info.total !== item.total) {
                    library[i].total = info.total;
                    hasUpdates = true;
                }
            }
        } catch (error) {
            console.error(`Erreur pour ${item.title}:`, error);
        }
    }
    
    if (hasUpdates) {
        saveData();
        renderList();
        console.log('Mises à jour appliquées!');
    }
    
    lastUpdateCheck = now;
}

async function fetchMalInfo(title, type, malId = null) {
    const cacheKey = malId ? `mal-${malId}` : `${title}-${type}`;
    
    try {
        const searchType = type === 'Anime' ? 'anime' : 'manga';
        let url;
        
        if (malId) {
            // Si on a l'ID MAL, on fait une requête directe
            url = `https://api.jikan.moe/v4/${searchType}/${malId}`;
        } else {
            // Sinon on cherche par titre
            url = `https://api.jikan.moe/v4/${searchType}?q=${encodeURIComponent(title)}&limit=1`;
        }
        
        const response = await fetch(url);
        const data = await response.json();
        
        let item;
        if (malId) {
            item = data.data;
        } else {
            item = data.data && data.data.length > 0 ? data.data[0] : null;
        }
        
        if (item) {
            const total = type === 'Anime' ? item.episodes : item.chapters;
            const status = item.status === 'Currently Airing' || item.status === 'Publishing' 
                ? 'ongoing' 
                : (item.status === 'Finished Airing' || item.status === 'Finished' ? 'completed' : 'unknown');
            
            return {
                malId: item.mal_id,
                total: total || null,
                status: status,
                imageUrl: item.images.jpg.large_image_url || item.images.jpg.image_url,
                title: item.title
            };
        }
    } catch (error) {
        console.error('Error fetching MAL info:', error);
    }
    return null;
}

// Récupérer toutes les saisons d'un anime
async function fetchAllSeasons(malId) {
    try {
        console.log(`Recherche des relations pour l'anime ID: ${malId}`);
        const response = await fetch(`https://api.jikan.moe/v4/anime/${malId}/relations`);
        const data = await response.json();
        
        if (!data.data) {
            console.log('Pas de données de relations');
            return [];
        }
        
        const seasons = [];
        
        // Chercher les sequels, prequels, et aussi les "alternative versions" et "side stories"
        for (const relation of data.data) {
            console.log(`Relation trouvée: ${relation.relation}`);
            if (relation.relation === 'Sequel' || relation.relation === 'Prequel' || 
                relation.relation === 'Parent story' || relation.relation === 'Side story') {
                for (const entry of relation.entry) {
                    seasons.push({
                        malId: entry.mal_id,
                        name: entry.name,
                        relation: relation.relation
                    });
                }
            }
        }
        
        console.log(`Total de ${seasons.length} anime(s) lié(s) trouvé(s)`);
        return seasons;
    } catch (error) {
        console.error('Error fetching seasons:', error);
        return [];
    }
}

// Récupérer les détails de toutes les saisons d'un anime
async function fetchAnimeWithSeasons(title, type) {
    if (type !== 'Anime') {
        return await fetchMalInfo(title, type);
    }
    
    console.log(`=== Recherche des saisons pour: ${title} ===`);
    
    // D'abord, récupérer l'anime principal
    const mainInfo = await fetchMalInfo(title, type);
    if (!mainInfo) {
        console.log('Anime principal non trouvé');
        return null;
    }
    
    console.log(`Anime principal trouvé: ID ${mainInfo.malId}`);
    
    // Récupérer les relations
    await new Promise(resolve => setTimeout(resolve, 400));
    const relations = await fetchAllSeasons(mainInfo.malId);
    
    // Collecter tous les IDs d'anime liés (sequels et prequels)
    const allAnimeIds = new Set([mainInfo.malId]);
    const toProcess = [...relations];
    const processedIds = new Set([mainInfo.malId]);
    
    // Limiter la profondeur de recherche
    let iterations = 0;
    while (toProcess.length > 0 && iterations < 15) {
        const rel = toProcess.shift();
        if (!processedIds.has(rel.malId)) {
            processedIds.add(rel.malId);
            allAnimeIds.add(rel.malId);
            iterations++;
            
            console.log(`Exploration des relations de: ${rel.name}`);
            
            // Récupérer les relations de cet anime aussi
            await new Promise(resolve => setTimeout(resolve, 400));
            const subRelations = await fetchAllSeasons(rel.malId);
            for (const subRel of subRelations) {
                if (!processedIds.has(subRel.malId) && !toProcess.find(r => r.malId === subRel.malId)) {
                    toProcess.push(subRel);
                }
            }
        }
    }
    
    console.log(`Total d'animes à récupérer: ${allAnimeIds.size}`);
    
    // Récupérer les détails de tous les animes
    const allSeasons = [];
    for (const id of allAnimeIds) {
        await new Promise(resolve => setTimeout(resolve, 400));
        try {
            console.log(`Récupération des détails de l'anime ID: ${id}`);
            const response = await fetch(`https://api.jikan.moe/v4/anime/${id}`);
            const data = await response.json();
            if (data.data) {
                const anime = data.data;
                allSeasons.push({
                    malId: anime.mal_id,
                    name: anime.title,
                    episodes: anime.episodes,
                    aired: new Date(anime.aired?.from || 0).getTime(),
                    status: anime.status === 'Currently Airing' ? 'ongoing' : 'completed',
                    imageUrl: anime.images.jpg.large_image_url || anime.images.jpg.image_url
                });
                console.log(`  -> ${anime.title}: ${anime.episodes || '?'} épisodes`);
            }
        } catch (error) {
            console.error(`Error fetching anime ${id}:`, error);
        }
    }
    
    // Trier par date de diffusion
    allSeasons.sort((a, b) => {
        if (!a.aired) return 1;
        if (!b.aired) return -1;
        return a.aired - b.aired;
    });
    
    // Numéroter les saisons
    allSeasons.forEach((season, index) => {
        season.seasonNumber = index + 1;
    });
    
    return {
        ...mainInfo,
        seasons: allSeasons
    };
}

function renderList() {
    const mangaContainer = document.getElementById('mangaListContainer');
    const animeContainer = document.getElementById('animeListContainer');
    const favContainer = document.getElementById('favListContainer');
    const sitesContainer = document.getElementById('sitesListContainer');
    const favCount = document.getElementById('favCount');

    mangaContainer.innerHTML = '';
    animeContainer.innerHTML = '';
    favContainer.innerHTML = '';
    sitesContainer.innerHTML = '';

    const animes = library.filter(item => item.type === 'Anime').sort((a, b) => a.title.localeCompare(b.title));
    const mangas = library.filter(item => item.type === 'Manga').sort((a, b) => a.title.localeCompare(b.title));
    const favs = library.filter(item => item.fav === true);

    favCount.textContent = `(${favs.length})`;

    // Mangas
    if (mangas.length === 0) {
        mangaContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📖</div>
                <p class="empty-state-text">Aucun manga dans ta liste</p>
                <p class="empty-state-subtext">Ajoute-en un pour commencer ton tracking!</p>
            </div>
        `;
    } else {
        mangas.forEach((item) => {
            const index = library.indexOf(item);
            renderSimpleCard(mangaContainer, item, index, '📖', imageCache[`${item.title}-${item.type}`]);
        });
    }

    // Animes
    if (animes.length === 0) {
        animeContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📺</div>
                <p class="empty-state-text">Aucun anime dans ta liste</p>
                <p class="empty-state-subtext">Ajoute-en un pour commencer ton tracking!</p>
            </div>
        `;
    } else {
        animes.forEach((item) => {
            const index = library.indexOf(item);
            if (item.seasons && item.seasons.length > 1) {
                renderCardWithSeasons(animeContainer, item, index, '📺', imageCache[`${item.title}-${item.type}`]);
            } else {
                renderSimpleCard(animeContainer, item, index, '📺', imageCache[`${item.title}-${item.type}`]);
            }
        });
    }

    // Favoris
    if (favs.length === 0) {
        favContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">⭐</div>
                <p class="empty-state-text">Aucun favori</p>
                <p class="empty-state-subtext">Clique sur l'étoile pour ajouter un favori !</p>
            </div>
        `;
    } else {
        favs.forEach((item) => {
            const index = library.indexOf(item);
            if (item.seasons && item.seasons.length > 1) {
                renderCardWithSeasons(favContainer, item, index, item.type === 'Anime' ? '📺' : '📖', imageCache[`${item.title}-${item.type}`], true);
            } else {
                renderSimpleCard(favContainer, item, index, item.type === 'Anime' ? '📺' : '📖', imageCache[`${item.title}-${item.type}`], true);
            }
        });
    }

    // Sites
    const mangaSites = [
        { name: 'Lel Manga', url: 'https://www.lelmanga.com/manga', icon: '📚' },
        { name: 'Crunchyscan', url: 'https://crunchyscan.fr/', icon: '📖' },
        { name: 'Manga Plus', url: 'https://mangaplus.shueisha.co.jp/updates', icon: '⭐' },
        { name: 'Sushi Scan', url: 'https://sushiscan.net/', icon: '🍣' },
        { name: 'Asura Comic', url: 'https://asuracomic.net/', icon: '🔥' }
    ];

    const animeSites = [
        { name: 'Crunchyroll', url: 'https://www.crunchyroll.com/fr/discover', icon: '📺' },
        { name: 'Anime Sama', url: 'https://anime-sama.eu/', icon: '✨' }
    ];

    const siteCard = document.createElement('div');
    siteCard.className = 'site-card';
    
    let sitesHTML = '';
    
    // Manga Sites
    sitesHTML += '<div class="site-category">📖 Sites Manga</div>';
    mangaSites.forEach(site => {
        sitesHTML += `
            <a href="${site.url}" target="_blank" rel="noopener noreferrer" class="site-link" title="${site.name}">
                <span class="site-link-icon">${site.icon}</span>
                <span class="site-link-text">${site.name}</span>
                <span class="site-link-arrow">↗</span>
            </a>
        `;
    });
    
    sitesHTML += '<div class="site-category" style="margin-top: 20px;">📺 Sites Anime</div>';
    animeSites.forEach(site => {
        sitesHTML += `
            <a href="${site.url}" target="_blank" rel="noopener noreferrer" class="site-link" title="${site.name}">
                <span class="site-link-icon">${site.icon}</span>
                <span class="site-link-text">${site.name}</span>
                <span class="site-link-arrow">↗</span>
            </a>
        `;
    });
    
    siteCard.innerHTML = sitesHTML;
    sitesContainer.appendChild(siteCard);
}

// Ajout du bouton favori dans les cartes
function renderSimpleCard(container, item, index, icon, cachedImage, isFavSection = false) {
    const totalDisplay = item.total ? item.total : '?';
    const percentage = item.total ? Math.round((item.current / item.total) * 100) : 0;
    const isActive = selectedIndex === index;
    
    // Badge de statut
    let statusBadge = '';
    if (item.status === 'ongoing') {
        statusBadge = '<span class="status-ongoing">En cours</span>';
    } else if (item.status === 'completed' || (item.total && item.current >= item.total)) {
        statusBadge = '<span class="status-completed">Terminé</span>';
    }
    
    // Badge de type avec info d'épisodes/chapitres
    const episodeLabel = item.type === 'Anime' ? 'épisodes' : 'chapitres';
    const typeBadgeText = item.total ? `${item.type} (${item.total} ${episodeLabel})` : `${item.type} (?)`;
    
    const card = document.createElement('div');
    card.className = `card ${isActive ? 'active' : ''}`;
    card.onclick = (e) => {
        // Ne pas ouvrir le panneau si on clique sur un bouton ou input
        if (e.target.closest('button') || e.target.closest('input')) return;
        openDetailPanel(index);
    };
    
    const iconHtml = cachedImage 
        ? `<img src="${cachedImage}" alt="${item.title}" onerror="this.parentElement.innerHTML='<div class=card-icon-fallback>${icon}</div>'">`
        : `<div class="card-icon-fallback">${icon}</div>`;
    
    const favBtn = `<button class="btn-control" onclick="event.stopPropagation(); toggleFavWrapper(${index})" title="Favori">${item.fav ? '⭐' : '☆'}</button>`;
    card.innerHTML = `
        <div class="card-icon" data-index="${index}">${iconHtml}</div>
        <div class="card-info">
            <h3 class="card-title">${item.title}</h3>
            <div class="card-meta">
                <span class="card-type">${typeBadgeText}</span>
                ${statusBadge}
                <div class="progress-bar-container">
                    <div class="progress-bar" style="width: ${percentage}%"></div>
                </div>
            </div>
        </div>
        <div class="card-controls" onclick="event.stopPropagation()">
            <button class="btn-control" onclick="updateProgressWrapper(${index}, -1)">−</button>
            <span class="progress-count">
                <input type="number" class="editable-value" value="${item.current}" 
                    onchange="setProgressWrapper(${index}, this.value)"
                    min="0" ${item.total ? `max="${item.total}"` : ''}>
                <span>/</span>
                <input type="number" class="editable-total" value="${item.total || ''}" 
                    onchange="setTotalWrapper(${index}, this.value)">
            </span>
            <button class="btn-control" onclick="updateProgressWrapper(${index}, 1)">+</button>
        </div>
        <div class="card-actions" onclick="event.stopPropagation()">
            ${favBtn}
            <button class="refresh-item-btn" onclick="refreshItemWithSeasonsWrapper(${index})" title="Rafraîchir & chercher saisons">🔄</button>
            <button class="edit-btn" onclick="openEditModal(${index})">✏️</button>
            <button class="delete-btn" onclick="deleteItemWrapper(${index})">🗑️</button>
        </div>
    `;
    container.appendChild(card);
    
    if (!cachedImage) {
        fetchCardImage(item.title, item.type, index);
    }
}

function renderCardWithSeasons(container, item, index, icon, cachedImage, isFavSection = false) {
    const isExpanded = item.expanded || false;
    const isActive = selectedIndex === index;
    
    let totalEpisodes = 0;
    let watchedEpisodes = 0;
    item.seasons.forEach((season, sIndex) => {
        const seasonProgress = item.seasonProgress?.[sIndex] || 0;
        totalEpisodes += season.episodes || 0;
        watchedEpisodes += seasonProgress;
    });
    
    const percentage = totalEpisodes > 0 ? Math.round((watchedEpisodes / totalEpisodes) * 100) : 0;
    
    const lastSeason = item.seasons[item.seasons.length - 1];
    let statusBadge = '';
    if (lastSeason?.status === 'ongoing') {
        statusBadge = '<span class="status-ongoing">En cours</span>';
    } else if (watchedEpisodes >= totalEpisodes && totalEpisodes > 0) {
        statusBadge = '<span class="status-completed">Terminé</span>';
    }
    
    const cardGroup = document.createElement('div');
    cardGroup.className = `card-group ${isExpanded ? 'expanded' : ''} ${isActive ? 'active' : ''}`;
    
    const iconHtml = cachedImage 
        ? `<img src="${cachedImage}" alt="${item.title}" onerror="this.parentElement.innerHTML='<div class=card-icon-fallback>${icon}</div>'">`
        : `<div class="card-icon-fallback">${icon}</div>`;
    
    let seasonsHtml = '';
    item.seasons.forEach((season, sIndex) => {
        const seasonProgress = item.seasonProgress?.[sIndex] || 0;
        const seasonTotal = season.episodes || '?';
        
        seasonsHtml += `
            <div class="season-card">
                <div class="season-info">
                    <div class="season-title">Saison ${season.seasonNumber}: ${season.name}</div>
                    <div class="season-episodes">${seasonProgress} / ${seasonTotal} épisodes</div>
                </div>
                <div class="card-controls">
                    <button class="btn-control" onclick="updateSeasonProgressWrapper(${index}, ${sIndex}, -1)">−</button>
                    <span class="progress-count">
                        <input type="number" class="editable-value" value="${seasonProgress}" 
                            onchange="setSeasonProgressWrapper(${index}, ${sIndex}, this.value)"
                            min="0" ${seasonTotal !== '?' ? `max="${seasonTotal}"` : ''}>
                        <span>/</span>
                        <span>${seasonTotal}</span>
                    </span>
                    <button class="btn-control" onclick="updateSeasonProgressWrapper(${index}, ${sIndex}, 1)">+</button>
                </div>
            </div>
        `;
    });
    
    const favBtn = `<button class="btn-control" onclick="event.stopPropagation(); toggleFavWrapper(${index})" title="Favori">${item.fav ? '⭐' : '☆'}</button>`;
    cardGroup.innerHTML = `
        <div class="card-group-header" onclick="toggleExpandWrapper(${index})">
            <button class="expand-btn">▶</button>
            <div class="card-icon" data-index="${index}">${iconHtml}</div>
            <div class="card-info">
                <h3 class="card-title">${item.title}</h3>
                <div class="card-meta">
                    <span class="card-type">Anime (${totalEpisodes} épisodes)</span>
                    ${statusBadge}
                    <div class="progress-bar-container">
                        <div class="progress-bar" style="width: ${percentage}%"></div>
                    </div>
                </div>
            </div>
            <div class="progress-count" style="margin-right: 10px;">
                <strong>${watchedEpisodes}</strong> / ${totalEpisodes}
            </div>
            <div class="card-actions">
                ${favBtn}
                <button class="refresh-item-btn" onclick="event.stopPropagation(); refreshItemWithSeasonsWrapper(${index})" title="Rafraîchir">🔄</button>
                <button class="edit-btn" onclick="event.stopPropagation(); openEditModal(${index})">✏️</button>
                <button class="delete-btn" onclick="event.stopPropagation(); deleteItemWrapper(${index})">🗑️</button>
            </div>
        </div>
        <div class="seasons-container">
            ${seasonsHtml}
        </div>
    `;
    
    container.appendChild(cardGroup);
    
    if (!cachedImage) {
        fetchCardImage(item.title, item.type, index);
    }
}

async function toggleExpand(index) {
    library[index].expanded = !library[index].expanded;
    await saveData();
    renderList();
}

async function updateSeasonProgress(index, seasonIndex, change) {
    if (!library[index].seasonProgress) {
        library[index].seasonProgress = [];
    }
    
    const currentProgress = library[index].seasonProgress[seasonIndex] || 0;
    const newProgress = currentProgress + change;
    const maxEpisodes = library[index].seasons[seasonIndex]?.episodes;
    
    if (newProgress >= 0 && (!maxEpisodes || newProgress <= maxEpisodes)) {
        library[index].seasonProgress[seasonIndex] = newProgress;
        await saveData();
        renderList();
    }
}

async function setSeasonProgress(index, seasonIndex, value) {
    if (!library[index].seasonProgress) {
        library[index].seasonProgress = [];
    }
    
    const newValue = parseInt(value) || 0;
    const maxEpisodes = library[index].seasons[seasonIndex]?.episodes;
    
    if (newValue >= 0 && (!maxEpisodes || newValue <= maxEpisodes)) {
        library[index].seasonProgress[seasonIndex] = newValue;
        await saveData();
        renderList();
    }
}

async function refreshItemWithSeasons(index) {
    const item = library[index];
    const card = document.querySelector(`[data-index="${index}"]`)?.closest('.card, .card-group');
    if (card) {
        card.style.opacity = '0.5';
        card.style.pointerEvents = 'none';
    }
    
    const cacheKey = `${item.title}-${item.type}`;
    delete imageCache[cacheKey];
    localStorage.setItem('imageCache', JSON.stringify(imageCache));
    
    // Sauvegarder la progression actuelle
    const currentProgress = item.current || 0;
    const currentSeasonProgress = item.seasonProgress ? [...item.seasonProgress] : [];
    
    delete library[index].seasons;
    delete library[index].seasonProgress;
    library[index].malId = null;
    
    try {
        if (item.type === 'Anime') {
            const info = await fetchAnimeWithSeasons(item.title, item.type);
            
            if (info) {
                library[index].malId = info.malId;
                library[index].status = info.status;
                
                if (info.seasons && info.seasons.length > 1) {
                    library[index].seasons = info.seasons;
                    // Restaurer la progression des saisons si elle existe, sinon mettre 0
                    library[index].seasonProgress = info.seasons.map((_, i) => currentSeasonProgress[i] || 0);
                    alert(`✅ ${info.seasons.length} saisons trouvées!`);
                } else {
                    library[index].total = info.total || null;
                    // Garder la progression actuelle
                    library[index].current = currentProgress;
                }
                
                if (info.imageUrl) {
                    const cacheKey = `${item.title}-${item.type}`;
                    imageCache[cacheKey] = info.imageUrl;
                    localStorage.setItem('imageCache', JSON.stringify(imageCache));
                }
                
                await saveAndRender();
            }
        } else {
            await refreshItem(index);
        }
    } catch (error) {
        console.error('Error refreshing item:', error);
    } finally {
        if (card) {
            card.style.opacity = '1';
            card.style.pointerEvents = 'auto';
        }
    }
}

async function fetchCardImage(title, type, index) {
    const cacheKey = `${title}-${type}`;
    
    try {
        const searchType = type === 'Anime' ? 'anime' : 'manga';
        const response = await fetch(`https://api.jikan.moe/v4/${searchType}?q=${encodeURIComponent(title)}&limit=1`);
        const data = await response.json();
        
        if (data.data && data.data.length > 0) {
            const imageUrl = data.data[0].images.jpg.large_image_url || data.data[0].images.jpg.image_url;
            imageCache[cacheKey] = imageUrl;
            localStorage.setItem('imageCache', JSON.stringify(imageCache));
            
            const cardIcon = document.querySelector(`.card-icon[data-index="${index}"]`);
            if (cardIcon) {
                cardIcon.innerHTML = `<img src="${imageUrl}" alt="${title}" onerror="this.parentElement.innerHTML='<div class=card-icon-fallback>${type === 'Anime' ? '📺' : '📖'}</div>'">`;
            }
        }
    } catch (error) {
        console.error('Error fetching card image:', error);
    }
}

async function addItem() {
    const titleInput = document.getElementById('inputTitle');
    const typeInput = document.getElementById('inputType');

    if (titleInput.value.trim() === '') {
        alert("Il faut mettre un titre !");
        return;
    }

    const newItem = {
        title: titleInput.value,
        type: typeInput.value,
        current: 0,
        total: null,
        malId: null,
        status: 'unknown'
    };

    library.push(newItem);
    const newIndex = library.length - 1;
    await saveAndRender();
    titleInput.value = '';
    
    try {
        if (newItem.type === 'Anime') {
            const info = await fetchAnimeWithSeasons(newItem.title, newItem.type);
            if (info) {
                library[newIndex].malId = info.malId;
                library[newIndex].status = info.status;
                
                if (info.seasons && info.seasons.length > 1) {
                    library[newIndex].seasons = info.seasons;
                    library[newIndex].seasonProgress = new Array(info.seasons.length).fill(0);
                    library[newIndex].expanded = true;
                } else {
                    library[newIndex].total = info.total || null;
                }
                
                if (info.imageUrl) {
                    const cacheKey = `${newItem.title}-${newItem.type}`;
                    imageCache[cacheKey] = info.imageUrl;
                    localStorage.setItem('imageCache', JSON.stringify(imageCache));
                }
                
                await saveAndRender();
            }
        } else {
            const info = await fetchMalInfo(newItem.title, newItem.type);
            if (info) {
                library[newIndex].malId = info.malId;
                library[newIndex].status = info.status;
                library[newIndex].total = info.total || null;
                
                if (info.imageUrl) {
                    const cacheKey = `${newItem.title}-${newItem.type}`;
                    imageCache[cacheKey] = info.imageUrl;
                    localStorage.setItem('imageCache', JSON.stringify(imageCache));
                }
                
                await saveAndRender();
            }
        }
    } catch (error) {
        console.error('Error fetching MAL info:', error);
    }
}

async function updateProgress(index, change) {
    if (library[index].current + change >= 0) {
        library[index].current += change;
        if (!library[index].total && change > 0) {
            library[index].total = library[index].current;
        } else if(library[index].total && library[index].current > library[index].total) {
            library[index].total = library[index].current;
        }
        await saveData();
        renderList();
    }
}

async function setProgress(index, value) {
    const newValue = parseInt(value) || 0;
    if (newValue >= 0) {
        library[index].current = newValue;
        if(library[index].total && library[index].current > library[index].total) {
            library[index].current = library[index].total;
        }
        await saveData();
        renderList();
    }
}

async function setTotal(index, value) {
    const newValue = value ? parseInt(value) : null;
    if (newValue === null || newValue > 0) {
        library[index].total = newValue;
        if(library[index].total && library[index].current > library[index].total) {
            library[index].current = library[index].total;
        }
        await saveData();
        renderList();
    }
}

async function deleteItem(index) {
    if(confirm("Supprimer cet élément de ta liste ?")) {
        library.splice(index, 1);
        await saveData();
        renderList();
    }
}

async function toggleFav(index) {
    library[index].fav = !library[index].fav;
    await saveData();
    renderList();
}

let editingIndex = null;

function openEditModal(index) {
    editingIndex = index;
    const item = library[index];
    document.getElementById('editTitle').value = item.title;
    document.getElementById('editType').value = item.type;
    document.getElementById('editModal').classList.add('active');
}

function closeEditModal() {
    document.getElementById('editModal').classList.remove('active');
    editingIndex = null;
}

async function saveEdit() {
    if (editingIndex === null) return;
    
    const newTitle = document.getElementById('editTitle').value.trim();
    const newType = document.getElementById('editType').value;
    
    if (newTitle === '') {
        alert("Le titre ne peut pas être vide !");
        return;
    }
    
    const oldTitle = library[editingIndex].title;
    const oldType = library[editingIndex].type;
    
    const titleChanged = newTitle !== oldTitle;
    const typeChanged = newType !== oldType;
    
    library[editingIndex].title = newTitle;
    library[editingIndex].type = newType;
    
    if (titleChanged || typeChanged) {
        library[editingIndex].malId = null;
        library[editingIndex].status = 'unknown';
        
        const oldCacheKey = `${oldTitle}-${oldType}`;
        delete imageCache[oldCacheKey];
        localStorage.setItem('imageCache', JSON.stringify(imageCache));
    }
    
    closeEditModal();
    await saveAndRender();
    
    if (titleChanged || typeChanged) {
        try {
            const info = await fetchMalInfo(newTitle, newType);
            if (info) {
                library[editingIndex].malId = info.malId;
                library[editingIndex].status = info.status;
                if (info.total) {
                    library[editingIndex].total = info.total;
                }
                await saveAndRender();
            }
        } catch (error) {
            console.error('Error fetching MAL info:', error);
        }
    }
}

async function refreshItem(index) {
    const item = library[index];
    const cacheKey = `${item.title}-${item.type}`;
    delete imageCache[cacheKey];
    localStorage.setItem('imageCache', JSON.stringify(imageCache));
    
    library[index].malId = null;
    
    try {
        const info = await fetchMalInfo(item.title, item.type);
        if (info) {
            library[index].malId = info.malId;
            library[index].status = info.status;
            if (info.total) {
                library[index].total = info.total;
            }
            if (info.imageUrl) {
                imageCache[cacheKey] = info.imageUrl;
                localStorage.setItem('imageCache', JSON.stringify(imageCache));
            }
            await saveAndRender();
        }
    } catch (error) {
        console.error('Error refreshing item:', error);
    }
}

function showSection(section) {
    // Toggle active button
    document.getElementById('btnManga').classList.toggle('active', section === 'manga');
    document.getElementById('btnAnime').classList.toggle('active', section === 'anime');
    document.getElementById('btnFav').classList.toggle('active', section === 'fav');
    document.getElementById('btnSites').classList.toggle('active', section === 'sites');

    // Show/hide sections
    document.getElementById('sectionManga').style.display = section === 'manga' ? 'block' : 'none';
    document.getElementById('sectionAnime').style.display = section === 'anime' ? 'block' : 'none';
    document.getElementById('sectionFav').style.display = section === 'fav' ? 'block' : 'none';
    document.getElementById('sectionSites').style.display = section === 'sites' ? 'block' : 'none';

    // Keep grid layout
    document.getElementById('sectionsLayout').style.gridTemplateColumns = '1fr';
}

// Affiche la section "Mangas" au démarrage
showSection('manga');

// Charger les données au démarrage du site
loadData();

// Wrappers pour les appels onclick (qui ne peuvent pas être async)
function addItemWrapper() {
    addItem().catch(err => console.error('Erreur lors de l\'ajout:', err));
}

function updateProgressWrapper(index, change) {
    updateProgress(index, change).catch(err => console.error('Erreur lors de la mise à jour:', err));
}

// Fonction pour tout mettre à jour
async function refreshAll() {
    const btn = document.querySelector('.refresh-all-btn');
    if (!btn) return;
    
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('loading');
    btn.innerHTML = '⏳ Mise à jour en cours...';
    
    let updated = 0;
    let errors = 0;
    
    for (let i = 0; i < library.length; i++) {
        const item = library[i];
        btn.innerHTML = `⏳ ${i + 1}/${library.length}...`;
        
        try {
            // Attendre pour éviter le rate limit de l'API
            await new Promise(resolve => setTimeout(resolve, 400));
            
            const info = await fetchMalInfo(item.title, item.type, item.malId);
            if (info) {
                library[i].malId = info.malId;
                library[i].status = info.status;
                if (info.total) {
                    library[i].total = info.total;
                }
                if (info.imageUrl) {
                    const cacheKey = `${item.title}-${item.type}`;
                    imageCache[cacheKey] = info.imageUrl;
                }
                updated++;
            }
        } catch (error) {
            console.error(`Erreur pour ${item.title}:`, error);
            errors++;
        }
    }
    
    await saveData();
    renderList();
    
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.innerHTML = originalText;
    
    alert(`✅ Mise à jour terminée!\n${updated} éléments mis à jour${errors > 0 ? `\n${errors} erreurs` : ''}`);
}

function refreshAllWrapper() {
    refreshAll().catch(err => console.error('Erreur lors de la mise à jour globale:', err));
}

// Fonction pour vérifier les nouveaux chapitres/épisodes
async function checkNewReleases() {
    const btn = document.querySelector('.check-new-btn');
    if (!btn) return;
    
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('loading');
    btn.innerHTML = '⏳ Vérification...';
    
    const notifications = [];
    
    // Charger les totaux connus depuis le localStorage
    const savedTotals = localStorage.getItem('lastKnownTotals');
    if (savedTotals) {
        lastKnownTotals = JSON.parse(savedTotals);
    }
    
    for (let i = 0; i < library.length; i++) {
        const item = library[i];
        btn.innerHTML = `⏳ ${i + 1}/${library.length}...`;
        
        // Ne vérifier que les séries en cours
        if (item.status === 'completed') continue;
        
        try {
            // Attendre pour éviter le rate limit de l'API
            await new Promise(resolve => setTimeout(resolve, 400));
            
            const info = await fetchMalInfo(item.title, item.type, item.malId);
            if (info && info.total) {
                const key = item.malId || `${item.title}-${item.type}`;
                const previousTotal = lastKnownTotals[key] || item.total;
                
                // Si le nouveau total est supérieur à ce qu'on connaissait
                if (info.total > previousTotal) {
                    const diff = info.total - previousTotal;
                    const unit = item.type === 'Anime' ? 'épisode' : 'chapitre';
                    const unitPlural = item.type === 'Anime' ? 'épisodes' : 'chapitres';
                    
                    notifications.push({
                        title: item.title,
                        type: item.type,
                        message: diff === 1 
                            ? `Le ${unit} ${info.total} est disponible !`
                            : `${diff} nouveaux ${unitPlural} disponibles ! (jusqu'au ${info.total})`,
                        newTotal: info.total,
                        previousTotal: previousTotal,
                        icon: item.type === 'Anime' ? '📺' : '📖'
                    });
                }
                
                // Mettre à jour le total connu
                lastKnownTotals[key] = info.total;
                
                // Mettre à jour aussi dans la library si nécessaire
                if (info.total !== item.total) {
                    library[i].total = info.total;
                }
            }
        } catch (error) {
            console.error(`Erreur pour ${item.title}:`, error);
        }
    }
    
    // Sauvegarder les totaux connus
    localStorage.setItem('lastKnownTotals', JSON.stringify(lastKnownTotals));
    
    // Sauvegarder les mises à jour de la library
    await saveData();
    renderList();
    
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.innerHTML = originalText;
    
    // Afficher les notifications
    showNotificationsPopup(notifications);
}

function showNotificationsPopup(notifications) {
    const popup = document.getElementById('notificationsPopup');
    const overlay = document.getElementById('notificationsOverlay');
    const content = document.getElementById('notificationsContent');
    
    if (notifications.length === 0) {
        content.innerHTML = `
            <div class="notification-empty">
                <div class="notification-empty-icon">✨</div>
                <p>Aucune nouveauté pour le moment</p>
                <p class="notification-empty-sub">Toutes tes séries sont à jour !</p>
            </div>
        `;
    } else {
        content.innerHTML = notifications.map(n => `
            <div class="notification-item ${n.type.toLowerCase()}">
                <div class="notification-icon">${n.icon}</div>
                <div class="notification-info">
                    <div class="notification-title">${n.title}</div>
                    <div class="notification-message">${n.message}</div>
                </div>
                <div class="notification-badge">NEW</div>
            </div>
        `).join('');
    }
    
    popup.classList.add('active');
    overlay.classList.add('active');
}

function closeNotificationsPopup() {
    const popup = document.getElementById('notificationsPopup');
    const overlay = document.getElementById('notificationsOverlay');
    popup.classList.remove('active');
    overlay.classList.remove('active');
}

function checkNewReleasesWrapper() {
    checkNewReleases().catch(err => console.error('Erreur lors de la vérification:', err));
}

function setProgressWrapper(index, value) {
    setProgress(index, value).catch(err => console.error('Erreur lors de la mise à jour:', err));
}

function setTotalWrapper(index, value) {
    setTotal(index, value).catch(err => console.error('Erreur lors de la mise à jour:', err));
}

function deleteItemWrapper(index) {
    deleteItem(index).catch(err => console.error('Erreur lors de la suppression:', err));
}

function toggleFavWrapper(index) {
    toggleFav(index).catch(err => console.error('Erreur lors de la modification:', err));
}

function toggleExpandWrapper(index) {
    toggleExpand(index).catch(err => console.error('Erreur lors de l\'expansion:', err));
}

function updateSeasonProgressWrapper(index, seasonIndex, change) {
    updateSeasonProgress(index, seasonIndex, change).catch(err => console.error('Erreur lors de la mise à jour:', err));
}

function setSeasonProgressWrapper(index, seasonIndex, value) {
    setSeasonProgress(index, seasonIndex, value).catch(err => console.error('Erreur lors de la mise à jour:', err));
}

function refreshItemWithSeasonsWrapper(index) {
    refreshItemWithSeasons(index).catch(err => console.error('Erreur lors du rafraîchissement:', err));
}

function saveEditWrapper() {
    saveEdit().catch(err => console.error('Erreur lors de la sauvegarde:', err));
}

// ============ PANNEAU DÉTAILS ============

function openDetailPanel(index) {
    currentDetailIndex = index;
    const item = library[index];
    if (!item) return;

    const panel = document.getElementById('detailPanel');
    const overlay = document.getElementById('detailOverlay');
    
    // Remplir les infos
    document.getElementById('detailTitle').textContent = item.title;
    
    // Image
    const cacheKey = `${item.title}-${item.type}`;
    const imageUrl = imageCache[cacheKey] || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280" fill="%23333"><rect width="200" height="280"/><text x="100" y="140" text-anchor="middle" fill="%23666" font-size="14">No Image</text></svg>';
    document.getElementById('detailImage').src = imageUrl;
    
    // Type badge
    const typeBadge = document.getElementById('detailType');
    typeBadge.textContent = item.type === 'Anime' ? '📺 Anime' : '📖 Manga';
    
    // Status badge
    const statusBadge = document.getElementById('detailStatus');
    if (item.status === 'completed') {
        statusBadge.textContent = 'Terminé';
        statusBadge.classList.add('completed');
    } else {
        statusBadge.textContent = 'En cours';
        statusBadge.classList.remove('completed');
    }
    
    // Progress
    const current = item.current || 0;
    const total = item.total || '?';
    const percent = item.total ? Math.round((current / item.total) * 100) : 0;
    
    document.getElementById('detailProgressCurrent').textContent = current;
    document.getElementById('detailProgressTotal').textContent = total;
    document.getElementById('detailProgressType').textContent = item.type === 'Anime' ? 'épisodes' : 'chapitres';
    document.getElementById('detailProgressPercent').textContent = percent + '%';
    document.getElementById('detailProgressFill').style.width = percent + '%';
    document.getElementById('detailProgressInput').value = current;
    
    // Note
    document.getElementById('detailNote').value = item.note || '';
    
    // Favori button
    const favBtn = document.getElementById('detailFavBtn');
    if (item.fav) {
        favBtn.classList.add('active');
        favBtn.innerHTML = '<span>⭐</span> Favori';
    } else {
        favBtn.classList.remove('active');
        favBtn.innerHTML = '<span>☆</span> Ajouter aux favoris';
    }
    
    // Afficher le panneau
    panel.classList.add('active');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeDetailPanel() {
    const panel = document.getElementById('detailPanel');
    const overlay = document.getElementById('detailOverlay');
    
    panel.classList.remove('active');
    overlay.classList.remove('active');
    document.body.style.overflow = '';
    currentDetailIndex = null;
}

async function detailUpdateProgress(change) {
    if (currentDetailIndex === null) return;
    await updateProgress(currentDetailIndex, change);
    openDetailPanel(currentDetailIndex); // Refresh panel
}

function detailSetProgress(value) {
    if (currentDetailIndex === null) return;
    setProgress(currentDetailIndex, value).then(() => {
        openDetailPanel(currentDetailIndex);
    });
}

async function detailToggleFav() {
    if (currentDetailIndex === null) return;
    await toggleFav(currentDetailIndex);
    openDetailPanel(currentDetailIndex);
}

async function detailSaveNote(value) {
    if (currentDetailIndex === null) return;
    library[currentDetailIndex].note = value;
    await saveData();
}

function detailEdit() {
    if (currentDetailIndex === null) return;
    closeDetailPanel();
    openEditModal(currentDetailIndex);
}

async function detailDelete() {
    if (currentDetailIndex === null) return;
    if (confirm('Supprimer cet élément ?')) {
        closeDetailPanel();
        await deleteItem(currentDetailIndex);
    }
}

// Fermer le panneau avec Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeDetailPanel();
    }
});
