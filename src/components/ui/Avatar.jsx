// Pastille avec les initiales d'un profil. La teinte dépend du nom, pour reconnaître chacun.
export function Avatar({ name = '', size = 'md' }) {
    const initials = name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w.charAt(0).toUpperCase())
        .join('');
    let hash = 0;
    for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const hue = hash % 360;
    return (
        <span className={`avatar avatar--${size}`} style={{ '--avatar-hue': hue }} aria-hidden="true">
            {initials || '?'}
        </span>
    );
}
