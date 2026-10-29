// venice-proxy.mjs — AUTOMATIC1111-compatible shim for Venice
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 8787);
const KEY = process.env.VENICE_KEY || 'VENICE_ADMIN_KEY_AqeenznCs6t3TLWMUzd_3BFTTmagiPpWaPgEcMQjhi';
const MODEL = process.env.VENICE_IMAGE_MODEL || 'venice-sd35';

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = req.url.split('?')[0];

  // --- A1111 compatibility stubs ---
  if (url === '/sdapi/v1/options') return json(res, 200, {});
  if (url === '/sdapi/v1/progress') return json(res, 200, { progress: 1, state: {} });
  if (url === '/sdapi/v1/sd-models') {
    return json(res, 200, [{ title: MODEL, model_name: MODEL, hash: null, sha256: null }]);
  }

  if (req.method === 'POST' && url === '/sdapi/v1/txt2img') {
    let raw = '';
    for await (const chunk of req) raw += chunk;

    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch { return json(res, 400, { error: 'bad json' }); }

    const prompt = body.prompt;
    if (!prompt) return json(res, 400, { error: 'prompt is required' });

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
        console.error('Venice error', upstream.status, text);
        return json(res, upstream.status, { error: text });
      }

      let data;
      try { data = JSON.parse(text); } catch { return json(res, 502, { error: 'bad json from venice' }); }

      const images = data.images || [];
      if (!images.length) return json(res, 502, { error: 'no images returned', raw: data });

      return json(res, 200, { images, parameters: {}, info: '{}' });
    } catch (err) {
      console.error(err);
      return json(res, 500, { error: String(err) });
    }
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`venice shim on ${PORT}`));
