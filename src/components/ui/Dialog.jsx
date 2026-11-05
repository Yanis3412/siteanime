// Fenêtre modale basée sur l'élément natif <dialog> (focus piégé et touche Échap gérés par le navigateur).
import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

export function Dialog({ open, onClose, title, description, children, footer, size = 'md', variant = 'center', className = '' }) {
    const ref = useRef(null);
    const titleId = useId();

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        if (open && !el.open) el.showModal();
        if (!open && el.open) el.close();
    }, [open]);

    return (
        <dialog
            ref={ref}
            className={`dialog dialog--${size} dialog--${variant} ${className}`}
            aria-labelledby={title ? titleId : undefined}
            onCancel={(e) => {
                e.preventDefault();
                onClose?.();
            }}
            onMouseDown={(e) => {
                // Clic sur le fond (en dehors du contenu) : fermeture.
                if (e.target === ref.current) onClose?.();
            }}
        >
            {open && (
                <div className="dialog__panel">
                    {title && (
                        <div className="dialog__head">
                            <div>
                                <h2 id={titleId} className="dialog__title">
                                    {title}
                                </h2>
                                {description && <p className="dialog__desc">{description}</p>}
                            </div>
                            <button className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Fermer">
                                <X size={18} />
                            </button>
                        </div>
                    )}
                    <div className="dialog__body">{children}</div>
                    {footer && <div className="dialog__foot">{footer}</div>}
                </div>
            )}
        </dialog>
    );
}
