const { neon } = require('@neondatabase/serverless');
const https  = require('https');
const crypto = require('crypto');

const sql = neon('postgresql://neondb_owner:npg_tOasz0jxXp2M@ep-blue-tree-a79w2h77.ap-southeast-2.aws.neon.tech/neondb?sslmode=require');

const CLOUD_NAME = 'dns5b6fix';
const API_KEY    = '847395583118243';
const API_SECRET = 'nBuyEerlJYeOfbD7RcHPzD2vkHU';

// ── Supprimer photos sur Cloudinary ─────────────────
async function deleteCloudinaryPhotos(photoUrls) {
  if (!photoUrls || !photoUrls.length) return;
  const public_ids = photoUrls.filter(Boolean).map(url => {
    const m = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[^.]+$/);
    return m ? m[1] : null;
  }).filter(Boolean);
  if (!public_ids.length) return;

  const timestamp    = Math.round(Date.now() / 1000);
  const sortedIds    = public_ids.sort().join(',');
  const signature    = crypto.createHash('sha256')
    .update(`public_ids=${sortedIds}&timestamp=${timestamp}${API_SECRET}`)
    .digest('hex');
  const body = new URLSearchParams({ public_ids: sortedIds, timestamp, api_key: API_KEY, signature }).toString();

  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.cloudinary.com',
      path: `/v1_1/${CLOUD_NAME}/resources/image/destroy`,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>resolve(d)); });
    req.on('error', e => { console.warn('Cloudinary delete err:', e); resolve(null); });
    req.write(body); req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const method = req.method;
    const id    = req.query?.id    || null;
    const table = req.query?.table || 'historique';

    // ── PI SUIVI ─────────────────────────────────────
    if (table === 'pi_suivi') {
      if (method === 'GET') {
        const rows = await sql`SELECT * FROM pi_suivi ORDER BY created_at DESC`;
        return res.status(200).json(rows);
      }
      if (method === 'POST') {
        const d = req.body || {};
        await sql`INSERT INTO pi_suivi (id,wo,wg,tag,loc,date,statut,pieces) VALUES (${d.id},${d.wo},${d.wg},${d.tag||null},${d.loc||null},${d.date||null},${d.statut||'En cours'},${JSON.stringify(d.pieces||[])}::jsonb)`;
        return res.status(201).json({ ok: true });
      }
      if (method === 'PATCH' && id) {
        const d = req.body || {};
        await sql`UPDATE pi_suivi SET statut=${d.statut||'En cours'},pieces=${JSON.stringify(d.pieces||[])}::jsonb,loc=${d.loc||null},tag=${d.tag||null} WHERE id=${id}`;
        return res.status(200).json({ ok: true });
      }
      if (method === 'DELETE' && id) {
        // ── SUPPRESSION EN CASCADE ──────────────────
        // 1. Récupérer le WO depuis pi_suivi
        const piRows = await sql`SELECT wo FROM pi_suivi WHERE id=${id}`;
        if (piRows.length && piRows[0].wo) {
          const wo = piRows[0].wo;

          // 2. Récupérer toutes les photos des lignes historique liées à ce WO
          const histRows = await sql`SELECT photos FROM historique WHERE wo=${wo}`;
          const allPhotos = histRows.flatMap(r => r.photos || []).filter(Boolean);

          // 3. Supprimer les photos Cloudinary
          if (allPhotos.length > 0) {
            await deleteCloudinaryPhotos(allPhotos);
          }

          // 4. Supprimer toutes les lignes historique liées à ce WO
          await sql`DELETE FROM historique WHERE wo=${wo}`;
        }

        // 5. Supprimer le WO dans pi_suivi
        await sql`DELETE FROM pi_suivi WHERE id=${id}`;
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: 'Unknown request' });
    }

    // ── HISTORIQUE GET ───────────────────────────────
    if (method === 'GET') {
      const rows = await sql`
        SELECT id,type,tag,wo,wo_usine,wr,wg,sc,loc,statut,date,heure,description,
               serie,type_eqt,qty,shutdown,motif,zone,from_fiche,email_demandeur,
               etna_statut,etna_date_retour,etna_commentaire,
               callidus_statut,callidus_date_retour,callidus_commentaire,
               dest,photos,created_at
        FROM historique ORDER BY created_at DESC LIMIT 500`;
      return res.status(200).json(rows);
    }

    // ── HISTORIQUE POST ──────────────────────────────
    if (method === 'POST') {
      const d = req.body || {};
      await sql`
        INSERT INTO historique (id,type,tag,wo,wo_usine,wr,wg,sc,loc,statut,date,heure,
          description,serie,type_eqt,qty,shutdown,motif,zone,from_fiche,email_demandeur,
          etna_statut,etna_date_retour,etna_commentaire,callidus_statut,callidus_date_retour,
          callidus_commentaire,dest,photos)
        VALUES (${d.id||null},${d.type||null},${d.tag||null},${d.wo||null},${d.wo_usine||null},
          ${d.wr||null},${d.wg||null},${d.sc||null},${d.loc||null},${d.statut||null},
          ${d.date||null},${d.heure||null},${d.designation||null},${d.serie||null},
          ${d.type_eqt||null},${d.qty||null},${d.shutdown||null},${d.motif||null},
          ${d.zone||null},${d.from_fiche||false},${d.email_demandeur||null},
          ${d.etna_statut||null},${d.etna_date_retour||null},${d.etna_commentaire||null},
          ${d.callidus_statut||null},${d.callidus_date_retour||null},${d.callidus_commentaire||null},
          ${JSON.stringify(d.dest||[])}::jsonb,${JSON.stringify(d.photos||[])}::jsonb)`;
      return res.status(201).json({ ok: true });
    }

    // ── HISTORIQUE PATCH ─────────────────────────────
    if (method === 'PATCH' && id) {
      const d = req.body || {};
      const entries = Object.entries(d).filter(([k]) => k !== 'id');
      for (const [k, v] of entries) {
        if (k === 'photos')                    { await sql`UPDATE historique SET photos=${JSON.stringify(v||[])}::jsonb WHERE id=${id}`; }
        else if (k === 'dest')                 { await sql`UPDATE historique SET dest=${JSON.stringify(v||[])}::jsonb WHERE id=${id}`; }
        else if (k === 'statut')               { await sql`UPDATE historique SET statut=${v||null} WHERE id=${id}`; }
        else if (k === 'etna_statut')          { await sql`UPDATE historique SET etna_statut=${v||null} WHERE id=${id}`; }
        else if (k === 'etna_date_retour')     { await sql`UPDATE historique SET etna_date_retour=${v||null} WHERE id=${id}`; }
        else if (k === 'etna_commentaire')     { await sql`UPDATE historique SET etna_commentaire=${v||null} WHERE id=${id}`; }
        else if (k === 'callidus_statut')      { await sql`UPDATE historique SET callidus_statut=${v||null} WHERE id=${id}`; }
        else if (k === 'callidus_date_retour') { await sql`UPDATE historique SET callidus_date_retour=${v||null} WHERE id=${id}`; }
        else if (k === 'callidus_commentaire') { await sql`UPDATE historique SET callidus_commentaire=${v||null} WHERE id=${id}`; }
        else if (k === 'loc')                  { await sql`UPDATE historique SET loc=${v||null} WHERE id=${id}`; }
        else if (k === 'wo')                   { await sql`UPDATE historique SET wo=${v||null} WHERE id=${id}`; }
        else if (k === 'sc')                   { await sql`UPDATE historique SET sc=${v||null} WHERE id=${id}`; }
        else if (k === 'tag')                  { await sql`UPDATE historique SET tag=${v||null} WHERE id=${id}`; }
        else if (k === 'type_eqt')             { await sql`UPDATE historique SET type_eqt=${v||null} WHERE id=${id}`; }
        else if (k === 'serie')                { await sql`UPDATE historique SET serie=${v||null} WHERE id=${id}`; }
        else if (k === 'zone')                 { await sql`UPDATE historique SET zone=${v||null} WHERE id=${id}`; }
        else if (k === 'recovered_at')         { await sql`UPDATE historique SET recovered_at=${v||null} WHERE id=${id}`; }
        else { console.warn('Unknown field:', k); }
      }
      return res.status(200).json({ ok: true });
    }

    // ── HISTORIQUE DELETE (+ Cloudinary cleanup) ─────
    if (method === 'DELETE' && id) {
      // Get photos before deleting
      const rows = await sql`SELECT photos FROM historique WHERE id=${id}`;
      if (rows.length && rows[0].photos && rows[0].photos.length) {
        await deleteCloudinaryPhotos(rows[0].photos);
      }
      await sql`DELETE FROM historique WHERE id=${id}`;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown request' });

  } catch(e) {
    console.error('DB Error:', e);
    return res.status(500).json({ error: e.message });
  }
};
