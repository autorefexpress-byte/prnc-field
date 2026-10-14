// Recherche d'un article dans le catalogue magasin (catalog.json, ~120 000 entrées).
// GET ?q=<stock code ou début de stock code> -> [{ sc, item, desc, pn }] (5 au plus)
// Le catalogue est lu une fois par instance : le téléphone n'a plus à le télécharger.
const fs = require('fs');
const path = require('path');

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const MAX_RESULTATS = 5;

let _catalogue = null;
let _cles = null;

function catalogue() {
  if (!_catalogue) {
    const brut = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'catalog.json'), 'utf8'));
    // Le fichier contient chaque stock code deux fois (avec et sans les zéros de tête) :
    // on ne garde que la forme à 9 chiffres quand elle existe.
    _catalogue = {};
    for (const [k, v] of Object.entries(brut)) {
      if (/^\d+$/.test(k) && k.length < 9 && brut[k.padStart(9, '0')]) continue;
      _catalogue[k] = v;
    }
    _cles = Object.keys(_catalogue);
  }
  return _catalogue;
}

function rechercher(q) {
  const cat = catalogue();
  const avecZeros = q.padStart(9, '0');
  const sansZeros = q.replace(/^0+/, '');
  for (const k of [q, avecZeros, sansZeros]) {
    if (cat[k]) return [{ sc: k, ...cat[k] }];
  }
  const res = [];
  for (let i = 0; i < _cles.length && res.length < MAX_RESULTATS; i++) {
    const k = _cles[i];
    if (k.includes(q) || k.replace(/^0+/, '').startsWith(sansZeros)) res.push({ sc: k, ...cat[k] });
  }
  return res;
}

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET uniquement' });

  const q = String((req.query && req.query.q) || '').trim().toUpperCase().slice(0, 40);
  if (q.length < 4) return res.status(200).json([]);
  try {
    const resultats = rechercher(q);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).json(resultats);
  } catch (e) {
    console.error('article err', e);
    return res.status(500).json({ error: 'Catalogue indisponible' });
  }
};
