// Initialisation du state
let library = [];
let selectedIndex = null;
let imageCache = {};
let malInfoCache = {};
let lastUpdateCheck = 0;
let currentView = 'manga'; // 'manga' ou 'anime'
let currentDetailIndex = null; // Index de l'élément affiché dans le panneau
let lastKnownTotals = {}; // Pour suivre les totaux connus (chapitres/épisodes)
let currentProfile = 'default'; // Profil actuel
let profiles = {}; // Tous les profils
let editingProfileId = null; // ID du profil en cours d'édition
let isSpectatorMode = false; // Mode spectateur (lecture seule)
let isAdminMode = false; // Mode admin (accès complet)
let pendingProfileSwitch = null; // Profil en attente de déverrouillage
const API_URL = '/api/data';

// Charger les profils
function loadProfiles() {
    const savedProfiles = localStorage.getItem('animeProfiles');
    if (savedProfiles) {
        profiles = JSON.parse(savedProfiles);
        
        // S'assurer que le profil par défaut a un mot de passe
        if (profiles['default'] && !profiles['default'].password) {
            profiles['default'].password = '341245';
            profiles['default'].isAdmin = true;
            localStorage.setItem('animeProfiles', JSON.stringify(profiles));
        }
        
        // Créer le profil Aohac s'il n'existe pas
        const aohacExists = Object.values(profiles).some(p => p.name === 'Aohac');
        if (!aohacExists) {
            const aohacId = 'profile_aohac';
            profiles[aohacId] = {
                id: aohacId,
                name: 'Aohac',
                password: '123456',
                isAdmin: true,
                library: [],
                imageCache: {},
                malInfoCache: {},
                lastUpdateCheck: 0,
                lastKnownTotals: {}
            };
            localStorage.setItem('animeProfiles', JSON.stringify(profiles));
        }
    } else {
        // Migrer les anciennes données vers le profil par défaut
        const oldLibrary = JSON.parse(localStorage.getItem('viegoList')) || [];
        const oldImageCache = JSON.parse(localStorage.getItem('imageCache')) || {};
        const oldMalInfoCache = JSON.parse(localStorage.getItem('malInfoCache')) || {};
        const oldLastUpdateCheck = parseInt(localStorage.getItem('lastUpdateCheck')) || 0;
        const oldLastKnownTotals = JSON.parse(localStorage.getItem('lastKnownTotals')) || {};
        
        // Créer le profil par défaut avec les anciennes données et mot de passe admin
        profiles = {
            'default': {
                id: 'default',
                name: 'Profil par défaut',
                password: '341245',
                isAdmin: true,
                library: oldLibrary,
                imageCache: oldImageCache,
                malInfoCache: oldMalInfoCache,
                lastUpdateCheck: oldLastUpdateCheck,
                lastKnownTotals: oldLastKnownTotals
            },
            'profile_aohac': {
                id: 'profile_aohac',
                name: 'Aohac',
                password: '123456',
                isAdmin: true,
                library: [],
                imageCache: {},
                malInfoCache: {},
                lastUpdateCheck: 0,
                lastKnownTotals: {}
            }
        };
        
        // Sauvegarder immédiatement
        localStorage.setItem('animeProfiles', JSON.stringify(profiles));
    }
    
    // Essayer de charger depuis le cloud
    loadProfilesFromCloud().catch(err => console.error('Erreur chargement cloud:', err));
    
    // Ne pas charger automatiquement un profil, afficher l'écran de sélection
    showProfileSelectionScreen();
}

// Afficher l'écran de sélection de profil
function showProfileSelectionScreen() {
    const grid = document.getElementById('profileSelectionGrid');
    const screen = document.getElementById('profileSelectionScreen');
    const mainContainer = document.getElementById('mainContainer');
    
    screen.style.display = 'flex';
    mainContainer.style.display = 'none';
    
    grid.innerHTML = Object.values(profiles).map(profile => {
        const itemCount = profile.library?.length || 0;
        const adminBadge = profile.isAdmin ? '<div class="profile-selection-badge">ADMIN</div>' : '';
        
        return `
            <div class="profile-selection-card" onclick="selectProfileFromScreen('${profile.id}')">
                ${adminBadge}
                <div class="profile-selection-card-content">
                    <div class="profile-selection-icon">👤</div>
                    <div class="profile-selection-name">${profile.name}</div>
                    <div class="profile-selection-count">${itemCount} élément${itemCount > 1 ? 's' : ''}</div>
                </div>
            </div>
        `;
    }).join('');
    
    // Ajouter une carte pour créer un nouveau profil
    grid.innerHTML += `
        <div class="profile-selection-card" onclick="createNewProfileFromScreen()">
            <div class="profile-selection-card-content">
                <div class="profile-selection-icon">➕</div>
                <div class="profile-selection-name">Nouveau profil</div>
                <div class="profile-selection-count">Créer</div>
            </div>
        </div>
    `;
}

// Sélectionner un profil depuis l'écran de sélection
function selectProfileFromScreen(profileId) {
    const profile = profiles[profileId];
    
    // Si le profil a un mot de passe, demander de le déverrouiller
    if (profile.password) {
        pendingProfileSwitch = profileId;
        document.getElementById('unlockProfileModal').classList.add('active');
        document.getElementById('unlockPasswordInput').value = '';
        document.getElementById('unlockError').textContent = '';
    } else {
        // Pas de mot de passe, charger directement
        currentProfile = profileId;
        isSpectatorMode = false;
        isAdminMode = profile.isAdmin || false;
        loadCurrentProfile();
        hideProfileSelectionScreen();
    }
}

// Créer un nouveau profil depuis l'écran de sélection
function createNewProfileFromScreen() {
    createNewProfile();
}

// Cacher l'écran de sélection et afficher l'application
function hideProfileSelectionScreen() {
    const screen = document.getElementById('profileSelectionScreen');
    const mainContainer = document.getElementById('mainContainer');
    
    screen.style.display = 'none';
    mainContainer.style.display = 'block';
    
    renderList();
    checkForUpdates();
}

