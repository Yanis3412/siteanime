// Image (ou GIF) affichée avec son cadrage { x, y, s }, à n'importe quelle taille :
// remplit le cadre comme « cover », zoomée de s, décalée de x et y (en fraction du cadre).
export function Framed({ src, frame, className = '', alt = '' }) {
    const { x = 0, y = 0, s = 1 } = frame || {};
    return (
        <span className={`framed ${className}`}>
            <img src={src} alt={alt} draggable="false" style={{ transform: `translate(${x * 100}%, ${y * 100}%) scale(${s})` }} />
        </span>
    );
}
