// Script pour supprimer le profil Aohac
const profiles = JSON.parse(localStorage.getItem('animeProfiles') || '{}');
console.log('Profils avant suppression:', Object.keys(profiles));

// Trouver et supprimer le profil Aohac
let aohacId = null;
for (const [id, profile] of Object.entries(profiles)) {
    if (profile.name === 'Aohac') {
        aohacId = id;
        break;
    }
}

if (aohacId) {
    delete profiles[aohacId];
    localStorage.setItem('animeProfiles', JSON.stringify(profiles));
    console.log('Profil Aohac supprimé');
    console.log('Profils après suppression:', Object.keys(profiles));
} else {
    console.log('Profil Aohac non trouvé');
}
