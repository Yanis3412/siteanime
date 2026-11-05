// Couverture d'une œuvre, avec une initiale en secours si l'image ne charge pas.
import { useState } from 'react';

export function Cover({ src, title, className = '', eager = false }) {
    const [failed, setFailed] = useState(false);
    const showImage = src && !failed;
    return (
        <div className={`cover ${className}`}>
            {showImage ? (
                <img
                    src={src}
                    alt=""
                    loading={eager ? 'eager' : 'lazy'}
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={() => setFailed(true)}
                />
            ) : (
                <span className="cover__fallback" aria-hidden="true">
                    {title?.trim()?.charAt(0)?.toUpperCase() || '?'}
                </span>
            )}
        </div>
    );
}