// Charger le profil actuel
function loadCurrentProfile() {
    const profile = profiles[currentProfile];
    if (profile) {
        library = profile.library || [];
        imageCache = profile.imageCache || {};
        malInfoCache = profile.malInfoCache || {};
        lastUpdateCheck = profile.lastUpdateCheck || 0;
        lastKnownTotals = profile.lastKnownTotals || {};
        
        // Si on n'est pas déjà en mode spectateur, vérifier si c'est un profil admin
        if (!isSpectatorMode) {
            isAdminMode = profile.isAdmin || false;
        }
        
        const profileName = profile.name + (isSpectatorMode ? ' 👁️' : '') + (isAdminMode ? ' 🔓' : '');
        document.getElementById('currentProfileName').textContent = profileName;
        
        // Désactiver les contrôles en mode spectateur
        updateUIForMode();
    }
    renderProfileList();
}

// Mettre à jour l'UI selon le mode
function updateUIForMode() {
    const isReadOnly = isSpectatorMode;
    const addForm = document.querySelector('.add-form');
    const editButtons = document.querySelectorAll('.edit-btn, .delete-btn, .btn-control, .add-btn, .refresh-item-btn, .refresh-all-btn, .detail-btn.edit, .detail-btn.delete, .detail-action-btn');
    const addButton = document.querySelector('.add-anime-btn');
    const noteInputs = document.querySelectorAll('.detail-note-input, #detailProgressInput');
    
    if (addForm) {
        addForm.style.opacity = isReadOnly ? '0.5' : '1';
        addForm.style.pointerEvents = isReadOnly ? 'none' : 'auto';
    }
    
    if (addButton) {
        addButton.style.opacity = isReadOnly ? '0.3' : '1';
        addButton.style.pointerEvents = isReadOnly ? 'none' : 'auto';
    }
    
    editButtons.forEach(btn => {
        if (isReadOnly) {
            btn.style.opacity = '0.3';
            btn.style.pointerEvents = 'none';
        } else {
            btn.style.opacity = '1';
            btn.style.pointerEvents = 'auto';
        }
    });
    
    noteInputs.forEach(input => {
        if (isReadOnly) {
            input.disabled = true;
            input.style.opacity = '0.5';
        } else {
            input.disabled = false;
            input.style.opacity = '1';
        }
    });
}

// Sauvegarder les profils
function saveProfiles() {
    // Sauvegarder les données du profil actuel
    profiles[currentProfile] = {
        ...profiles[currentProfile],
        library,
        imageCache,
        malInfoCache,
        lastUpdateCheck,
        lastKnownTotals
    };
    
    localStorage.setItem('animeProfiles', JSON.stringify(profiles));
    localStorage.setItem('currentProfile', currentProfile);
    
    // Sauvegarder aussi dans Redis pour la synchronisation
    saveProfilesToCloud().catch(err => console.error('Erreur sync cloud:', err));
}

// Changer de profil
function switchProfile(profileId) {
    if (profiles[profileId]) {
        const profile = profiles[profileId];
        
        // Si le profil a un mot de passe et qu'on n'est pas admin
        if (profile.password && !isAdminMode) {
            pendingProfileSwitch = profileId;
            document.getElementById('unlockProfileModal').classList.add('active');
            document.getElementById('unlockPasswordInput').value = '';
            document.getElementById('unlockError').textContent = '';
            toggleProfileMenu();
            return;
        }
        
        // Sauvegarder le profil actuel avant de changer
        saveProfiles();
        
        currentProfile = profileId;
        isSpectatorMode = false;
        loadCurrentProfile();
        renderList();
        toggleProfileMenu();
    }
}

// Créer un nouveau profil
function createNewProfile() {
    document.getElementById('createProfileModal').classList.add('active');
    document.getElementById('newProfileName').value = `Profil ${Object.keys(profiles).length}`;
    document.getElementById('newProfilePassword').value = '';
}

// Confirmer la création du profil
function confirmCreateProfile() {
    const name = document.getElementById('newProfileName').value.trim();
    const password = document.getElementById('newProfilePassword').value.trim();
    
    if (!name) {
        alert('Le nom du profil est obligatoire');
        return;
    }
    
    if (!password || password.length > 6 || !/^\d+$/.test(password)) {
        alert('Le mot de passe doit être composé de 6 chiffres maximum');
        return;
    }
    
    const profileId = 'profile_' + Date.now();
    
    profiles[profileId] = {
        id: profileId,
        name: name,
        password: password,
        isAdmin: false,
        library: [],
        imageCache: {},
        malInfoCache: {},
        lastUpdateCheck: 0,
        lastKnownTotals: {}
    };
    
    saveProfiles();
    closeCreateProfileModal();
    
    // Switch directement au nouveau profil (pas besoin de déverrouiller car on vient de le créer)
    currentProfile = profileId;
    isSpectatorMode = false;
    isAdminMode = false;
    loadCurrentProfile();
    hideProfileSelectionScreen();
}

// Fermer le modal de création
function closeCreateProfileModal() {
    document.getElementById('createProfileModal').classList.remove('active');
}

// Déverrouiller un profil
function attemptUnlock() {
    const password = document.getElementById('unlockPasswordInput').value.trim();
    const profile = profiles[pendingProfileSwitch];
    const errorDiv = document.getElementById('unlockError');
    
    if (password === profile.password) {
        // Mot de passe correct
        currentProfile = pendingProfileSwitch;
        isSpectatorMode = false;
        isAdminMode = profile.isAdmin || false;
        loadCurrentProfile();
        closeUnlockModal();
        hideProfileSelectionScreen();
    } else {
        // Mot de passe incorrect
        errorDiv.textContent = 'Mot de passe incorrect';
    }
}

// Mode spectateur
function spectatorMode() {
    currentProfile = pendingProfileSwitch;
    isSpectatorMode = true;
    isAdminMode = false;
    loadCurrentProfile();
    closeUnlockModal();
    hideProfileSelectionScreen();
}

// Fermer le modal de déverrouillage
function closeUnlockModal() {
    document.getElementById('unlockProfileModal').classList.remove('active');
    pendingProfileSwitch = null;
}

