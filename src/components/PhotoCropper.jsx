// Cadrage avant l'enregistrement : on déplace l'image dans le cadre, on zoome (curseur, molette,
// pincement) et, pour une photo fixe, on peut la faire pivoter.
// mode « avatar » : cercle, aperçu aux tailles réelles. mode « banner » : bannière au format 3:1.
// onConfirm({ image, framing }) : image = photo 256 × 256 prête à envoyer (mode avatar),
// framing = { x, y, s } cadrage relatif au cadre, pour afficher un GIF ou une bannière à n'importe quelle taille.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { RotateCw, Scan, ZoomIn, ZoomOut } from 'lucide-react';
import { Dialog } from './ui/Dialog.jsx';
import { renderAvatar } from '../lib/avatarImage.js';

const VIEW = 272; // côté de la zone de cadrage, en pixels
const MAX_ZOOM = 5;
const PREVIEWS = [88, 36];

export const BANNER_RATIO = 3;

export function PhotoCropper({ photo, name, onCancel, onConfirm, busy, mode = 'avatar' }) {
    const banner = mode === 'banner';
    return (
        <Dialog
            open={!!photo}
            onClose={busy ? () => {} : onCancel}
            title={banner ? 'Cadrer la bannière' : 'Cadrer la photo'}
            description={banner ? 'Fais glisser l’image pour choisir la partie visible.' : 'Fais glisser l’image pour la placer dans le cercle.'}
            size={banner ? 'lg' : 'md'}
            className="crop-dialog"
        >
            {photo &&
                (banner ? (
                    <BannerCropper key={photo.url} photo={photo} onCancel={onCancel} onConfirm={onConfirm} busy={busy} />
                ) : (
                    <Cropper key={photo.url} photo={photo} name={name} onCancel={onCancel} onConfirm={onConfirm} busy={busy} />
                ))}
        </Dialog>
    );
}

// La bannière prend toute la largeur de la fenêtre : on mesure la place avant d'afficher le cadre.
function BannerCropper(props) {
    const ref = useRef(null);
    const [width, setWidth] = useState(0);
    useLayoutEffect(() => setWidth(Math.min(640, ref.current?.clientWidth || 0)), []);
    return (
        <div ref={ref} className="crop-measure">
            {width > 0 && <Cropper {...props} frame={{ w: width, h: Math.round(width / BANNER_RATIO) }} banner />}
        </div>
    );
}

