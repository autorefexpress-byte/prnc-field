// Lecture automatique d'un bon de livraison interne (photo manuscrite) avec Claude.
// POST { photos: [url Cloudinary, ...], clients: [noms déjà connus] }
// -> { date_preparation, date_livraison, preparateur, livreur, lignes: [...] }
const { Anthropic } = require('@anthropic-ai/sdk');

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'dns5b6fix';
const PHOTO_PREFIX = `https://res.cloudinary.com/${CLOUD_NAME}/`;
const MAX_PHOTOS = 4;

const SYSTEM = `Tu lis des photos de « BON DE LIVRAISON INTERNE » de Prony Resources (formulaire G-OA-FM-xx), remplis à la main par le magasin.

Le formulaire contient :
- En-tête : « Nom du préparateur », « Date de préparation », « Nom du livreur », « Date de livraison ».
- Un tableau, une ligne par article livré, avec les colonnes : « N° BDS / N° PO », « Qty chargés » (un nombre suivi de « Colis/palette »), « Lieu de livraison », « Nom & Prénom du client », « Téléphone client », « Signatures ».

Règles de lecture :
- Le N° BDS / PO est une lettre majuscule suivie de 5 chiffres (ex. C38346, A36864, L80709). Écris-le sans espace. Ne confonds pas S et 5, O et 0, I et 1, Z et 2.
- Des guillemets (" ou 〃 ou ‚‚) dans une case veulent dire « même valeur que la ligne au-dessus » : remplace-les par la valeur réelle de la ligne au-dessus (en remontant si nécessaire).
- Le nom du client s'écrit en général NOM.Initiale (ex. ZEOULA.P). Si une liste de clients connus est fournie et qu'un nom manuscrit lui correspond manifestement, utilise l'orthographe de la liste.
- Ignore le surlignage de couleur, les signatures et le numéro de téléphone.
- Ne retiens que les lignes qui ont un N° BDS / PO ou un client. Ignore les lignes vides.
- Dates au format jj/mm/aaaa ; chaîne vide si absente ou illisible.
- Si une valeur est douteuse, donne ta meilleure lecture et mets « incertain » à true pour cette ligne.
- Plusieurs photos peuvent être les pages successives d'un même bon : renvoie toutes les lignes dans l'ordre.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['date_preparation', 'date_livraison', 'preparateur', 'livreur', 'lignes'],
  properties: {
    date_preparation: { type: 'string' },
    date_livraison: { type: 'string' },
    preparateur: { type: 'string' },
    livreur: { type: 'string' },
    lignes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['bds', 'qte', 'lieu', 'client', 'incertain'],
        properties: {
          bds: { type: 'string' },
          qte: { type: 'integer' },
          lieu: { type: 'string' },
          client: { type: 'string' },
          incertain: { type: 'boolean' }
        }
      }
    }
  }
};

let _client = null;
function client() {
  if (!_client) _client = new Anthropic();
  return _client;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST uniquement' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'not_configured', message: 'Lecture automatique non configurée (clé ANTHROPIC_API_KEY absente sur Vercel).' });
  }

  const body = req.body || {};
  // Uniquement nos propres photos Cloudinary : la fonction ne doit pas servir à lire n'importe quelle image
  const photos = (Array.isArray(body.photos) ? body.photos : [])
    .filter(u => typeof u === 'string' && u.startsWith(PHOTO_PREFIX))
    .slice(0, MAX_PHOTOS);
  if (!photos.length) return res.status(400).json({ error: 'Aucune photo valide' });

  const clients = (Array.isArray(body.clients) ? body.clients : [])
    .filter(c => typeof c === 'string' && c.trim())
    .map(c => c.trim().slice(0, 40))
    .slice(0, 200);

  const content = photos.map(url => ({ type: 'image', source: { type: 'url', url } }));
  content.push({
    type: 'text',
    text: (clients.length ? 'Clients connus : ' + clients.join(', ') + '\n\n' : '') +
      'Lis ce bon de livraison et renvoie son contenu.'
  });

  try {
    const response = await client().beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content }]
    });

    if (response.stop_reason === 'refusal') {
      return res.status(422).json({ error: 'refusal', message: 'La photo n\'a pas pu être analysée.' });
    }
    if (response.stop_reason === 'max_tokens') {
      return res.status(502).json({ error: 'truncated', message: 'Réponse incomplète, réessayez.' });
    }
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const data = JSON.parse(text);
    return res.status(200).json(data);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'rate_limited', message: 'Trop de demandes, réessayez dans une minute.' });
    }
    if (e instanceof Anthropic.AuthenticationError) {
      console.error('lire-bl auth err', e.message);
      return res.status(503).json({ error: 'not_configured', message: 'Clé ANTHROPIC_API_KEY invalide sur Vercel.' });
    }
    if (e instanceof Anthropic.APIError) {
      console.error('lire-bl api err', e.status, e.message);
      return res.status(502).json({ error: 'api_error', message: 'Le service de lecture a répondu une erreur (' + e.status + ').' });
    }
    console.error('lire-bl err', e);
    return res.status(500).json({ error: 'internal', message: 'Erreur pendant la lecture de la photo.' });
  }
};
