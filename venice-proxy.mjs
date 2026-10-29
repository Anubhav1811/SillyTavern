// venice-proxy.mjs — zero dependencies, Node built-ins only
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 8787);
const KEY = process.env.VENICE_KEY;
const MODEL = process.env.VENICE_IMAGE_MODEL || 'venice-sd35';

if (!KEY) {
  console.error('Missing VENICE_KEY env var');
  process.exit(1);
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
    return json(res, 200, { object: 'list', data: [{ id: MODEL, object: 'model' }] });
  }

  if (req.method === 'POST' && req.url.startsWith('/v1/images/generations')) {
    let raw = '';
    for await (const chunk of req) raw += chunk;

    let body = {};
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      return json(res, 400, { error: 'bad json' });
    }

    const prompt = body.prompt;
    if (!prompt) return json(res, 400, { error: 'prompt is required' });

    const [w, h] = String(body.size || '1024x1024').split('x').map(Number);

    try {
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
        return json(res, upstream.status, { error: text });
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return json(res, 502, { error: 'bad json from venice', raw: text });
      }

      const images = data.images || [];
      if (!images.length) return json(res, 502, { error: 'no images returned', raw: data });

      return json(res, 200, {
        created: Math.floor(Date.now() / 1000),
        data: images.map(b64 => ({ b64_json: b64 })),
      });
    } catch (err) {
      console.error(err);
      return json(res, 500, { error: String(err) });
    }
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`venice-proxy on ${PORT}`));
