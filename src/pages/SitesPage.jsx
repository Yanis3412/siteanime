// Liens rapides vers les sites de lecture et de streaming.
import { ExternalLink } from 'lucide-react';

const GROUPS = [
    {
        title: 'Mangas',
        sites: [
            { name: 'Lel Manga', url: 'https://www.lelmanga.com/manga' },
            { name: 'Crunchyscan', url: 'https://crunchyscan.fr/' },
            { name: 'MANGA Plus', url: 'https://mangaplus.shueisha.co.jp/updates' },
            { name: 'Sushi Scan', url: 'https://sushiscan.net/' },
            { name: 'Asura Comic', url: 'https://asuracomic.net/' },
            { name: 'Manga Scantrad', url: 'https://manga-scantrad.io/' },
            { name: 'Punk Records', url: 'https://punkrecordz.com/' },
            { name: 'Manga Nova', url: 'https://www.manga-nova.com/' },
        ],
    },
    {
        title: 'Animes',
        sites: [
            { name: 'Crunchyroll', url: 'https://www.crunchyroll.com/fr/discover' },
            { name: 'Anime Sama', url: 'https://anime-sama.eu/' },
        ],
    },
];

export function SitesPage() {
    return (
        <div className="page">
            <div className="page__head">
                <h1 className="page__title">Sites</h1>
            </div>
            <div className="sites">
                {GROUPS.map((g) => (
                    <section key={g.title} className="sites__group">
                        <h2 className="section-title">{g.title}</h2>
                        <ul className="sites__list">
                            {g.sites.map((s) => (
                                <li key={s.url}>
                                    <a className="site" href={s.url} target="_blank" rel="noopener noreferrer">
                                        <img className="site__icon" src={`https://www.google.com/s2/favicons?domain=${new URL(s.url).hostname}&sz=64`} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                                        <span className="site__name">{s.name}</span>
                                        <span className="site__host">{new URL(s.url).hostname.replace(/^www\./, '')}</span>
                                        <ExternalLink size={16} aria-hidden="true" className="site__arrow" />
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </section>
                ))}
            </div>
        </div>
    );
}
