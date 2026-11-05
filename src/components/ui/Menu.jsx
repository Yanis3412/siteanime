// Menu déroulant accessible au clavier (flèches, Échap) qui se ferme au clic extérieur.
import { useEffect, useRef, useState } from 'react';

export function Menu({ trigger, items, align = 'end', label }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);
    const listRef = useRef(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (e) => {
            if (!rootRef.current?.contains(e.target)) setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('touchstart', onDown);
        listRef.current?.querySelector('button:not(:disabled)')?.focus();
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('touchstart', onDown);
        };
    }, [open]);

    const onKeyDown = (e) => {
        const buttons = [...(listRef.current?.querySelectorAll('button:not(:disabled)') || [])];
        const index = buttons.indexOf(document.activeElement);
        if (e.key === 'Escape') {
            e.stopPropagation();
            setOpen(false);
            rootRef.current?.querySelector('[aria-haspopup]')?.focus();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            buttons[(index + 1) % buttons.length]?.focus();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            buttons[(index - 1 + buttons.length) % buttons.length]?.focus();
        }
    };

    return (
        <div className="menu" ref={rootRef} onKeyDown={onKeyDown}>
            {trigger({
                'aria-haspopup': 'menu',
                'aria-expanded': open,
                'aria-label': label,
                onClick: (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen((o) => !o);
                },
            })}
            {open && (
                <div className={`menu__list menu__list--${align}`} role="menu" ref={listRef}>
                    {items.filter(Boolean).map((item, i) => {
                        if (item === 'separator') return <div key={i} className="menu__sep" role="separator" />;
                        if (item.header) {
                            return (
                                <div key={i} className="menu__header">
                                    {item.header}
                                </div>
                            );
                        }
                        const Icon = item.icon;
                        return (
                            <button
                                key={i}
                                role="menuitem"
                                className={`menu__item ${item.danger ? 'menu__item--danger' : ''}`}
                                disabled={item.disabled}
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setOpen(false);
                                    item.onSelect?.();
                                }}
                            >
                                {Icon && <Icon size={16} aria-hidden="true" />}
                                <span>{item.label}</span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
