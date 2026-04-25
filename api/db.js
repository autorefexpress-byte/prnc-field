// api/db.js - Vercel Function → Neon proxy
const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = 'postgresql://neondb_owner:npg_tOasz0jxXp2M@ep-blue-tree-a79w2h77.ap-southeast-2.aws.neon.tech/neondb?sslmode=require';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  let sql;
  try {
    sql = neon(DATABASE_URL);
  } catch(e) {
    return res.status(500).json({ error: 'DB connection failed: ' + e.message });
  }

  try {
    const method = req.method;
    const id = req.query ? req.query.id : null;

    // GET — charger tous les enregistrements
    if (method === 'GET') {
      const rows = await sql`
        SELECT id, type, tag, wo, wo_usine, wr, wg, sc, loc, statut, 
               date, heure, description, serie, type_eqt, qty, shutdown, 
               motif, zone, from_fiche, email_demandeur, 
               etna_statut, etna_date_retour, etna_commentaire,
               callidus_statut, callidus_date_retour, callidus_commentaire,
               dest, photos, created_at
        FROM historique 
        ORDER BY created_at DESC 
        LIMIT 500
      `;
      return res.status(200).json(rows);
    }

    // POST — ajouter un enregistrement
    if (method === 'POST') {
      const d = req.body || {};
      const photos = JSON.stringify(d.photos || []);
      const dest   = JSON.stringify(d.dest   || []);
      
      await sql`
        INSERT INTO historique 
          (id, type, tag, wo, wo_usine, wr, wg, sc, loc, statut, date, heure,
           description, serie, type_eqt, qty, shutdown, motif, zone, from_fiche,
           email_demandeur, etna_statut, etna_date_retour, etna_commentaire,
           callidus_statut, callidus_date_retour, callidus_commentaire, dest, photos)
        VALUES (
          ${d.id||null}, ${d.type||null}, ${d.tag||null}, ${d.wo||null},
          ${d.wo_usine||null}, ${d.wr||null}, ${d.wg||null}, ${d.sc||null},
          ${d.loc||null}, ${d.statut||null}, ${d.date||null}, ${d.heure||null},
          ${d.designation||null}, ${d.serie||null}, ${d.type_eqt||null},
          ${d.qty||null}, ${d.shutdown||null}, ${d.motif||null}, ${d.zone||null},
          ${d.from_fiche||false}, ${d.email_demandeur||null},
          ${d.etna_statut||null}, ${d.etna_date_retour||null}, ${d.etna_commentaire||null},
          ${d.callidus_statut||null}, ${d.callidus_date_retour||null},
          ${d.callidus_commentaire||null},
          ${dest}::jsonb, ${photos}::jsonb
        )
      `;
      return res.status(201).json({ ok: true });
    }

    // PATCH — mettre à jour
    if (method === 'PATCH' && id) {
      const d = req.body || {};
      const fields = Object.entries(d).filter(([k]) => k !== 'id');
      if (fields.length > 0) {
        const setParts = fields.map(([k]) => k);
        const setVals  = fields.map(([, v]) => typeof v === 'object' ? JSON.stringify(v) : String(v));
        
        // Build dynamic update safely
        let query = 'UPDATE historique SET ';
        const params = [];
        setParts.forEach((col, i) => {
          query += `${col} = $${i+1}`;
          if (i < setParts.length - 1) query += ', ';
          params.push(setVals[i]);
        });
        params.push(id);
        query += ` WHERE id = $${params.length}`;
        await sql.unsafe(query, params);
      }
      return res.status(200).json({ ok: true });
    }

    // DELETE — supprimer
    if (method === 'DELETE' && id) {
      await sql`DELETE FROM historique WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown request method: ' + method });

  } catch(e) {
    console.error('DB Error:', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
};
