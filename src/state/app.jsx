// État global : profils, session en cours, bibliothèque et enregistrement automatique.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { load, save, tokens } from '../lib/storage.js';
import { useUi } from './ui.jsx';
import { findEntries, summarize } from '../lib/meta.js';

const AppContext = createContext(null);
const SAVE_DELAY = 700;
const AUTO_CHECK_EVERY = 60 * 60 * 1000; // 1 h

export function AppProvider({ children }) {
    const { toast } = useUi();
    const [profiles, setProfiles] = useState(null);
    const [profilesError, setProfilesError] = useState(null);
    const [booting, setBooting] = useState(true);
    // session = { profileId, mode: 'owner' | 'spectator', isAdmin, token }
    const [session, setSession] = useState(null);
    const [library, setLibrary] = useState(null);
    const [saveState, setSaveState] = useState('saved'); // saved | pending | saving | error
    const [task, setTask] = useState(null); // opération longue en cours { label, done, total }
    const [hasEntered, setHasEntered] = useState(false);

    const libraryRef = useRef(null);
    const sessionRef = useRef(null);
    const dirtyRef = useRef(false);
    const savingRef = useRef(false);
    const timerRef = useRef(null);

    libraryRef.current = library;
    sessionRef.current = session;

    const profile = useMemo(() => profiles?.find((p) => p.id === session?.profileId) || null, [profiles, session]);
    const readOnly = session?.mode !== 'owner';

    // ---------- Profils ----------

    const refreshProfiles = useCallback(async () => {
        try {
            const data = await api.listProfiles();
            setProfiles(data.profiles);
            setProfilesError(null);
            return data.profiles;
        } catch (err) {
            setProfilesError(err.message);
            return null;
        }
    }, []);

    // Jeton utilisable pour écrire dans un profil : le sien, ou celui de l'admin connecté sur cet appareil.
    const writeTokenFor = useCallback((profileId) => tokens.get(profileId) || load('adminToken'), []);
    // asAdmin : action faite depuis « Gérer les profils », toujours avec la session administrateur.
    const tokenFor = useCallback((profileId, asAdmin) => (asAdmin ? load('adminToken') : writeTokenFor(profileId)), [writeTokenFor]);

    const loadLibrary = useCallback(async (profileId) => {
        const cached = load(`library.${profileId}`);
        if (cached) setLibrary(cached);
        else setLibrary(null);
        try {
            const data = await api.getLibrary(profileId);
            setLibrary(data);
            save(`library.${profileId}`, data);
        } catch (err) {
            if (!cached) toast(err.message, { tone: 'error' });
        }
    }, [toast]);

    const enter = useCallback(
        async (profileId, mode, token, isAdmin) => {
            dirtyRef.current = false;
            setSaveState('saved');
            setHasEntered(true);
            setSession({ profileId, mode, token, isAdmin: !!isAdmin });
            save('lastProfile', profileId);
            await loadLibrary(profileId);
        },
        [loadLibrary],
    );

    // Essaie d'ouvrir un profil sans code grâce à une session déjà ouverte sur cet appareil.
    const resume = useCallback(
        async (profileId) => {
            const candidates = [tokens.get(profileId), load('adminToken')].filter(Boolean);
            for (const token of candidates) {
                try {
                    const s = await api.checkSession(token);
                    if (s.valid && (s.profileId === profileId || s.isAdmin)) {
                        await enter(profileId, 'owner', token, s.isAdmin && s.profileId === profileId);
                        return true;
                    }
                } catch {
                    /* hors ligne : on demandera le code */
                }
                if (token === tokens.get(profileId)) tokens.set(profileId, null);
                else save('adminToken', null);
            }
            return false;
        },
        [enter],
    );

    const unlock = useCallback(
        async (profileId, pin) => {
            const data = await api.login(profileId, pin);
            tokens.set(profileId, data.token);
            if (data.profile.isAdmin) save('adminToken', data.token);
            await enter(profileId, 'owner', data.token, data.profile.isAdmin);
        },
        [enter],
    );

    const spectate = useCallback((profileId) => enter(profileId, 'spectator', null, false), [enter]);

    const createProfile = useCallback(
        async (name, pin) => {
            const data = await api.createProfile(name, pin);
            tokens.set(data.profile.id, data.token);
            if (data.profile.isAdmin) save('adminToken', data.token);
            await refreshProfiles();
            await enter(data.profile.id, 'owner', data.token, data.profile.isAdmin);
            return data.profile;
        },
        [enter, refreshProfiles],
    );

    const flushRef = useRef(async () => {});

    const leave = useCallback(async () => {
        await flushRef.current();
        setSession(null);
        setLibrary(null);
        save('lastProfile', null);
        refreshProfiles();
    }, [refreshProfiles]);

    const logout = useCallback(async () => {
        const s = sessionRef.current;
        await flushRef.current();
        if (s?.token) {
            api.logout(s.token).catch(() => {});
            tokens.set(s.profileId, null);
            if (load('adminToken') === s.token) save('adminToken', null);
        }
        setSession(null);
        setLibrary(null);
        save('lastProfile', null);
        refreshProfiles();
    }, [refreshProfiles]);

    const handleAuthError = useCallback(
        (err) => {
            if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
                const s = sessionRef.current;
                if (s) tokens.set(s.profileId, null);
                toast('Ta session a expiré. Entre à nouveau ton code.', { tone: 'error' });
                setSession(null);
                setLibrary(null);
                return true;
            }
            return false;
        },
        [toast],
    );

    const renameProfile = useCallback(
        async (profileId, name, { asAdmin = false } = {}) => {
            await api.updateProfile(profileId, { name }, tokenFor(profileId, asAdmin));
            await refreshProfiles();
        },
        [refreshProfiles, tokenFor],
    );

    const changePin = useCallback(
        async (profileId, pin, { asAdmin = false } = {}) => {
            const data = await api.updateProfile(profileId, { pin }, tokenFor(profileId, asAdmin));
            if (data.token) {
                tokens.set(profileId, data.token);
                if (data.profile.isAdmin) save('adminToken', data.token);
                setSession((s) => (s?.profileId === profileId ? { ...s, token: data.token } : s));
            } else {
                // Code changé par l'admin : l'ancienne session de ce profil sur cet appareil ne vaut plus rien.
                tokens.set(profileId, null);
                setSession((s) => (s?.profileId === profileId && s.mode === 'owner' ? { ...s, token: load('adminToken') } : s));
            }
        },
        [tokenFor],
    );

    const setProfilePhoto = useCallback(
        async (profileId, image, { asAdmin = false } = {}) => {
            const token = tokenFor(profileId, asAdmin);
            if (image) await api.setAvatar(profileId, image, token);
            else await api.removeAvatar(profileId, token);
            await refreshProfiles();
        },
        [refreshProfiles, tokenFor],
    );

    const deleteProfile = useCallback(
        async (profileId, { asAdmin = false } = {}) => {
            await api.deleteProfile(profileId, tokenFor(profileId, asAdmin));
            tokens.set(profileId, null);
            save(`library.${profileId}`, null);
            if (sessionRef.current?.profileId === profileId) {
                setSession(null);
                setLibrary(null);
                save('lastProfile', null);
            }
            await refreshProfiles();
        },
        [refreshProfiles, tokenFor],
    );

    // ---------- Enregistrement automatique ----------

    const flush = useCallback(async () => {
        clearTimeout(timerRef.current);
        const s = sessionRef.current;
        const lib = libraryRef.current;
        if (!dirtyRef.current || !s || s.mode !== 'owner' || !lib) return;
        if (savingRef.current) {
            timerRef.current = setTimeout(() => flushRef.current(), 300);
            return;
        }
        savingRef.current = true;
        dirtyRef.current = false;
        setSaveState('saving');
        try {
            const res = await api.saveLibrary(
                s.profileId,
                { items: lib.items, lastKnownTotals: lib.lastKnownTotals, baseVersion: lib.version },
                writeTokenFor(s.profileId),
            );
            setLibrary((current) => {
                const next = { ...current, version: res.version, updatedAt: res.updatedAt };
                save(`library.${s.profileId}`, next);
                return next;
            });
            setSaveState(dirtyRef.current ? 'pending' : 'saved');
            setProfiles((list) => list?.map((p) => (p.id === s.profileId ? { ...p, itemCount: lib.items.length } : p)));
        } catch (err) {
            if (err instanceof ApiError && err.status === 409 && err.data?.library) {
                // Modifiée sur un autre appareil : on reprend la version la plus récente.
                dirtyRef.current = false;
                setLibrary(err.data.library);
                save(`library.${s.profileId}`, err.data.library);
                setSaveState('saved');
                toast('Ta liste a été modifiée sur un autre appareil. La version la plus récente est affichée.', { tone: 'error', duration: 6000 });
            } else if (!handleAuthError(err)) {
                dirtyRef.current = true;
                setSaveState('error');
                toast(`Enregistrement impossible : ${err.message}`, { tone: 'error' });
            }
        } finally {
            savingRef.current = false;
            if (dirtyRef.current) timerRef.current = setTimeout(() => flushRef.current(), SAVE_DELAY);
        }
    }, [handleAuthError, toast, writeTokenFor]);
    flushRef.current = flush;

    const scheduleSave = useCallback(() => {
        dirtyRef.current = true;
        setSaveState('pending');
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => flushRef.current(), SAVE_DELAY);
    }, []);

    // Enregistre avant de quitter la page ; recharge la liste au retour sur l'onglet.
    useEffect(() => {
        const onHide = () => {
            if (document.visibilityState === 'hidden') flushRef.current();
            else if (!dirtyRef.current && !savingRef.current && sessionRef.current) {
                api.getLibrary(sessionRef.current.profileId)
                    .then((data) => {
                        if (!dirtyRef.current && data.version !== libraryRef.current?.version) setLibrary(data);
                    })
                    .catch(() => {});
            }
        };
        const onUnload = (e) => {
            if (dirtyRef.current) {
                flushRef.current();
                e.preventDefault();
            }
        };
        document.addEventListener('visibilitychange', onHide);
        window.addEventListener('beforeunload', onUnload);
        return () => {
            document.removeEventListener('visibilitychange', onHide);
            window.removeEventListener('beforeunload', onUnload);
        };
    }, []);

    // ---------- Modifications de la bibliothèque ----------

    const guard = useCallback(() => {
        if (sessionRef.current?.mode !== 'owner') {
            toast('Lecture seule : déverrouille le profil pour modifier la liste.');
            return false;
        }
        return true;
    }, [toast]);

    const mutate = useCallback(
        (fn) => {
            if (!guard()) return;
            setLibrary((lib) => (lib ? fn(lib) : lib));
            scheduleSave();
        },
        [guard, scheduleSave],
    );

    // touch=false : mise à jour technique (infos MAL) qui ne compte pas comme « modifié récemment ».
    const updateItem = useCallback(
        (id, updater, { touch = true } = {}) =>
            mutate((lib) => ({
                ...lib,
                items: lib.items.map((it) => {
                    if (it.id !== id) return it;
                    const next = typeof updater === 'function' ? updater(it) : { ...it, ...updater };
                    return touch ? { ...next, updatedAt: Date.now() } : next;
                }),
            })),
        [mutate],
    );

    const addItem = useCallback((item) => mutate((lib) => ({ ...lib, items: [...lib.items, item] })), [mutate]);

    const removeItem = useCallback((id) => mutate((lib) => ({ ...lib, items: lib.items.filter((it) => it.id !== id) })), [mutate]);

    const replaceLibrary = useCallback(
        (items, lastKnownTotals) => mutate((lib) => ({ ...lib, items, lastKnownTotals: lastKnownTotals ?? lib.lastKnownTotals })),
        [mutate],
    );

    const setKnownTotals = useCallback(
        (totals) => mutate((lib) => ({ ...lib, lastKnownTotals: { ...lib.lastKnownTotals, ...totals } })),
        [mutate],
    );

    // ---------- Démarrage ----------

    useEffect(() => {
        (async () => {
            const list = await refreshProfiles();
            const last = load('lastProfile');
            if (list && last && list.some((p) => p.id === last)) await resume(last);
            setBooting(false);
        })();
    }, [refreshProfiles, resume]);

    // Mise à jour silencieuse des statuts/totaux (au plus une fois par heure, comme avant).
    const checkedRef = useRef(null);
    useEffect(() => {
        if (!session || session.mode !== 'owner' || !library || checkedRef.current === session.profileId) return;
        checkedRef.current = session.profileId;
        const key = `lastAutoCheck.${session.profileId}`;
        if (Date.now() - load(key, 0) < AUTO_CHECK_EVERY) return;
        save(key, Date.now());
        const profileId = session.profileId;
        (async () => {
            const items = library.items.filter((it) => !(it.status === 'completed' && (it.malId || it.anilistId) && it.imageUrl));
            for (let start = 0; start < items.length; start += 50) {
                if (sessionRef.current?.profileId !== profileId) return;
                const chunk = items.slice(start, start + 50);
                let entries;
                try {
                    entries = await findEntries(chunk);
                } catch {
                    return; /* sources indisponibles : on réessaiera plus tard */
                }
                const updates = new Map();
                chunk.forEach((item, k) => {
                    const info = summarize(entries[k]);
                    if (!info) return;
                    const changes = {};
                    if (!item.malId && info.malId) changes.malId = info.malId;
                    if (!item.anilistId && info.anilistId) changes.anilistId = info.anilistId;
                    if (info.status !== item.status) changes.status = info.status;
                    if (!item.seasons?.length && info.total && info.total !== item.total && info.total > (item.current || 0)) changes.total = info.total;
                    if (!item.imageUrl && info.imageUrl) changes.imageUrl = info.imageUrl;
                    if (Object.keys(changes).length) updates.set(item.id, changes);
                });
                if (updates.size && sessionRef.current?.profileId === profileId) {
                    setLibrary((lib) => lib && { ...lib, items: lib.items.map((it) => (updates.has(it.id) ? { ...it, ...updates.get(it.id) } : it)) });
                    scheduleSave();
                }
            }
        })();
    }, [session, library, scheduleSave]);

    const value = {
        booting,
        hasEntered,
        profiles,
        profilesError,
        refreshProfiles,
        session,
        profile,
        readOnly,
        // L'administrateur est connecté sur cet appareil : il peut gérer tous les profils.
        hasAdminAccess: session?.mode === 'owner' && !!load('adminToken'),
        library,
        saveState,
        task,
        setTask,
        resume,
        unlock,
        spectate,
        createProfile,
        leave,
        logout,
        renameProfile,
        changePin,
        setProfilePhoto,
        deleteProfile,
        updateItem,
        addItem,
        removeItem,
        replaceLibrary,
        setKnownTotals,
        flush,
        writeTokenFor,
    };

    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useApp = () => useContext(AppContext);