// Exporter les profils
function exportProfiles() {
    const dataStr = JSON.stringify(profiles, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `anime-profiles-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    alert('Profils exportés avec succès ! 📤\nTransfère ce fichier sur ton autre PC.');
    toggleProfileMenu();
}

// Importer les profils
function importProfiles() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedProfiles = JSON.parse(event.target.result);
                
                // Vérifier que c'est bien un objet de profils valide
                if (typeof importedProfiles !== 'object' || !importedProfiles.default) {
                    alert('Fichier invalide ! Le fichier doit contenir des profils valides.');
                    return;
                }
                
                // Fusionner avec les profils existants (les importés ont la priorité)
                const confirmed = confirm(
                    `Importer ${Object.keys(importedProfiles).length} profil(s) ?\n\n` +
                    `⚠️ Les profils existants avec les mêmes noms seront remplacés.\n\n` +
                    `Profils à importer :\n${Object.values(importedProfiles).map(p => `- ${p.name}`).join('\n')}`
                );
                
                if (confirmed) {
                    profiles = { ...profiles, ...importedProfiles };
                    localStorage.setItem('animeProfiles', JSON.stringify(profiles));
                    
                    // Recharger le profil actuel si disponible, sinon revenir au défaut
                    if (!profiles[currentProfile]) {
                        currentProfile = 'default';
                    }
                    
                    loadCurrentProfile();
                    renderList();
                    alert('Profils importés avec succès ! 📥');
                }
            } catch (error) {
                alert('Erreur lors de la lecture du fichier. Assure-toi que c\'est un fichier JSON valide.');
                console.error('Erreur import:', error);
            }
        };
        reader.readAsText(file);
    };
    
    input.click();
    toggleProfileMenu();
}

// Renommer un profil
function renameProfile(profileId) {
    editingProfileId = profileId;
    const profile = profiles[profileId];
    document.getElementById('profileNameInput').value = profile.name;
    document.getElementById('profileModal').classList.add('active');
}

// Sauvegarder le nom du profil
function saveProfileName() {
    const newName = document.getElementById('profileNameInput').value.trim();
    if (newName && editingProfileId) {
        profiles[editingProfileId].name = newName;
        if (editingProfileId === currentProfile) {
            document.getElementById('currentProfileName').textContent = newName;
        }
        saveProfiles();
        renderProfileList();
    }
    closeProfileModal();
}

// Supprimer un profil
function deleteProfile(profileId) {
    if (profileId === 'default') {
        alert('Impossible de supprimer le profil par défaut');
        return;
    }
    
    if (confirm('Supprimer ce profil et toutes ses données ?')) {
        delete profiles[profileId];
        
        // Si c'est le profil actuel, revenir au défaut
        if (currentProfile === profileId) {
            currentProfile = 'default';
            loadCurrentProfile();
            renderList();
        }
        
        saveProfiles();
        renderProfileList();
    }
}

// Changer le mot de passe d'un profil
function changePassword(profileId) {
    const profile = profiles[profileId];
    
    // Vérifier si l'utilisateur actuel est Aohac (profil admin) ou le propriétaire du profil
    const canChangePassword = isAdminMode || currentProfile === profileId || profile.name === 'Aohac';
    
    if (!canChangePassword && currentProfile !== 'default') {
        alert('Seul l\'administrateur ou Aohac peut modifier les mots de passe des autres profils');
        return;
    }
    
    const currentPassword = prompt(`Mot de passe actuel de "${profile.name}" :`);
    
    // Si ce n'est pas le profil actuel et pas admin, vérifier le mot de passe actuel
    if (currentProfile !== profileId && !isAdminMode && profile.name !== 'Aohac') {
        if (currentPassword !== profile.password) {
            alert('Mot de passe incorrect');
            return;
        }
    }
    
    const newPassword = prompt('Nouveau mot de passe (6 chiffres maximum) :');
    
    if (!newPassword) return;
    
    if (newPassword.length > 6 || !/^\d+$/.test(newPassword)) {
        alert('Le mot de passe doit être composé de 6 chiffres maximum');
        return;
    }
    
    const confirmPassword = prompt('Confirmer le nouveau mot de passe :');
    
    if (newPassword !== confirmPassword) {
        alert('Les mots de passe ne correspondent pas');
        return;
    }
    
    profiles[profileId].password = newPassword;
    saveProfiles();
    alert(`Mot de passe de "${profile.name}" modifié avec succès !`);
}

// Afficher la liste des profils
function renderProfileList() {
    const profileList = document.getElementById('profileList');
    profileList.innerHTML = Object.values(profiles).map(profile => {
        // L'utilisateur peut changer le mot de passe si :
        // - C'est un admin
        // - C'est son propre profil
        // - Le profil actuel est Aohac
        const canChangePassword = isAdminMode || currentProfile === profile.id || profiles[currentProfile]?.name === 'Aohac';
        
        return `
            <div class="profile-item ${profile.id === currentProfile ? 'active' : ''}" onclick="switchProfile('${profile.id}')">
                <div class="profile-item-info">
                    <span class="profile-item-name">${profile.name}</span>
                    <span class="profile-item-count">${profile.library?.length || 0} éléments</span>
                </div>
                <div class="profile-item-actions" onclick="event.stopPropagation()">
                    <button class="profile-item-btn" onclick="renameProfile('${profile.id}')" title="Renommer">✏️</button>
                    ${canChangePassword ? `<button class="profile-item-btn" onclick="changePassword('${profile.id}')" title="Changer le mot de passe">🔑</button>` : ''}
                    ${profile.id !== 'default' ? `<button class="profile-item-btn delete" onclick="deleteProfile('${profile.id}')" title="Supprimer">🗑️</button>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// Toggle menu profil
function toggleProfileMenu() {
    const menu = document.getElementById('profileMenu');
    menu.classList.toggle('active');
}

// Fermer menu profil
function closeProfileModal() {
    document.getElementById('profileModal').classList.remove('active');
    editingProfileId = null;
}

// Fermer le menu si on clique ailleurs
document.addEventListener('click', (e) => {
    const menu = document.getElementById('profileMenu');
    const btn = document.getElementById('currentProfileBtn');
    if (menu && !menu.contains(e.target) && !btn.contains(e.target)) {
        menu.classList.remove('active');
    }
});

// Charger les données au démarrage
async function loadData() {
    loadProfiles();
    renderList();
    checkForUpdates();
}

// Sauvegarder les données
async function saveData() {
    saveProfiles();
    
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

// Sauvegarder les profils dans le cloud
async function saveProfilesToCloud() {
    try {
        const response = await fetch('/api/profiles', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ profiles })
        });

        if (!response.ok) {
            throw new Error('Erreur lors de la sauvegarde des profils');
        }

        console.log('✅ Profils sauvegardés dans le cloud');
    } catch (error) {
        console.error('⚠️ Erreur lors de la sauvegarde des profils dans le cloud:', error);
    }
}

// Charger les profils depuis le cloud
async function loadProfilesFromCloud() {
    try {
        const response = await fetch('/api/profiles');
        
        if (!response.ok) {
            console.log('Pas de profils dans le cloud, utilisation des profils locaux');
            return;
        }

        const data = await response.json();
        
        if (data.profiles && Object.keys(data.profiles).length > 0) {
            // Fusionner avec les profils locaux (le cloud a la priorité)
            profiles = { ...profiles, ...data.profiles };
            localStorage.setItem('animeProfiles', JSON.stringify(profiles));
            console.log('✅ Profils chargés depuis le cloud');
            
            // Recharger le profil actuel si nécessaire
            if (profiles[currentProfile]) {
                loadCurrentProfile();
                renderList();
            }
        }
    } catch (error) {
        console.error('⚠️ Erreur lors du chargement des profils depuis le cloud:', error);
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

    // Watchlist = éléments avec fav === true (exclus des sections manga/anime)
    const watchlist = library.filter(item => item.fav === true);
    // Mangas et Animes excluent les éléments de la watchlist
    const animes = library.filter(item => item.type === 'Anime' && !item.fav).sort((a, b) => a.title.localeCompare(b.title));
    const mangas = library.filter(item => item.type === 'Manga' && !item.fav).sort((a, b) => a.title.localeCompare(b.title));

    favCount.textContent = `(${watchlist.length})`;

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
            renderHorizontalCard(mangaContainer, item, index, '📖', imageCache[`${item.title}-${item.type}`]);
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
                renderHorizontalCard(animeContainer, item, index, '📺', imageCache[`${item.title}-${item.type}`]);
            }
        });
    }

    // Watchlist
    if (watchlist.length === 0) {
        favContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📋</div>
                <p class="empty-state-text">Watchlist vide</p>
                <p class="empty-state-subtext">Ajoute des animes/mangas à regarder plus tard !</p>
            </div>
        `;
    } else {
        watchlist.forEach((item) => {
            const index = library.indexOf(item);
            if (item.seasons && item.seasons.length > 1) {
                renderCardWithSeasons(favContainer, item, index, item.type === 'Anime' ? '📺' : '📖', imageCache[`${item.title}-${item.type}`], true);
            } else if (item.type === 'Anime') {
                renderHorizontalCard(favContainer, item, index, '📺', imageCache[`${item.title}-${item.type}`], true);
            } else {
                renderHorizontalCard(favContainer, item, index, '📖', imageCache[`${item.title}-${item.type}`], true);
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
    
    // Mettre à jour l'UI pour le mode spectateur/admin
    updateUIForMode();
}

// Fonction pour afficher les recommandations
function renderRecommendations() {
    const container = document.getElementById('recommendationsListContainer');
    const profilesContainer = document.getElementById('recommendationsProfiles');
    const countSpan = document.getElementById('recommendationsCount');
    
    // Créer les checkboxes pour chaque profil (sauf le profil actuel)
    profilesContainer.innerHTML = '';
    const otherProfiles = Object.values(profiles).filter(p => p.id !== currentProfile);
    
    if (otherProfiles.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">💡</div>
                <p class="empty-state-text">Aucun autre profil</p>
                <p class="empty-state-subtext">Créez d'autres profils pour voir leurs recommandations !</p>
            </div>
        `;
        countSpan.textContent = '(0)';
        return;
    }
    
    // Ajouter les checkboxes des profils
    otherProfiles.forEach(profile => {
        const checkboxDiv = document.createElement('div');
        checkboxDiv.className = 'profile-checkbox-item';
        checkboxDiv.innerHTML = `
            <input type="checkbox" id="profile-${profile.id}" checked onchange="renderRecommendations()">
            <label for="profile-${profile.id}">${profile.name}</label>
        `;
        profilesContainer.appendChild(checkboxDiv);
    });
    
    // Collecter les profils sélectionnés
    const selectedProfiles = otherProfiles.filter(profile => {
        const checkbox = document.getElementById(`profile-${profile.id}`);
        return checkbox && checkbox.checked;
    });
    
    if (selectedProfiles.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">💡</div>
                <p class="empty-state-text">Sélectionnez au moins un profil</p>
                <p class="empty-state-subtext">Cochez les profils pour voir leurs recommandations</p>
            </div>
        `;
        countSpan.textContent = '(0)';
        return;
    }
    
    // Collecter tous les items des profils sélectionnés avec compteur
    const recommendationsMap = new Map(); // key: "title-type", value: {item, recommendedBy: [profileNames]}
    
    selectedProfiles.forEach(profile => {
        const profileLibrary = profile.library || [];
        profileLibrary.forEach(item => {
            // Ne prendre que les items marqués comme recommandés
            if (!item.recommended) return;
            
            const key = `${item.title}-${item.type}`;
            
            // Vérifier si l'item n'est pas déjà dans la bibliothèque du profil actuel
            const alreadyInLibrary = library.some(myItem => 
                myItem.title === item.title && myItem.type === item.type
            );
            
            if (!alreadyInLibrary) {
                if (!recommendationsMap.has(key)) {
                    recommendationsMap.set(key, {
                        item: item,
                        recommendedBy: []
                    });
                }
                recommendationsMap.get(key).recommendedBy.push(profile.name);
            }
        });
    });
    
    // Convertir en tableau et trier par nombre de recommandations
    const recommendations = Array.from(recommendationsMap.values())
        .sort((a, b) => b.recommendedBy.length - a.recommendedBy.length);
    
    countSpan.textContent = `(${recommendations.length})`;
    
    if (recommendations.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">💡</div>
                <p class="empty-state-text">Aucune recommandation</p>
                <p class="empty-state-subtext">Les profils sélectionnés n'ont pas d'anime/manga que vous n'avez pas déjà</p>
            </div>
        `;
        return;
    }
    
    // Afficher les recommandations
    container.innerHTML = '';
    recommendations.forEach(rec => {
        const item = rec.item;
        const card = document.createElement('div');
        card.className = 'card';
        
        const icon = item.type === 'Anime' ? '📺' : '📖';
        const cachedImage = imageCache[`${item.title}-${item.type}`];
        
        const totalDisplay = item.total ? item.total : '?';
        const percentage = item.total ? Math.round((item.current / item.total) * 100) : 0;
        
        card.innerHTML = `
            <div class="card-image">
                ${cachedImage ? `<img src="${cachedImage}" alt="${item.title}">` : `<div class="card-placeholder">${icon}</div>`}
            </div>
            <div class="card-content">
                <div class="card-title">${item.title}</div>
                <div class="card-type">${icon} ${item.type}</div>
                <div class="card-progress">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${percentage}%"></div>
                    </div>
                    <span class="progress-text">${item.current} / ${totalDisplay}</span>
                </div>
                <div class="recommendation-badge">
                    <span>💡</span>
                    <span class="recommendation-count">${rec.recommendedBy.length}</span>
                    <span>× recommandé par:</span>
                </div>
                <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">
                    ${rec.recommendedBy.join(', ')}
                </div>
                <button class="add-recommendation-btn" onclick="addRecommendation('${item.title.replace(/'/g, "\\'")}', '${item.type}')">
                    + Ajouter à ma liste
                </button>
            </div>
        `;
        
        container.appendChild(card);
    });
}

// Ajouter une recommandation à sa liste
async function addRecommendation(title, type) {
    // Vérifier si l'item existe déjà
    const exists = library.some(item => item.title === title && item.type === type);
    if (exists) {
        alert('Cet élément est déjà dans ta liste !');
        return;
    }
    
    // Ajouter l'item avec progression à 0
    const newItem = {
        title: title,
        type: type,
        current: 0,
        total: null,
        fav: false,
        note: ''
    };
    
    library.push(newItem);
    await saveData();
    
    // Rafraîchir les infos depuis l'API
    const index = library.length - 1;
    await refreshItemInfo(index);
    
    // Rafraîchir l'affichage des recommandations
    renderRecommendations();
    
    alert(`${title} ajouté à ta liste !`);
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
    
    const favBtn = `<button class="btn-control" onclick="event.stopPropagation(); toggleFavWrapper(${index})" title="Watchlist">${item.fav ? '📋' : '📋'}</button>`;
    
    // Note preview (truncated)
    const notePreview = item.note ? `<div class="card-note-preview">${item.note.length > 60 ? item.note.substring(0, 60) + '...' : item.note}</div>` : '';
    
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
            ${notePreview}
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

// Carte horizontale pour anime/manga (même style que avec saisons mais sans flèche)
function renderHorizontalCard(container, item, index, icon, cachedImage, isFavSection = false) {
    const isActive = selectedIndex === index;
    const percentage = item.total ? Math.round((item.current / item.total) * 100) : 0;
    
    let statusBadge = '';
    if (item.status === 'ongoing') {
        statusBadge = '<span class="status-ongoing">En cours</span>';
    } else if (item.status === 'completed' || (item.total && item.current >= item.total)) {
        statusBadge = '<span class="status-completed">Terminé</span>';
    }
    
    const cardGroup = document.createElement('div');
    cardGroup.className = `card-group ${isActive ? 'active' : ''}`;
    
    const iconHtml = cachedImage 
        ? `<img src="${cachedImage}" alt="${item.title}" onerror="this.parentElement.innerHTML='<div class=card-icon-fallback>${icon}</div>'">`
        : `<div class="card-icon-fallback">${icon}</div>`;
    
    const totalDisplay = item.total || '?';
    const unitLabel = item.type === 'Anime' ? 'épisodes' : 'chapitres';
    const favBtn = `<button class="btn-control" onclick="event.stopPropagation(); toggleFavWrapper(${index})" title="Watchlist">${item.fav ? '📋' : '📋'}</button>`;
    const recommendBtn = `<button class="btn-control ${item.recommended ? 'recommended' : ''}" onclick="event.stopPropagation(); toggleRecommendationWrapper(${index})" title="Recommander">💡</button>`;
    
    // Note preview
    const notePreview = item.note ? `<div class="card-note-preview">${item.note.length > 60 ? item.note.substring(0, 60) + '...' : item.note}</div>` : '';
    
    cardGroup.innerHTML = `
        <div class="card-group-header" onclick="openDetailPanel(${index})">
            <div class="expand-btn-placeholder"></div>
            <div class="card-icon" data-index="${index}">${iconHtml}</div>
            <div class="card-info">
                <h3 class="card-title">${item.title}</h3>
                <div class="card-meta">
                    <span class="card-type">${item.type} (${totalDisplay} ${unitLabel})</span>
                    ${statusBadge}
                    <div class="progress-bar-container">
                        <div class="progress-bar" style="width: ${percentage}%"></div>
                    </div>
                </div>
                ${notePreview}
            </div>
            <div class="card-controls" onclick="event.stopPropagation()">
                <button class="btn-control" onclick="updateProgressWrapper(${index}, -1)">−</button>
                <span class="progress-count">
                    <input type="number" class="editable-value" value="${item.current}" 
                        onchange="setProgressWrapper(${index}, this.value)"
                        min="0" ${item.total ? `max="${item.total}"` : ''}>
                    <span>/</span>
                    <input type="number" class="editable-total" value="${item.total || ''}" 
                        onchange="setTotalWrapper(${index}, this.value)"
                        placeholder="?">
                </span>
                <button class="btn-control" onclick="updateProgressWrapper(${index}, 1)">+</button>
            </div>
            <div class="card-actions">
                ${favBtn}
                ${recommendBtn}
                <button class="refresh-item-btn" onclick="event.stopPropagation(); refreshItemWithSeasonsWrapper(${index})" title="Rafraîchir">🔄</button>
                <button class="edit-btn" onclick="event.stopPropagation(); openEditModal(${index})">✏️</button>
                <button class="delete-btn" onclick="event.stopPropagation(); deleteItemWrapper(${index})">🗑️</button>
            </div>
        </div>
    `;
    
    container.appendChild(cardGroup);
    
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
    
    const favBtn = `<button class="btn-control" onclick="event.stopPropagation(); toggleFavWrapper(${index})" title="Watchlist">${item.fav ? '📋' : '📋'}</button>`;
    const recommendBtn = `<button class="btn-control ${item.recommended ? 'recommended' : ''}" onclick="event.stopPropagation(); toggleRecommendationWrapper(${index})" title="Recommander">💡</button>`;
    cardGroup.innerHTML = `
        <div class="card-group-header" onclick="openDetailPanel(${index})">
            <button class="expand-btn" onclick="event.stopPropagation(); toggleExpandWrapper(${index})" title="Afficher/masquer les saisons">▶</button>
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
            <div class="card-controls-placeholder">
                <strong>${watchedEpisodes}</strong> / ${totalEpisodes}
            </div>
            <div class="card-actions">
                ${favBtn}
                ${recommendBtn}
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

    // Utiliser les infos de l'auto-complétion si disponibles
    const useAutocomplete = selectedAutocompleteItem && 
                           selectedAutocompleteItem.title === titleInput.value &&
                           selectedAutocompleteItem.type === typeInput.value;

    const newItem = {
        title: titleInput.value,
        type: typeInput.value,
        current: 0,
        total: useAutocomplete ? selectedAutocompleteItem.total : null,
        malId: useAutocomplete ? selectedAutocompleteItem.malId : null,
        status: useAutocomplete ? selectedAutocompleteItem.status : 'unknown'
    };

    // Si on a l'image de l'auto-complétion, la mettre en cache tout de suite
    if (useAutocomplete && selectedAutocompleteItem.imageUrl) {
        const cacheKey = `${newItem.title}-${newItem.type}`;
        imageCache[cacheKey] = selectedAutocompleteItem.imageUrl;
    }

    library.push(newItem);
    const newIndex = library.length - 1;
    await saveAndRender();
    titleInput.value = '';
    hideAutocomplete();
    
    try {
        if (newItem.type === 'Anime') {
            // Si on a déjà l'ID MAL via auto-complétion, on peut chercher les saisons directement
            const info = await fetchAnimeWithSeasons(newItem.title, newItem.type, useAutocomplete ? selectedAutocompleteItem.malId : null);
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
            // Pour les mangas, on récupère les infos si pas d'auto-complétion
            if (!useAutocomplete) {
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
        }
    } catch (error) {
        console.error('Error fetching MAL info:', error);
    }
    
    // Réinitialiser la sélection auto-complétion
    selectedAutocompleteItem = null;
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

async function toggleRecommendation(index) {
    library[index].recommended = !library[index].recommended;
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
    document.getElementById('btnRecommendations').classList.toggle('active', section === 'recommendations');
    document.getElementById('btnSites').classList.toggle('active', section === 'sites');

    // Show/hide sections
    document.getElementById('sectionManga').style.display = section === 'manga' ? 'block' : 'none';
    document.getElementById('sectionAnime').style.display = section === 'anime' ? 'block' : 'none';
    document.getElementById('sectionFav').style.display = section === 'fav' ? 'block' : 'none';
    document.getElementById('sectionRecommendations').style.display = section === 'recommendations' ? 'block' : 'none';
    document.getElementById('sectionSites').style.display = section === 'sites' ? 'block' : 'none';

    // Si on affiche les recommandations, les générer
    if (section === 'recommendations') {
        renderRecommendations();
    }

    // Keep grid layout
    document.getElementById('sectionsLayout').style.gridTemplateColumns = '1fr';
}

// Affiche la section "Mangas" au démarrage
showSection('manga');

// Charger les profils au démarrage (affiche l'écran de sélection)
loadProfiles();

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
    const upcomingReleases = [];
    
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
            
            // Chercher les prochaines sorties pour les animes
            if (item.type === 'Anime' && item.malId && item.status !== 'completed') {
                await new Promise(resolve => setTimeout(resolve, 400));
                const upcoming = await fetchUpcomingEpisode(item.malId, item.title);
                if (upcoming) {
                    upcomingReleases.push(upcoming);
                }
            }
            
            // Chercher les prochaines sorties pour les mangas
            if (item.type === 'Manga' && item.malId && item.status !== 'completed') {
                await new Promise(resolve => setTimeout(resolve, 400));
                const upcoming = await fetchUpcomingChapter(item.malId, item.title, item.total);
                if (upcoming) {
                    upcomingReleases.push(upcoming);
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
    showNotificationsPopup(notifications, upcomingReleases);
}

// Récupérer le prochain épisode d'un anime
async function fetchUpcomingEpisode(malId, title) {
    try {
        const response = await fetch(`https://api.jikan.moe/v4/anime/${malId}`);
        const data = await response.json();
        
        if (data.data && data.data.broadcast && data.data.broadcast.string && data.data.status === 'Currently Airing') {
            const broadcast = data.data.broadcast;
            const anime = data.data;
            const nextEpisode = anime.episodes ? `Épisode ${(anime.episodes || 0) + 1}` : 'Prochain épisode';
            const imageUrl = anime.images?.jpg?.small_image_url || anime.images?.jpg?.image_url || null;
            
            // Calculer la prochaine date de diffusion
            const nextDate = getNextBroadcastDate(broadcast.day, broadcast.time, broadcast.timezone);
            
            if (nextDate) {
                return {
                    title: title,
                    type: 'Anime',
                    icon: '📺',
                    image: imageUrl,
                    episode: nextEpisode,
                    date: nextDate,
                    dateStr: formatDate(nextDate),
                    broadcastDay: broadcast.day,
                    broadcastTime: broadcast.time
                };
            }
        }
    } catch (error) {
        console.error(`Erreur upcoming anime ${title}:`, error);
    }
    return null;
}

// Récupérer le prochain chapitre d'un manga (estimation basée sur le rythme de publication)
async function fetchUpcomingChapter(malId, title, currentTotal) {
    try {
        const response = await fetch(`https://api.jikan.moe/v4/manga/${malId}`);
        const data = await response.json();
        
        if (data.data && data.data.status === 'Publishing') {
            // Les mangas hebdomadaires sortent généralement chaque semaine
            // On estime la prochaine sortie basée sur le type de publication
            const manga = data.data;
            const nextChapter = (currentTotal || manga.chapters || 0) + 1;
            const imageUrl = manga.images?.jpg?.small_image_url || manga.images?.jpg?.image_url || null;
            
            // Estimation : si c'est un manga en cours, le prochain chapitre sort probablement dans la semaine
            // On regarde si c'est un magazine hebdomadaire connu
            let estimatedDate = null;
            let frequency = 'hebdomadaire';
            
            // Magazines hebdomadaires connus
            const weeklyMagazines = ['Shonen Jump', 'Weekly Shonen Jump', 'Weekly Shonen Magazine', 'Shonen Magazine'];
            const isWeekly = manga.serializations?.some(s => 
                weeklyMagazines.some(m => s.name.toLowerCase().includes(m.toLowerCase()))
            );
            
            if (isWeekly) {
                // Prochain dimanche/lundi (jour typique de sortie Jump)
                estimatedDate = getNextWeekday(0); // Dimanche
                frequency = 'hebdomadaire';
            } else {
                // Mensuel ou autre - estimation plus vague
                estimatedDate = new Date();
                estimatedDate.setDate(estimatedDate.getDate() + 14); // Dans ~2 semaines
                frequency = 'bimensuel/mensuel';
            }
            
            return {
                title: title,
                type: 'Manga',
                icon: '📖',
                image: imageUrl,
                episode: `Chapitre ${nextChapter}`,
                date: estimatedDate,
                dateStr: formatDate(estimatedDate),
                frequency: frequency,
                magazine: manga.serializations?.[0]?.name || null
            };
        }
    } catch (error) {
        console.error(`Erreur upcoming manga ${title}:`, error);
    }
    return null;
}

// Calculer la prochaine date de diffusion
function getNextBroadcastDate(day, time, timezone) {
    if (!day) return null;
    
    const days = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
    const dayIndex = days.findIndex(d => d.toLowerCase().startsWith(day.toLowerCase()));
    if (dayIndex === -1) return null;
    
    const now = new Date();
    const targetDay = dayIndex;
    const currentDay = now.getDay();
    
    let daysUntil = targetDay - currentDay;
    if (daysUntil <= 0) daysUntil += 7; // Si c'est aujourd'hui ou passé, prendre la semaine prochaine
    
    const nextDate = new Date(now);
    nextDate.setDate(now.getDate() + daysUntil);
    
    // Ajouter l'heure si disponible
    if (time) {
        const [hours, minutes] = time.split(':').map(Number);
        nextDate.setHours(hours || 0, minutes || 0, 0, 0);
    }
    
    return nextDate;
}

// Obtenir le prochain jour de la semaine
function getNextWeekday(targetDay) {
    const now = new Date();
    const currentDay = now.getDay();
    let daysUntil = targetDay - currentDay;
    if (daysUntil <= 0) daysUntil += 7;
    
    const nextDate = new Date(now);
    nextDate.setDate(now.getDate() + daysUntil);
    return nextDate;
}

// Formater une date avec heure
function formatDate(date, includeTime = true) {
    if (!date) return 'Date inconnue';
    
    const now = new Date();
    const diff = Math.ceil((date - now) / (1000 * 60 * 60 * 24));
    
    const dateOptions = { weekday: 'long', day: 'numeric', month: 'long' };
    const dateStr = date.toLocaleDateString('fr-FR', dateOptions);
    
    // Formater l'heure
    let timeStr = '';
    if (includeTime && (date.getHours() !== 0 || date.getMinutes() !== 0)) {
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        timeStr = ` à ${hours}h${minutes}`;
    }
    
    if (diff === 0) return `Aujourd'hui${timeStr}`;
    if (diff === 1) return `Demain${timeStr}`;
    if (diff < 7) return `${dateStr}${timeStr} (dans ${diff} jours)`;
    
    return `${dateStr}${timeStr}`;
}

function showNotificationsPopup(notifications, upcomingReleases = []) {
    const popup = document.getElementById('notificationsPopup');
    const overlay = document.getElementById('notificationsOverlay');
    const content = document.getElementById('notificationsContent');
    
    let html = '';
    
    // Section nouveautés
    if (notifications.length > 0) {
        html += `<div class="notifications-section">
            <h4 class="notifications-section-title">🆕 Nouveautés disponibles</h4>
            ${notifications.map(n => `
                <div class="notification-item ${n.type.toLowerCase()}">
                    <div class="notification-icon">${n.icon}</div>
                    <div class="notification-info">
                        <div class="notification-title">${n.title}</div>
                        <div class="notification-message">${n.message}</div>
                    </div>
                    <div class="notification-badge">NEW</div>
                </div>
            `).join('')}
        </div>`;
    }
    
    // Section prochaines sorties
    if (upcomingReleases.length > 0) {
        // Trier par date
        upcomingReleases.sort((a, b) => (a.date || new Date(9999, 0)) - (b.date || new Date(9999, 0)));
        
        html += `<div class="notifications-section">
            <h4 class="notifications-section-title">📅 Prochaines sorties</h4>
            ${upcomingReleases.map(n => {
                const imageHtml = n.image 
                    ? `<img src="${n.image}" alt="${n.title}" class="notification-image" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><div class="notification-icon-fallback" style="display:none;">${n.icon}</div>`
                    : `<div class="notification-icon-fallback">${n.icon}</div>`;
                return `
                <div class="notification-item upcoming ${n.type.toLowerCase()}">
                    <div class="notification-image-container">${imageHtml}</div>
                    <div class="notification-info">
                        <div class="notification-title">${n.title}</div>
                        <div class="notification-message">${n.episode}</div>
                        <div class="notification-date">${n.dateStr}${n.magazine ? ` • ${n.magazine}` : ''}</div>
                    </div>
                    <div class="notification-badge upcoming">${n.icon}</div>
                </div>
            `}).join('')}
        </div>`;
    }
    
    // Si rien à afficher
    if (notifications.length === 0 && upcomingReleases.length === 0) {
        html = `
            <div class="notification-empty">
                <div class="notification-empty-icon">✨</div>
                <p>Aucune nouveauté pour le moment</p>
                <p class="notification-empty-sub">Toutes tes séries sont à jour !</p>
            </div>
        `;
    }
    
    content.innerHTML = html;
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

function toggleRecommendationWrapper(index) {
    toggleRecommendation(index).catch(err => console.error('Erreur lors de la modification:', err));
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
        favBtn.innerHTML = '<span>📋</span> Dans la Watchlist';
    } else {
        favBtn.classList.remove('active');
        favBtn.innerHTML = '<span>📋</span> Ajouter à la Watchlist';
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
    renderList();
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
        hideAutocomplete();
    }
});

// ==================== AUTO-COMPLÉTION ====================

let autocompleteTimeout = null;
let selectedAutocompleteItem = null;

function initAutocomplete() {
    const inputTitle = document.getElementById('inputTitle');
    const inputType = document.getElementById('inputType');
    const autocompleteContainer = document.getElementById('autocompleteContainer');
    
    if (!inputTitle || !autocompleteContainer) return;
    
    // Recherche à la saisie
    inputTitle.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        
        // Annuler la recherche précédente
        if (autocompleteTimeout) {
            clearTimeout(autocompleteTimeout);
        }
        
        if (query.length < 2) {
            hideAutocomplete();
            return;
        }
        
        // Attendre 400ms avant de lancer la recherche (debounce)
        autocompleteTimeout = setTimeout(() => {
            searchAutocomplete(query, inputType.value);
        }, 400);
    });
    
    // Fermer quand on clique ailleurs
    document.addEventListener('click', (e) => {
        if (!inputTitle.contains(e.target) && !autocompleteContainer.contains(e.target)) {
            hideAutocomplete();
        }
    });
    
    // Navigation au clavier
    inputTitle.addEventListener('keydown', (e) => {
        const items = autocompleteContainer.querySelectorAll('.autocomplete-item');
        if (items.length === 0) return;
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            navigateAutocomplete(items, 1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            navigateAutocomplete(items, -1);
        } else if (e.key === 'Enter') {
            const activeItem = autocompleteContainer.querySelector('.autocomplete-item.active');
            if (activeItem) {
                e.preventDefault();
                activeItem.click();
            }
        }
    });
    
    // Relancer la recherche quand on change le type
    inputType.addEventListener('change', () => {
        const query = inputTitle.value.trim();
        if (query.length >= 2) {
            searchAutocomplete(query, inputType.value);
        }
    });
}

async function searchAutocomplete(query, type) {
    const autocompleteContainer = document.getElementById('autocompleteContainer');
    
    // Afficher le chargement
    autocompleteContainer.innerHTML = '<div class="autocomplete-loading">🔍 Recherche...</div>';
    autocompleteContainer.classList.add('show');
    
    try {
        const searchType = type === 'Anime' ? 'anime' : 'manga';
        const response = await fetch(`https://api.jikan.moe/v4/${searchType}?q=${encodeURIComponent(query)}&limit=8`);
        const data = await response.json();
        
        if (!data.data || data.data.length === 0) {
            autocompleteContainer.innerHTML = '<div class="autocomplete-empty">Aucun résultat trouvé</div>';
            return;
        }
        
        autocompleteContainer.innerHTML = '';
        
        data.data.forEach((item) => {
            const div = document.createElement('div');
            div.className = 'autocomplete-item';
            
            const total = type === 'Anime' ? item.episodes : item.chapters;
            const totalText = total ? `${total} ${type === 'Anime' ? 'épisodes' : 'chapitres'}` : 'En cours';
            const year = item.aired?.from ? new Date(item.aired.from).getFullYear() : 
                        (item.published?.from ? new Date(item.published.from).getFullYear() : '');
            
            div.innerHTML = `
                <img src="${item.images.jpg.small_image_url || item.images.jpg.image_url}" alt="${item.title}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 56%22><rect fill=%22%23333%22 width=%2240%22 height=%2256%22/></svg>'">
                <div class="autocomplete-item-info">
                    <div class="autocomplete-item-title">${item.title}</div>
                    <div class="autocomplete-item-meta">${year ? year + ' • ' : ''}${totalText}</div>
                </div>
            `;
            
            div.addEventListener('click', () => {
                selectAutocompleteItem(item, type);
            });
            
            autocompleteContainer.appendChild(div);
        });
        
    } catch (error) {
        console.error('Erreur auto-complétion:', error);
        autocompleteContainer.innerHTML = '<div class="autocomplete-empty">Erreur de recherche</div>';
    }
}

function navigateAutocomplete(items, direction) {
    const currentActive = document.querySelector('.autocomplete-item.active');
    let newIndex = 0;
    
    if (currentActive) {
        currentActive.classList.remove('active');
        const currentIndex = Array.from(items).indexOf(currentActive);
        newIndex = currentIndex + direction;
        
        if (newIndex < 0) newIndex = items.length - 1;
        if (newIndex >= items.length) newIndex = 0;
    } else {
        newIndex = direction === 1 ? 0 : items.length - 1;
    }
    
    items[newIndex].classList.add('active');
    items[newIndex].scrollIntoView({ block: 'nearest' });
}

function selectAutocompleteItem(item, type) {
    const inputTitle = document.getElementById('inputTitle');
    inputTitle.value = item.title;
    
    // Stocker les infos MAL pour un ajout plus rapide
    selectedAutocompleteItem = {
        malId: item.mal_id,
        title: item.title,
        type: type,
        imageUrl: item.images.jpg.large_image_url || item.images.jpg.image_url,
        total: type === 'Anime' ? item.episodes : item.chapters,
        status: (item.status === 'Currently Airing' || item.status === 'Publishing') ? 'ongoing' : 'completed'
    };
    
    hideAutocomplete();
    inputTitle.focus();
}

function hideAutocomplete() {
    const autocompleteContainer = document.getElementById('autocompleteContainer');
    if (autocompleteContainer) {
        autocompleteContainer.classList.remove('show');
        autocompleteContainer.innerHTML = '';
    }
    selectedAutocompleteItem = null;
}

// Initialiser l'auto-complétion au chargement
document.addEventListener('DOMContentLoaded', () => {
    initAutocomplete();
});
