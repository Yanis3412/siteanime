import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
    const dataFilePath = path.join(process.cwd(), 'public', 'data.json');

    // Activer CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        if (req.method === 'GET') {
            // Lire le fichier JSON
            if (!fs.existsSync(dataFilePath)) {
                return res.status(200).json({
                    library: [],
                    imageCache: {},
                    malInfoCache: {},
                    lastUpdateCheck: 0
                });
            }

            const data = fs.readFileSync(dataFilePath, 'utf-8');
            return res.status(200).json(JSON.parse(data));
        }

        if (req.method === 'POST' || req.method === 'PUT') {
            // Sauvegarder le fichier JSON
            const dataDir = path.dirname(dataFilePath);
            
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            fs.writeFileSync(dataFilePath, JSON.stringify(req.body, null, 2));
            return res.status(200).json({ success: true, message: 'Data saved successfully' });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
