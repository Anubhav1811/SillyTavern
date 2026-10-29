// venice-proxy.mjs
// Translates OpenAI-style image requests into Venice's API shape.
import express from 'express';

const PORT = process.env.PORT || 8787;
const KEY = process.env.VENICE_KEY;
const MODEL = process.env.VENICE_IMAGE_MODEL || 'venice-sd35';

if (!KEY) {
  console.error('Missing VENICE_KEY env var');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/v1/models', (req, res) => {
  res.json({ object: 'list', data: [{ id: MODEL, object: 'model' }] });
});

app.post('/v1/images/generations', async (req, res) => {
  try {
    const body = req.body || {};
    const prompt = body.prompt;
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    const [w, h] = String(body.size || '1024x1024').split('x').map(Number);

    const upstream = await fetch('https://api.venice.ai/api/v1/image/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({
        model: body.model || MODEL,
        prompt,
        negative_prompt: body.negative_prompt || undefined,
        width: Number.isFinite(w) ? w : 1024,
        height: Number.isFinite(h) ? h : 1024,
        steps: body.steps || 25,
        cfg_scale: body.cfg_scale || 7,
        return_binary: false,
      }),
    });

    const text = await upstream.text();

    if (!upstream.ok) {
      console.error('Venice error', upstream.status, text);
      return res.status(upstream.status).json({ error: text });
    }

    let data;
    try { data = JSON.parse(text); } catch { return res.status(502).json({ error: 'Bad JSON from Venice', raw: text }); }

    const images = data.images || [];
    if (!images.length) return res.status(502).json({ error: 'No images returned', raw: data });

    res.json({
      created: Math.floor(Date.now() / 1000),
      data: images.map(b64 => ({ b64_json: b64 })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, () => console.log(`venice-proxy on ${PORT}`));
