// Notifications éphémères (toasts), boîte de confirmation et thème clair/sombre.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { Dialog } from '../components/ui/Dialog.jsx';
import { load, save } from '../lib/storage.js';

const UiContext = createContext(null);

export function UiProvider({ children }) {
    const [toasts, setToasts] = useState([]);
    const [confirmState, setConfirmState] = useState(null);
    const [theme, setThemeState] = useState(() => load('theme', 'dark'));
    const idRef = useRef(0);

    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f3f4f6' : '#15171c');
        save('theme', theme);
    }, [theme]);

    const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

    const toast = useCallback(
        (message, { tone = 'info', duration = 4000, action = null } = {}) => {
            const id = ++idRef.current;
            setToasts((t) => [...t.slice(-3), { id, message, tone, action }]);
            if (duration) setTimeout(() => dismiss(id), duration);
            return id;
        },
        [dismiss],
    );

    const confirm = useCallback(
        (options) =>
            new Promise((resolve) => {
                setConfirmState({ ...options, resolve });
            }),
        [],
    );

    const closeConfirm = (result) => {
        confirmState?.resolve(result);
        setConfirmState(null);
    };

    const toggleTheme = useCallback(() => setThemeState((t) => (t === 'dark' ? 'light' : 'dark')), []);

    // Les fenêtres ouvertes passent au premier plan du navigateur (« top layer ») : sans ça, un message
    // affiché pendant qu'une fenêtre est ouverte resterait caché derrière. La zone des messages y passe
    // aussi (popover), et repasse devant à chaque nouveau message.
    const toastsRef = useRef(null);
    useEffect(() => {
        const el = toastsRef.current;
        if (!el?.showPopover) return;
        try {
            if (el.matches(':popover-open')) el.hidePopover();
            if (toasts.length) el.showPopover();
        } catch {
            /* navigateur sans popover : la zone reste affichée normalement */
        }
    }, [toasts]);

    return (
        <UiContext.Provider value={{ toast, confirm, theme, toggleTheme }}>
            {children}

            <div ref={toastsRef} className="toasts" popover="manual" role="status" aria-live="polite">
                {toasts.map((t) => {
                    const Icon = t.tone === 'error' ? CircleAlert : t.tone === 'success' ? CircleCheck : Info;
                    return (
                        <div key={t.id} className={`toast toast--${t.tone}`}>
                            <Icon size={18} aria-hidden="true" />
                            <span>{t.message}</span>
                            {t.action && (
                                <button
                                    className="toast__action"
                                    onClick={() => {
                                        dismiss(t.id);
                                        t.action.onClick();
                                    }}
                                >
                                    {t.action.label}
                                </button>
                            )}
                            <button className="toast__close" onClick={() => dismiss(t.id)} aria-label="Fermer">
                                <X size={16} />
                            </button>
                        </div>
                    );
                })}
            </div>

            <Dialog
                open={!!confirmState}
                onClose={() => closeConfirm(false)}
                title={confirmState?.title}
                size="sm"
                footer={
                    <>
                        <button className="btn btn--secondary" onClick={() => closeConfirm(false)}>
                            Annuler
                        </button>
                        <button
                            className={`btn ${confirmState?.danger ? 'btn--danger' : 'btn--primary'}`}
                            onClick={() => closeConfirm(true)}
                            autoFocus
                        >
                            {confirmState?.confirmLabel || 'Confirmer'}
                        </button>
                    </>
                }
            >
                {confirmState?.message && <p className="dialog__text">{confirmState.message}</p>}
            </Dialog>
        </UiContext.Provider>
    );
}

export const useUi = () => useContext(UiContext);
