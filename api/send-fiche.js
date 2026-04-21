export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { to, cc, subject, text, filename, content } = req.body;

    const payload = {
      from: 'PRNC Field <onboarding@resend.dev>',
      to: to || ['Emmanuel.Rosa@pronyresources.com'],
      subject: subject || 'Fiche Suiveuse PRNC',
      text: text || '',
    };

    if (cc && cc.length) payload.cc = cc;
    if (filename && content) {
      payload.attachments = [{ filename, content }];
    }

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer re_ZKqs2NHt_9u1tMAEnW1SuWXfx3gRMcnFi'
      },
      body: JSON.stringify(payload)
    });

    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json(data);
    return res.status(200).json(data);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
