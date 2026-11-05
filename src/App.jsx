import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useApp } from './state/app.jsx';
import { Shell } from './components/Shell.jsx';
import { ProfilesPage } from './pages/ProfilesPage.jsx';
import { LibraryPage } from './pages/LibraryPage.jsx';
import { ItemPage } from './pages/ItemPage.jsx';
import { RecommendationsPage } from './pages/RecommendationsPage.jsx';
import { SitesPage } from './pages/SitesPage.jsx';

function RequireProfile({ children }) {
    const { session, hasEntered } = useApp();
    const location = useLocation();
    // On ne garde la page demandée que pour un lien ouvert directement (pas après « Changer de profil »).
    if (!session) return <Navigate to="/" replace state={hasEntered ? undefined : { from: location.pathname }} />;
    return children;
}

function Home() {
    const { session } = useApp();
    const location = useLocation();
    if (session) return <Navigate to={location.state?.from || '/mangas'} replace />;
    return <ProfilesPage />;
}

export function App() {
    const { booting } = useApp();
    if (booting) {
        return (
            <div className="boot" aria-busy="true">
                <span className="brand brand--lg">Liste</span>
            </div>
        );
    }
    return (
        <Routes>
            <Route path="/" element={<Home />} />
            <Route
                element={
                    <RequireProfile>
                        <Shell />
                    </RequireProfile>
                }
            >
                <Route path="/mangas" element={<LibraryPage view="Manga" />} />
                <Route path="/animes" element={<LibraryPage view="Anime" />} />
                <Route path="/watchlist" element={<LibraryPage view="watchlist" />} />
                <Route path="/recommandations" element={<RecommendationsPage />} />
                <Route path="/sites" element={<SitesPage />} />
                <Route path="/oeuvre/:id" element={<ItemPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );
}
