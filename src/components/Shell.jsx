// Structure commune des pages : barre du haut, bandeau lecture seule, contenu.
import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Bell, Eye, Plus, RefreshCw } from 'lucide-react';
import { useApp } from '../state/app.jsx';
import { useUi } from '../state/ui.jsx';
import { ProfileMenu } from './ProfileMenu.jsx';
import { AddDialog } from './AddDialog.jsx';
import { ReleasesSheet } from './ReleasesSheet.jsx';
import { useRefreshAll } from '../hooks/useRefreshAll.js';

const TABS = [
    { to: '/mangas', label: 'Mangas' },
    { to: '/animes', label: 'Animes' },
    { to: '/watchlist', label: 'Watchlist' },
    { to: '/recommandations', label: 'Recommandations' },
    { to: '/meh', label: 'Meh' },
    { to: '/activite', label: 'Activité' },
    { to: '/sites', label: 'Sites' },
];

export function Shell() {
    const { readOnly, profile, task, saveState, leave } = useApp();
    const { toast } = useUi();
    const location = useLocation();
    const [addOpen, setAddOpen] = useState(false);
    const [releasesOpen, setReleasesOpen] = useState(false);
    const refreshAll = useRefreshAll();
    const defaultType = location.pathname.startsWith('/animes') ? 'Anime' : 'Manga';

    return (
        <div className="shell">
            <header className="topbar">
                <div className="topbar__inner">
                    <NavLink to="/mangas" className="brand" aria-label="Liste, accueil">
                        Liste
                    </NavLink>
                    <nav className="tabs" aria-label="Sections">
                        {TABS.map((t) => (
                            <NavLink key={t.to} to={t.to} className={({ isActive }) => `tabs__link ${isActive ? 'is-active' : ''}`}>
                                {t.label}
                            </NavLink>
                        ))}
                    </nav>
                    <div className="topbar__actions">
                        {!readOnly && (
                            <button className="btn btn--primary btn--add" onClick={() => setAddOpen(true)}>
                                <Plus size={18} aria-hidden="true" />
                                <span className="btn__label">Ajouter</span>
                            </button>
                        )}
                        <button className="btn btn--ghost btn--icon" onClick={() => setReleasesOpen(true)} aria-label="Nouveautés" title="Nouveautés">
                            <Bell size={19} />
                        </button>
                        {!readOnly && (
                            <button
                                className="btn btn--ghost btn--icon"
                                onClick={() => (task ? toast('Une mise à jour est déjà en cours.') : refreshAll())}
                                aria-label="Tout mettre à jour"
                                title="Tout mettre à jour"
                            >
                                <RefreshCw size={19} className={task ? 'spin' : ''} />
                            </button>
                        )}
                        <ProfileMenu />
                    </div>
                </div>
            </header>

            {readOnly && profile && (
                <div className="readonly-bar">
                    <Eye size={16} aria-hidden="true" />
                    <span>
                        Tu regardes la liste de <strong>{profile.name}</strong> en lecture seule.
                    </span>
                    <button className="btn btn--link" onClick={leave}>
                        Changer de profil
                    </button>
                </div>
            )}

            <main className="main" id="contenu">
                <Outlet context={{ openAdd: () => setAddOpen(true) }} />
            </main>

            {(task || saveState === 'error') && (
                <div className="taskpill" role="status">
                    {task ? (
                        <>
                            <RefreshCw size={15} className="spin" aria-hidden="true" />
                            <span>
                                {task.label} {task.total ? `${task.done} sur ${task.total}` : ''}
                            </span>
                            {task.total > 0 && <span className="taskpill__bar" style={{ '--p': `${(task.done / task.total) * 100}%` }} />}
                        </>
                    ) : (
                        <span>Modifications non enregistrées. Nouvel essai automatique…</span>
                    )}
                </div>
            )}

            <AddDialog open={addOpen} onClose={() => setAddOpen(false)} defaultType={defaultType} />
            <ReleasesSheet open={releasesOpen} onClose={() => setReleasesOpen(false)} />
        </div>
    );
}
