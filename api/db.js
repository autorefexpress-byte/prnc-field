// api/db.js - Vercel Function → Neon proxy
const { neon } = require('@neondatabase/serverless');

const sql = neon('postgresql://neondb_owner:npg_tOasz0jxXp2M@ep-blue-tree-a79w2h77.ap-southeast-2.aws.neon.tech/neondb?sslmode=require');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const method = req.method;
    const id = req.query.id || null;

    // GET — charger tous les enregistrements
    if (method === 'GET') {
      const rows = await sql`SELECT * FROM historique ORDER BY created_at DESC LIMIT 500`;
      return res.json(rows);
    }

    // POST — ajouter un enregistrement
    if (method === 'POST') {
      const d = req.body;
      const photos = JSON.stringify(d.photos || []);
      const dest = JSON.stringify(d.dest || []);
      
      await sql`INSERT INTO historique 
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
        )`;
      return res.status(201).json({ ok: true });
    }

    // PATCH — mettre à jour
    if (method === 'PATCH' && id) {
      const d = req.body;
      const updates = [];
      const vals = [];
      let i = 1;
      
      for (const [k, v] of Object.entries(d)) {
        if (k === 'id') continue;
        updates.push(`${k} = $${i}`);
        vals.push(typeof v === 'object' ? JSON.stringify(v) : v);
        i++;
      }
      vals.push(id);
      
      if (updates.length > 0) {
        await sql.unsafe(
          `UPDATE historique SET ${updates.join(', ')} WHERE id = $${i}`,
          vals
        );
      }
      return res.status(200).json({ ok: true });
    }

    // DELETE — supprimer
    if (method === 'DELETE' && id) {
      await sql`DELETE FROM historique WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown request' });
  } catch(e) {
    console.error('DB Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
