export default async function handler(req, res) {
    // Activer CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
    const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!UPSTASH_URL || !UPSTASH_TOKEN) {
        return res.status(500).json({ error: 'Missing Upstash configuration' });
    }

    try {
        if (req.method === 'GET') {
            // Lire depuis Upstash Redis via REST API
            const response = await fetch(`${UPSTASH_URL}/get/anime-manga-data`, {
                headers: {
                    Authorization: `Bearer ${UPSTASH_TOKEN}`
                }
            });
            const result = await response.json();
            
            if (!result.result) {
                return res.status(200).json({
                    library: [],
                    imageCache: {},
                    malInfoCache: {},
                    lastUpdateCheck: 0
                });
            }

            // Upstash retourne les données en string JSON
            const data = typeof result.result === 'string' ? JSON.parse(result.result) : result.result;
            return res.status(200).json(data);
        }

        if (req.method === 'POST' || req.method === 'PUT') {
            // Sauvegarder dans Upstash Redis via REST API
            const bodyData = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
            
            const response = await fetch(`${UPSTASH_URL}/set/anime-manga-data/${encodeURIComponent(bodyData)}`, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${UPSTASH_TOKEN}`
                }
            });
            
            const result = await response.json();
            
            if (result.error) {
                throw new Error(result.error);
            }
            
            return res.status(200).json({ success: true, message: 'Data saved successfully' });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
