// api/send-fiche.js — Envoie la fiche suiveuse Word par mail via Resend
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { to, subject, text, filename, content } = req.body || {};

    if (!content || !filename) {
      return res.status(400).json({ error: 'Missing content or filename' });
    }

    const recipients = Array.isArray(to) ? to : [to || 'Emmanuel.Rosa@pronyresources.com'];

    const resendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer re_ZKqs2NHt_9u1tMAEnW1SuWXfx3gRMcnFi'
      },
      body: JSON.stringify({
        from: 'PRNC Field <onboarding@resend.dev>',
        to: recipients,
        subject: subject || '[FICHE SUIVEUSE] PRNC',
        text: text || 'Fiche suiveuse en pièce jointe.',
        attachments: [{
          filename: filename,
          content: content  // base64
        }]
      })
    });

    const data = await resendResp.json();

    if (!resendResp.ok) {
      console.error('Resend error:', data);
      return res.status(500).json({ error: data.message || 'Resend error' });
    }

    return res.status(200).json({ ok: true, id: data.id });

  } catch(e) {
    console.error('send-fiche error:', e);
    return res.status(500).json({ error: e.message });
  }
};
