// Liens rapides vers les sites de lecture et de streaming.
// L'administrateur peut les modifier ici : ajouter, renommer, réordonner, supprimer.
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../state/app.jsx';
import { useUi } from '../state/ui.jsx';
import { api } from '../lib/api.js';
import { load, save } from '../lib/storage.js';
import { DEFAULT_SITES } from '../data/defaultSites.js';

let nextKey = 1;
const withKeys = (groups) =>
    groups.map((g) => ({ key: nextKey++, title: g.title, sites: g.sites.map((s) => ({ key: nextKey++, name: s.name, url: s.url })) }));

function hostOf(url) {
    try {
        return new URL(/^[a-z]+:/i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '');
    } catch {
        return '';
    }
}

const favicon = (url) => `https://www.google.com/s2/favicons?domain=${hostOf(url)}&sz=64`;

export function SitesPage() {
    const { hasAdminAccess, session } = useApp();
    const { toast, confirm } = useUi();
    const [groups, setGroups] = useState(() => load('sites') || DEFAULT_SITES);
    const [draft, setDraft] = useState(null); // en cours de modification
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        api.getSites()
            .then((data) => {
                const list = data.groups || DEFAULT_SITES;
                setGroups(list);
                save('sites', data.groups ? list : null);
            })
            .catch(() => {});
    }, []);

    const startEditing = () => setDraft(withKeys(groups));

    const cancel = async () => {
        const changed = JSON.stringify(strip(draft)) !== JSON.stringify(groups);
        if (changed && !(await confirm({ title: 'Abandonner les modifications ?', message: 'Les changements faits sur les liens seront perdus.', confirmLabel: 'Abandonner', danger: true }))) return;
        setDraft(null);
    };

    const submit = async () => {
        setSaving(true);
        try {
            const data = await api.saveSites(strip(draft), session.token);
            setGroups(data.groups);
            save('sites', data.groups);
            setDraft(null);
            toast('Liens enregistrés.', { tone: 'success' });
        } catch (err) {
            toast(err.message, { tone: 'error' });
        } finally {
            setSaving(false);
        }
    };

    // ---- Modifications du brouillon ----
    const setGroup = (gi, patch) => setDraft((d) => d.map((g, i) => (i === gi ? { ...g, ...patch } : g)));
    const setSite = (gi, si, patch) => setGroup(gi, { sites: draft[gi].sites.map((s, i) => (i === si ? { ...s, ...patch } : s)) });
    const moveSite = (gi, si, dir) => {
        const sites = [...draft[gi].sites];
        const to = si + dir;
        if (to < 0 || to >= sites.length) return;
        [sites[si], sites[to]] = [sites[to], sites[si]];
        setGroup(gi, { sites });
    };
    const removeSite = (gi, si) => setGroup(gi, { sites: draft[gi].sites.filter((_, i) => i !== si) });
    const addSite = (gi) => setGroup(gi, { sites: [...draft[gi].sites, { key: nextKey++, name: '', url: '' }] });
    const moveGroup = (gi, dir) =>
        setDraft((d) => {
            const list = [...d];
            const to = gi + dir;
            if (to < 0 || to >= list.length) return d;
            [list[gi], list[to]] = [list[to], list[gi]];
            return list;
        });
    const removeGroup = async (gi) => {
        const g = draft[gi];
        if (g.sites.length && !(await confirm({ title: `Supprimer « ${g.title || 'Sans nom'} » ?`, message: `Ses ${g.sites.length} liens seront supprimés.`, confirmLabel: 'Supprimer', danger: true }))) return;
        setDraft((d) => d.filter((_, i) => i !== gi));
    };
    const addGroup = () => setDraft((d) => [...d, { key: nextKey++, title: '', sites: [{ key: nextKey++, name: '', url: '' }] }]);

    return (
        <div className="page">
            <div className="page__head">
                <h1 className="page__title">Sites</h1>
                {hasAdminAccess && !draft && (
                    <button className="btn btn--secondary" onClick={startEditing}>
                        <Pencil size={16} aria-hidden="true" />
                        Modifier les liens
                    </button>
                )}
                {draft && (
                    <div className="page__actions">
                        <button className="btn btn--secondary" onClick={cancel} disabled={saving}>
                            Annuler
                        </button>
                        <button className="btn btn--primary" onClick={submit} disabled={saving}>
                            {saving ? 'Enregistrement…' : 'Enregistrer'}
                        </button>
                    </div>
                )}
            </div>

            {!draft ? (
                <div className="sites">
                    {groups.map((g) => (
                        <section key={g.title} className="sites__group">
                            <h2 className="section-title">{g.title}</h2>
                            <ul className="sites__list">
                                {g.sites.map((s) => (
                                    <li key={s.url}>
                                        <a className="site" href={s.url} target="_blank" rel="noopener noreferrer">
                                            <img className="site__icon" src={favicon(s.url)} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                                            <span className="site__name">{s.name}</span>
                                            <span className="site__host">{hostOf(s.url)}</span>
                                            <ExternalLink size={16} aria-hidden="true" className="site__arrow" />
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ))}
                </div>
            ) : (
                <div className="sites-edit">
                    {draft.map((g, gi) => (
                        <section key={g.key} className="sites-edit__group">
                            <div className="sites-edit__head">
                                <input
                                    className="input sites-edit__title"
                                    value={g.title}
                                    maxLength={40}
                                    placeholder="Nom de la catégorie"
                                    aria-label="Nom de la catégorie"
                                    onChange={(e) => setGroup(gi, { title: e.target.value })}
                                />
                                <IconButton label="Monter la catégorie" onClick={() => moveGroup(gi, -1)} disabled={gi === 0}>
                                    <ArrowUp size={16} />
                                </IconButton>
                                <IconButton label="Descendre la catégorie" onClick={() => moveGroup(gi, 1)} disabled={gi === draft.length - 1}>
                                    <ArrowDown size={16} />
                                </IconButton>
                                <IconButton label="Supprimer la catégorie" onClick={() => removeGroup(gi)} danger>
                                    <Trash2 size={16} />
                                </IconButton>
                            </div>
                            <ul className="sites-edit__list">
                                {g.sites.map((s, si) => (
                                    <li key={s.key} className="sites-edit__row">
                                        <img className="site__icon" src={hostOf(s.url) ? favicon(s.url) : undefined} alt="" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} onLoad={(e) => (e.currentTarget.style.visibility = 'visible')} />
                                        <input
                                            className="input sites-edit__name"
                                            value={s.name}
                                            maxLength={60}
                                            placeholder={hostOf(s.url) || 'Nom'}
                                            aria-label="Nom du site"
                                            onChange={(e) => setSite(gi, si, { name: e.target.value })}
                                        />
                                        <input
                                            className="input sites-edit__url"
                                            value={s.url}
                                            maxLength={400}
                                            inputMode="url"
                                            placeholder="https://…"
                                            aria-label="Adresse du site"
                                            onChange={(e) => setSite(gi, si, { url: e.target.value })}
                                        />
                                        <div className="sites-edit__tools">
                                            <IconButton label="Monter" onClick={() => moveSite(gi, si, -1)} disabled={si === 0}>
                                                <ArrowUp size={16} />
                                            </IconButton>
                                            <IconButton label="Descendre" onClick={() => moveSite(gi, si, 1)} disabled={si === g.sites.length - 1}>
                                                <ArrowDown size={16} />
                                            </IconButton>
                                            <IconButton label="Supprimer le site" onClick={() => removeSite(gi, si)} danger>
                                                <Trash2 size={16} />
                                            </IconButton>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                            <button className="btn btn--ghost btn--sm sites-edit__add" onClick={() => addSite(gi)}>
                                <Plus size={16} aria-hidden="true" />
                                Ajouter un site
                            </button>
                        </section>
                    ))}
                    <button className="btn btn--secondary sites-edit__add-group" onClick={addGroup}>
                        <Plus size={16} aria-hidden="true" />
                        Ajouter une catégorie
                    </button>
                    <p className="field__hint">Le nom est facultatif : sans nom, l’adresse du site est utilisée.</p>
                </div>
            )}
        </div>
    );
}

function IconButton({ label, children, danger, ...props }) {
    return (
        <button type="button" className={`btn btn--ghost btn--icon btn--sm ${danger ? 'sites-edit__danger' : ''}`} aria-label={label} title={label} {...props}>
            {children}
        </button>
    );
}

// Retire les clés internes et les lignes vides avant l'envoi.
function strip(draft) {
    return draft.map((g) => ({
        title: g.title.trim(),
        sites: g.sites.filter((s) => s.url.trim() || s.name.trim()).map((s) => ({ name: s.name.trim(), url: s.url.trim() })),
    }));
}
