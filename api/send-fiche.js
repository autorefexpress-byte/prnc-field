// api/send-fiche.js — Génère et envoie la fiche suiveuse Word via Resend
const JSZip = require('jszip');

async function fixDocx(docxBase64) {
  const zip = await JSZip.loadAsync(Buffer.from(docxBase64, 'base64'));
  let xml = await zip.file('word/document.xml').async('string');

  // 1. Supprimer le saut de page explicite (crée une page vide)
  xml = xml.replace(/<w:r><w:br w:type="page"\/><\/w:r>/g, '');

  // 2. Calibri 8pt majuscules sur les champs SDT uniquement
  xml = xml.replace(/<w:sdt>([\s\S]*?)<\/w:sdt>/g, (match) => {
    const idx = match.indexOf('<w:sdtContent>');
    if (idx < 0) return match;
    const prefix = match.slice(0, idx);
    let body = match.slice(idx);
    body = body.replace(/<w:rFonts[^/]*\/>/g, '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>');
    body = body.replace(/<w:sz w:val="\d+"/g, '<w:sz w:val="16"');
    body = body.replace(/<w:szCs w:val="\d+"/g, '<w:szCs w:val="16"');
    body = body.replace(/(<w:rPr>)(?![\s\S]*?<w:caps\/>)/g, '$1<w:caps/>');
    return prefix + body;
  });

  zip.file('word/document.xml', xml);
  return await zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { subject, text, filename, content } = req.body || {};
    if (!content || !filename) return res.status(400).json({ error: 'Missing content or filename' });

    let fixedContent = content;
    try { fixedContent = await fixDocx(content); }
    catch(e) { console.warn('Fix failed:', e.message); }

    const resendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer re_6gRPR5mN_L1YwTx7Xw7GqZdgkhsyQSBx5'
      },
      body: JSON.stringify({
        from: 'PRNC Field <onboarding@resend.dev>',
        to: ['fichesuiveuse@gmail.com'],
        subject: subject || '[FICHE SUIVEUSE] PRNC',
        text: text || 'Fiche suiveuse en pièce jointe.',
        attachments: [{ filename, content: fixedContent }]
      })
    });

    const data = await resendResp.json();
    if (!resendResp.ok) return res.status(500).json({ error: data.message || 'Resend error' });
    return res.status(200).json({ ok: true, id: data.id });

  } catch(e) {
    console.error('send-fiche error:', e);
    return res.status(500).json({ error: e.message });
  }
};
