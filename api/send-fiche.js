// api/send-fiche.js — Génère et envoie la fiche suiveuse Word via Resend
const JSZip = require('jszip');

// Post-traitement : fixe les hauteurs de lignes pour tenir sur 2 pages
async function fixRowHeights(docxBase64) {
  const zip = await JSZip.loadAsync(Buffer.from(docxBase64, 'base64'));
  const docXml = await zip.file('word/document.xml').async('string');
  
  let fixed = docXml;
  
  // Rendre les lignes DEFAILLANCES, COMMENTAIRES_PAP, INSTRUCTIONS en hauteur exacte
  // Ces lignes ont h=786 dans RECEPTION - on les fixe à 820 exact
  // On identifie les lignes par leur contenu SDT
  
  // Remplace toutes les trHeight atLeast par exact pour les grandes valeurs
  // Rows with h >= 786 in RECEPTION/SECURITE tables → set exact
  fixed = fixed.replace(
    /<w:trHeight w:val="(786|970|2044)"\/>/g,
    (match, h) => `<w:trHeight w:val="${h}" w:hRule="exact"/>`
  );
  
  // Also fix IDENTIFICATION table tall rows (408, 423, 415, 323)
  // Reduce them and make exact
  fixed = fixed.replace(
    /<w:trHeight w:val="408"\/>/g,
    '<w:trHeight w:val="360" w:hRule="exact"/>'
  );
  fixed = fixed.replace(
    /<w:trHeight w:val="423"\/>/g,
    '<w:trHeight w:val="360" w:hRule="exact"/>'
  );
  fixed = fixed.replace(
    /<w:trHeight w:val="415"\/>/g,
    '<w:trHeight w:val="360" w:hRule="exact"/>'
  );
  fixed = fixed.replace(
    /<w:trHeight w:val="323"\/>/g,
    '<w:trHeight w:val="280" w:hRule="exact"/>'
  );
  
  zip.file('word/document.xml', fixed);
  const result = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
  return result;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { subject, text, filename, content } = req.body || {};

    if (!content || !filename) {
      return res.status(400).json({ error: 'Missing content or filename' });
    }

    // Fix row heights to ensure 2-page layout
    let fixedContent = content;
    try {
      fixedContent = await fixRowHeights(content);
    } catch(e) {
      console.warn('Height fix failed, using original:', e.message);
    }

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
        attachments: [{
          filename: filename,
          content: fixedContent
        }]
      })
    });

    const data = await resendResp.json();
    if (!resendResp.ok) {
      return res.status(500).json({ error: data.message || 'Resend error' });
    }

    return res.status(200).json({ ok: true, id: data.id });

  } catch(e) {
    console.error('send-fiche error:', e);
    return res.status(500).json({ error: e.message });
  }
};
