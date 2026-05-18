const { neon } = require('@neondatabase/serverless');
const https  = require('https');
const crypto = require('crypto');

const sql = neon('postgresql://neondb_owner:npg_tOasz0jxXp2M@ep-blue-tree-a79w2h77.ap-southeast-2.aws.neon.tech/neondb?sslmode=require');

const CLOUD_NAME = 'dns5b6fix';
const API_KEY    = '847395583118243';
const API_SECRET = 'nBuyEerlJYeOfbD7RcHPzD2vkHU';

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

    if (req.query?.action === 'delete_photo') {
      const { photo_url } = req.body || {};
      if (photo_url) await deleteCloudinaryPhotos([photo_url]);
      return res.status(200).json({ ok: true });
    }

    // ── PLANNING ATELIER P17 ─────────────────────────
    if (table === 'planning') {
      await sql`CREATE TABLE IF NOT EXISTS planning (
        id SERIAL PRIMARY KEY,
        wo TEXT,
        wr TEXT,
        tag TEXT,
        desc TEXT,
        ressource TEXT,
        commentaire TEXT,
        taches JSONB DEFAULT '[]',
        jours JSONB DEFAULT '[]',
        statut TEXT DEFAULT 'PLANIFIE',
        semaine TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS planning_wo_semaine_idx ON planning(wo, semaine)`;

      if (method === 'GET') {
        let semaine = req.query?.semaine || null;
        // Si pas de semaine, charger la semaine active
        if (!semaine) {
          try {
            await sql`CREATE TABLE IF NOT EXISTS planning_config (key TEXT PRIMARY KEY, value TEXT)`;
            const cfg = await sql`SELECT value FROM planning_config WHERE key='semaine_active'`;
            if (cfg.length) semaine = cfg[0].value;
          } catch(e) {}
        }
        // Retourner aussi la liste des semaines disponibles
        const semaines = await sql`SELECT DISTINCT semaine FROM planning ORDER BY semaine DESC`;
        const rows = semaine
          ? await sql`SELECT * FROM planning WHERE semaine=${semaine} ORDER BY wo ASC`
          : await sql`SELECT * FROM planning ORDER BY updated_at DESC LIMIT 200`;
        return res.status(200).json({ rows, semaine_active: semaine, semaines: semaines.map(s => s.semaine) });
      }

      // POST bulk — sauvegarde le planning d'une semaine + marque comme active
      if (method === 'POST') {
        const d = req.body || {};
        if (d.bulk && Array.isArray(d.items) && d.semaine) {
          // Supprimer l'ancien planning de CETTE semaine seulement
          await sql`DELETE FROM planning WHERE semaine=${d.semaine}`;
          // Insérer tous les items
          for (const item of d.items) {
            await sql`INSERT INTO planning (wo,wr,tag,desc,ressource,commentaire,taches,jours,statut,semaine)
              VALUES (${item.wo||null},${item.wr||null},${item.tag||null},${item.desc||null},
                      ${item.ressource||null},${item.commentaire||null},
                      ${JSON.stringify(item.taches||[])}::jsonb,
                      ${JSON.stringify(item.jours||[])}::jsonb,
                      ${item.statut||'PLANIFIE'},${d.semaine})`;
          }
          // Sauvegarder la semaine active
          await sql`CREATE TABLE IF NOT EXISTS planning_config (key TEXT PRIMARY KEY, value TEXT)`;
          await sql`INSERT INTO planning_config (key,value) VALUES ('semaine_active',${d.semaine})
            ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`;
          // Nettoyage : garder seulement les 4 dernières semaines
          const semaines = await sql`SELECT DISTINCT semaine FROM planning ORDER BY semaine DESC`;
          if (semaines.length > 4) {
            const aSupprimer = semaines.slice(4).map(r => r.semaine);
            for (const s of aSupprimer) {
              await sql`DELETE FROM planning WHERE semaine=${s}`;
            }
          }
          return res.status(201).json({ ok: true, count: d.items.length, semaine: d.semaine });
        }
        return res.status(400).json({ error: 'Missing bulk/items/semaine' });
      }

      // PATCH — mettre à jour le statut d'un WO
      if (method === 'PATCH') {
        const d = req.body || {};
        if (d.wo && d.semaine) {
          await sql`UPDATE planning SET statut=${d.statut||'PLANIFIE'}, updated_at=NOW()
            WHERE wo=${d.wo} AND semaine=${d.semaine}`;
          return res.status(200).json({ ok: true });
        }
        if (id) {
          await sql`UPDATE planning SET statut=${d.statut||'PLANIFIE'}, updated_at=NOW() WHERE id=${id}`;
          return res.status(200).json({ ok: true });
        }
        return res.status(400).json({ error: 'Missing wo+semaine or id' });
      }

      if (method === 'DELETE') {
        if (req.query?.semaine) {
          await sql`DELETE FROM planning WHERE semaine=${req.query.semaine}`;
        } else if (id) {
          await sql`DELETE FROM planning WHERE id=${id}`;
        }
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'Unknown planning request' });
    }

    // ── LOC_MOUVEMENTS ───────────────────────────────
    if (table === 'loc_mouvements') {
      await sql`CREATE TABLE IF NOT EXISTS loc_mouvements (
        id SERIAL PRIMARY KEY,
        tag TEXT, wg TEXT, ancien_loc TEXT, nouveau_loc TEXT,
        record_id TEXT, fait BOOLEAN DEFAULT false,
        date_mouv TIMESTAMPTZ DEFAULT NOW()
      )`;
      if (method === 'GET') {
        const rows = await sql`SELECT * FROM loc_mouvements ORDER BY date_mouv DESC`;
        return res.status(200).json(rows);
      }
      if (method === 'POST') {
        const d = req.body || {};
        await sql`INSERT INTO loc_mouvements (tag,wg,ancien_loc,nouveau_loc,record_id,fait,date_mouv)
          VALUES (${d.tag||null},${d.wg||null},${d.ancien_loc||null},${d.nouveau_loc||null},
                  ${d.record_id||null},${d.fait||false},${d.date_mouv||null})`;
        return res.status(201).json({ ok: true });
      }
      if (method === 'PATCH' && id) {
        const d = req.body || {};
        await sql`UPDATE loc_mouvements SET fait=${d.fait} WHERE id=${id}`;
        return res.status(200).json({ ok: true });
      }
      if (method === 'DELETE' && id) {
        await sql`DELETE FROM loc_mouvements WHERE id=${id}`;
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: 'Unknown loc_mouvements request' });
    }

    // ── TRANSPORT ────────────────────────────────────
    if (table === 'transport') {
      await sql`CREATE TABLE IF NOT EXISTS transport (
        id TEXT PRIMARY KEY, date TEXT, type TEXT, statut TEXT, ref TEXT,
        dest TEXT, notes TEXT, wo TEXT, tag TEXT, sc TEXT, serie TEXT,
        photos JSONB DEFAULT '[]', created_at TIMESTAMP DEFAULT NOW()
      )`;
      await sql`ALTER TABLE transport ADD COLUMN IF NOT EXISTS wo TEXT`;
      await sql`ALTER TABLE transport ADD COLUMN IF NOT EXISTS tag TEXT`;
      await sql`ALTER TABLE transport ADD COLUMN IF NOT EXISTS sc TEXT`;
      await sql`ALTER TABLE transport ADD COLUMN IF NOT EXISTS serie TEXT`;
      await sql`ALTER TABLE transport ADD COLUMN IF NOT EXISTS photos JSONB DEFAULT '[]'`;
      if (method === 'GET') {
        const rows = await sql`SELECT * FROM transport ORDER BY date ASC, created_at DESC`;
        return res.status(200).json(rows);
      }
      if (method === 'POST') {
        const d = req.body || {};
        await sql`INSERT INTO transport (id,date,type,statut,ref,dest,notes,wo,tag,sc,serie,photos)
          VALUES (${d.id||null},${d.date||null},${d.type||null},${d.statut||null},
                  ${d.ref||null},${d.dest||null},${d.notes||null},
                  ${d.wo||null},${d.tag||null},${d.sc||null},${d.serie||null},
                  ${JSON.stringify(d.photos||[])}::jsonb)`;
        return res.status(201).json({ ok: true });
      }
      if (method === 'PATCH' && id) {
        const d = req.body || {};
        await sql`UPDATE transport SET
          statut=${d.statut||null},date=${d.date||null},type=${d.type||null},
          ref=${d.ref||null},dest=${d.dest||null},notes=${d.notes||null},
          wo=${d.wo||null},tag=${d.tag||null},sc=${d.sc||null},
          serie=${d.serie||null},photos=${JSON.stringify(d.photos||[])}::jsonb WHERE id=${id}`;
        return res.status(200).json({ ok: true });
      }
      if (method === 'DELETE' && id) {
        const trRows = await sql`SELECT photos,wo FROM transport WHERE id=${id}`;
        if (trRows.length) {
          const photos = trRows[0].photos || [];
          if (photos.length > 0) await deleteCloudinaryPhotos(photos);
          if (trRows[0].wo) {
            const histRows = await sql`SELECT photos FROM historique WHERE wo=${trRows[0].wo}`;
            const histPhotos = histRows.flatMap(r => r.photos || []).filter(Boolean);
            if (histPhotos.length > 0) await deleteCloudinaryPhotos(histPhotos);
            await sql`DELETE FROM historique WHERE wo=${trRows[0].wo}`;
          }
        }
        await sql`DELETE FROM transport WHERE id=${id}`;
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: 'Unknown transport request' });
    }

    // ── CALLIDUS PRNC ────────────────────────────────
    if (table === 'callidus_prnc') {
      await sql`CREATE TABLE IF NOT EXISTS callidus_prnc (
        id TEXT PRIMARY KEY, wo TEXT, tag TEXT, serie TEXT, qty TEXT,
        remarques TEXT, photos JSONB DEFAULT '[]',
        statut TEXT DEFAULT 'Envoyé', date TEXT, created_at TIMESTAMP DEFAULT NOW()
      )`;
      if (method === 'GET') {
        const rows = await sql`SELECT * FROM callidus_prnc ORDER BY created_at DESC`;
        return res.status(200).json(rows);
      }
      if (method === 'POST') {
        const d = req.body || {};
        await sql`INSERT INTO callidus_prnc (id,wo,tag,serie,qty,remarques,photos,statut,date)
          VALUES (${d.id||null},${d.wo||null},${d.tag||null},${d.serie||null},${d.qty||null},
                  ${d.remarques||null},${JSON.stringify(d.photos||[])}::jsonb,
                  ${d.statut||'Envoyé'},${d.date||null})`;
        return res.status(201).json({ ok: true });
      }
      if (method === 'PATCH' && id) {
        const d = req.body || {};
        await sql`UPDATE callidus_prnc SET
          wo=${d.wo||null},tag=${d.tag||null},serie=${d.serie||null},
          qty=${d.qty||null},remarques=${d.remarques||null},
          photos=${JSON.stringify(d.photos||[])}::jsonb,statut=${d.statut||null} WHERE id=${id}`;
        return res.status(200).json({ ok: true });
      }
      if (method === 'DELETE' && id) {
        const rows = await sql`SELECT photos,wo FROM callidus_prnc WHERE id=${id}`;
        if (rows.length) {
          const photos = rows[0].photos || [];
          if (photos.length > 0) await deleteCloudinaryPhotos(photos);
          if (rows[0].wo) {
            const histRows = await sql`SELECT photos FROM historique WHERE wo=${rows[0].wo}`;
            const histPhotos = histRows.flatMap(r => r.photos || []).filter(Boolean);
            if (histPhotos.length > 0) await deleteCloudinaryPhotos(histPhotos);
            await sql`DELETE FROM historique WHERE wo=${rows[0].wo}`;
          }
        }
        await sql`DELETE FROM callidus_prnc WHERE id=${id}`;
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: 'Unknown callidus_prnc request' });
    }

    // ── PI SUIVI ─────────────────────────────────────
    if (table === 'pi_suivi') {
      if (method === 'GET') {
        const rows = await sql`SELECT * FROM pi_suivi ORDER BY created_at DESC`;
        return res.status(200).json(rows);
      }
      if (method === 'POST') {
        const d = req.body || {};
        await sql`INSERT INTO pi_suivi (id,wo,wg,tag,loc,date,statut,pieces)
          VALUES (${d.id},${d.wo},${d.wg},${d.tag||null},${d.loc||null},
                  ${d.date||null},${d.statut||'En cours'},${JSON.stringify(d.pieces||[])}::jsonb)`;
        return res.status(201).json({ ok: true });
      }
      if (method === 'PATCH' && id) {
        const d = req.body || {};
        await sql`UPDATE pi_suivi SET statut=${d.statut||'En cours'},
          pieces=${JSON.stringify(d.pieces||[])}::jsonb,
          loc=${d.loc||null},tag=${d.tag||null} WHERE id=${id}`;
        return res.status(200).json({ ok: true });
      }
      if (method === 'DELETE' && id) {
        const piRows = await sql`SELECT wo FROM pi_suivi WHERE id=${id}`;
        if (piRows.length && piRows[0].wo) {
          const wo = piRows[0].wo;
          const histRows = await sql`SELECT photos FROM historique WHERE wo=${wo}`;
          const allPhotos = histRows.flatMap(r => r.photos || []).filter(Boolean);
          if (allPhotos.length > 0) await deleteCloudinaryPhotos(allPhotos);
          await sql`DELETE FROM historique WHERE wo=${wo}`;
        }
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
        else if (k === 'type')                 { await sql`UPDATE historique SET type=${v||null} WHERE id=${id}`; }
        else if (k === 'wo_usine')             { await sql`UPDATE historique SET wo_usine=${v||null} WHERE id=${id}`; }
        else if (k === 'description')          { await sql`UPDATE historique SET description=${v||null} WHERE id=${id}`; }
        else if (k === 'recovered_at')         { await sql`UPDATE historique SET recovered_at=${v||null} WHERE id=${id}`; }
        else { console.warn('Unknown field:', k); }
      }
      return res.status(200).json({ ok: true });
    }

    // ── HISTORIQUE DELETE ────────────────────────────
    if (method === 'DELETE' && id) {
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
