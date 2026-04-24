// api/db.js - Vercel Function as Neon proxy
const { neon } = require('@neondatabase/serverless');

const sql = neon('postgresql://neondb_owner:npg_tOasz0jxXp2M@ep-blue-tree-a79w2h77.ap-southeast-2.aws.neon.tech/neondb?sslmode=require');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { action, table, data, filter } = req.body || {};
    const method = req.method;

    if (method === 'GET' || (method === 'POST' && action === 'select')) {
      const limit = parseInt(req.query.limit || '500');
      const rows = await sql`SELECT * FROM historique ORDER BY created_at DESC LIMIT ${limit}`;
      return res.json(rows);
    }

    if (method === 'POST' && !action) {
      const d = req.body;
      await sql`INSERT INTO historique 
        (id, type, tag, wo, wo_usine, wr, wg, sc, loc, statut, date, heure,
         description, serie, type_eqt, qty, shutdown, motif, zone, from_fiche,
         email_demandeur, etna_statut, etna_date_retour, etna_commentaire,
         callidus_statut, callidus_date_retour, callidus_commentaire, dest)
        VALUES (
          ${d.id}, ${d.type}, ${d.tag}, ${d.wo}, ${d.wo_usine || null},
          ${d.wr || null}, ${d.wg || null}, ${d.sc || null}, ${d.loc || null},
          ${d.statut || null}, ${d.date}, ${d.heure},
          ${d.designation || null}, ${d.serie || null}, ${d.type_eqt || null},
          ${d.qty || null}, ${d.shutdown || null}, ${d.motif || null},
          ${d.zone || null}, ${d.from_fiche || false},
          ${d.email_demandeur || null}, ${d.etna_statut || null},
          ${d.etna_date_retour || null}, ${d.etna_commentaire || null},
          ${d.callidus_statut || null}, ${d.callidus_date_retour || null},
          ${d.callidus_commentaire || null}, ${JSON.stringify(d.dest || [])}
        )`;
      return res.status(201).json({ ok: true });
    }

    if (method === 'PATCH') {
      const id = req.query.id;
      const d = req.body;
      const sets = Object.entries(d)
        .filter(([k]) => k !== 'id')
        .map(([k, v]) => `${k} = '${String(v).replace(/'/g,"''")}'`)
        .join(', ');
      if (sets && id) {
        await sql.unsafe(`UPDATE historique SET ${sets} WHERE id = '${id.replace(/'/g,"''")}'`);
      }
      return res.status(200).json({ ok: true });
    }

    if (method === 'DELETE') {
      const id = req.query.id;
      if (id) await sql`DELETE FROM historique WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown request' });
  } catch(e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
};
