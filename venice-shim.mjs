// venice-shim.mjs — mounts an A1111-compatible route on ST's own server
const KEY = process.env.VENICE_KEY || 'VENICE_ADMIN_KEY_AqeenznCs6t3TLWMUzd_3BFTTmagiPpWaPgEcMQjhi';
const MODEL = process.env.VENICE_IMAGE_MODEL || 'venice-sd35';

function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => (data += c));
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
    });
  });
}

export function mountVeniceShim(app) {
  console.log('[venice-shim] mounted');

  app.get('/sdapi/v1/options', (req, res) => res.json({}));
  app.get('/sdapi/v1/progress', (req, res) => res.json({ progress: 1, state: {} }));
  app.get('/sdapi/v1/sd-models', (req, res) =>
    res.json([{ title: MODEL, model_name: MODEL, hash: null, sha256: null }])
  );

  app.post('/sdapi/v1/txt2img', async (req, res) => {
    const body =
      req.body && Object.keys(req.body).length ? req.body : await readBody(req);

    const prompt = body.prompt;
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    try {
      const upstream = await fetch('https://api.venice.ai/api/v1/image/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({
          model: MODEL,
          prompt,
          negative_prompt: body.negative_prompt || undefined,
          width: Number(body.width) || 1024,
          height: Number(body.height) || 1024,
          steps: Number(body.steps) || 25,
          cfg_scale: Number(body.cfg_scale) || 7,
          return_binary: false,
        }),
      });

      const text = await upstream.text();
      if (!upstream.ok) {
        console.error('[venice-shim] venice', upstream.status, text);
        return res.status(upstream.status).json({ error: text });
      }

      let data;
      try { data = JSON.parse(text); } catch { return res.status(502).json({ error: 'bad json' }); }

      const images = data.images || [];
      if (!images.length) return res.status(502).json({ error: 'no images returned', raw: data });

      return res.json({ images, parameters: {}, info: '{}' });
    } catch (err) {
      console.error('[venice-shim]', err);
      res.status(500).json({ error: String(err) });
    }
  });
}