function Cropper({ photo, name, onCancel, onConfirm, busy, frame = { w: VIEW, h: VIEW }, banner = false }) {
    const W = frame.w;
    const H = frame.h;
    const canRotate = !banner && !photo.animated; // un GIF ne peut pas pivoter sans perdre l'animation
    const [rotation, setRotation] = useState(0);
    const [zoom, setZoom] = useState(1);
    const [pos, setPos] = useState({ x: 0, y: 0 });
    const viewRef = useRef(null);
    const pointers = useRef(new Map());
    const gesture = useRef(null);

    const turned = rotation % 180 !== 0;
    const rw = turned ? photo.height : photo.width;
    const rh = turned ? photo.width : photo.height;
    const scaleFor = useCallback((z) => Math.max(W / rw, H / rh) * z, [rw, rh, W, H]);
    const scale = scaleFor(zoom);

    // L'image doit toujours couvrir tout le cadre.
    const clamp = useCallback(
        (p, z = zoom) => {
            const s = scaleFor(z);
            const mx = Math.max(0, (rw * s - W) / 2);
            const my = Math.max(0, (rh * s - H) / 2);
            return { x: Math.min(mx, Math.max(-mx, p.x)), y: Math.min(my, Math.max(-my, p.y)) };
        },
        [rw, rh, scaleFor, zoom, W, H],
    );

    const applyZoom = useCallback(
        (z) => {
            const next = Math.min(MAX_ZOOM, Math.max(1, z));
            // On garde le même point au centre du cercle.
            setPos((p) => clamp({ x: (p.x * next) / zoom, y: (p.y * next) / zoom }, next));
            setZoom(next);
        },
        [clamp, zoom],
    );

    useEffect(() => {
        setPos((p) => clamp(p));
    }, [rotation, clamp]);

    // Molette : zoom (écouteur non passif pour ne pas faire défiler la page).
    useEffect(() => {
        const el = viewRef.current;
        const onWheel = (e) => {
            e.preventDefault();
            applyZoom(zoom * Math.exp(-e.deltaY * 0.0015));
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [applyZoom, zoom]);

    const onPointerDown = (e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const pts = [...pointers.current.values()];
        gesture.current =
            pts.length === 2
                ? { pinch: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), zoom }
                : { x: e.clientX, y: e.clientY, pos };
    };
    const onPointerMove = (e) => {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const g = gesture.current;
        const pts = [...pointers.current.values()];
        if (g?.pinch && pts.length === 2) {
            applyZoom((g.zoom * Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)) / g.pinch);
        } else if (g && !g.pinch) {
            setPos(clamp({ x: g.pos.x + e.clientX - g.x, y: g.pos.y + e.clientY - g.y }));
        }
    };
    const onPointerUp = (e) => {
        pointers.current.delete(e.pointerId);
        const rest = [...pointers.current.values()];
        gesture.current = rest.length === 1 ? { x: rest[0].x, y: rest[0].y, pos } : null;
    };

    const onKeyDown = (e) => {
        const step = e.shiftKey ? 20 : 4;
        const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        if (moves[e.key]) {
            e.preventDefault();
            setPos((p) => clamp({ x: p.x + moves[e.key][0], y: p.y + moves[e.key][1] }));
        } else if (e.key === '+' || e.key === '=') applyZoom(zoom * 1.1);
        else if (e.key === '-') applyZoom(zoom / 1.1);
    };

    const crop = { x: pos.x, y: pos.y, scale, rotation };
    const imgStyle = {
        width: photo.width,
        height: photo.height,
        marginLeft: -photo.width / 2,
        marginTop: -photo.height / 2,
        transform: `translate(${pos.x}px, ${pos.y}px) rotate(${rotation}deg) scale(${scale})`,
    };

    const confirm = async () =>
        onConfirm({
            image: banner ? null : await renderAvatar(photo, crop, VIEW),
            framing: { x: pos.x / W, y: pos.y / H, s: zoom },
        });

    const zoomControls = (
        <div className="crop__zoom">
            <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => applyZoom(zoom / 1.2)} aria-label="Dézoomer" disabled={zoom <= 1}>
                <ZoomOut size={17} />
            </button>
            <input
                type="range"
                min="1"
                max={MAX_ZOOM}
                step="0.01"
                value={zoom}
                onChange={(e) => applyZoom(Number(e.target.value))}
                aria-label="Zoom"
                style={{ '--p': `${((zoom - 1) / (MAX_ZOOM - 1)) * 100}%` }}
            />
            <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => applyZoom(zoom * 1.2)} aria-label="Zoomer" disabled={zoom >= MAX_ZOOM}>
                <ZoomIn size={17} />
            </button>
        </div>
    );

    if (banner) {
        return (
            <div className="crop crop--banner">
                <div
                    ref={viewRef}
                    className="crop__view crop__view--banner"
                    style={{ width: W, height: H }}
                    tabIndex={0}
                    role="application"
                    aria-label="Cadrage de la bannière. Flèches pour déplacer, plus et moins pour zoomer."
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    onKeyDown={onKeyDown}
                >
                    <img src={photo.url} alt="" draggable="false" style={imgStyle} />
                </div>
                <div className="crop__banner-tools">
                    {zoomControls}
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => {
                            setZoom(1);
                            setPos({ x: 0, y: 0 });
                        }}
                    >
                        <Scan size={15} aria-hidden="true" />
                        Recentrer
                    </button>
                </div>
                <div className="crop__actions">
                    <button type="button" className="btn btn--secondary" onClick={onCancel} disabled={busy}>
                        Annuler
                    </button>
                    <button type="button" className="btn btn--primary" onClick={confirm} disabled={busy}>
                        {busy ? 'Envoi…' : 'Enregistrer la bannière'}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="crop">
            <div className="crop__main">
                <div
                    ref={viewRef}
                    className="crop__view"
                    style={{ width: VIEW, height: VIEW }}
                    tabIndex={0}
                    role="application"
                    aria-label="Cadrage de la photo. Flèches pour déplacer, plus et moins pour zoomer."
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    onKeyDown={onKeyDown}
                >
                    <img src={photo.url} alt="" draggable="false" style={imgStyle} />
                    <div className="crop__mask" aria-hidden="true" />
                </div>

                {zoomControls}
                <div className="crop__tools">
                    {canRotate && (
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRotation((r) => (r + 90) % 360)}>
                            <RotateCw size={15} aria-hidden="true" />
                            Pivoter
                        </button>
                    )}
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => {
                            setZoom(1);
                            setPos({ x: 0, y: 0 });
                        }}
                    >
                        <Scan size={15} aria-hidden="true" />
                        Recentrer
                    </button>
                </div>
            </div>

            <div className="crop__side">
                <p className="field__label">Aperçu</p>
                <div className="crop__previews">
                    {PREVIEWS.map((size) => (
                        <span key={size} className="crop__preview" style={{ width: size, height: size }}>
                            <span className="crop__preview-inner" style={{ width: VIEW, height: VIEW, transform: `scale(${size / VIEW})` }}>
                                <img src={photo.url} alt="" draggable="false" style={imgStyle} />
                            </span>
                        </span>
                    ))}
                </div>
                <p className="crop__name">{name}</p>
                {photo.animated && <p className="field__hint crop__note">Le GIF bouge sur ta page de profil. Ailleurs, c’est sa première image qui s’affiche.</p>}
                <div className="crop__actions">
                    <button type="button" className="btn btn--secondary" onClick={onCancel} disabled={busy}>
                        Annuler
                    </button>
                    <button type="button" className="btn btn--primary" onClick={confirm} disabled={busy}>
                        {busy ? 'Enregistrement…' : 'Enregistrer la photo'}
                    </button>
                </div>
            </div>
        </div>
    );
}
