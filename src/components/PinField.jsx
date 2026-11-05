// Champ de saisie d'un code à chiffres.
export function PinField({ label, value, onChange, autoFocus, invalid }) {
    return (
        <label className="field">
            <span className="field__label">{label}</span>
            <input
                className={`input input--pin ${invalid ? 'is-invalid' : ''}`}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                pattern="[0-9]*"
                maxLength={6}
                value={value}
                onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoFocus={autoFocus}
                aria-invalid={invalid || undefined}
            />
        </label>
    );
}
