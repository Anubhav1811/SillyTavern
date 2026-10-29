import express from 'express';

const KEY = 'VENICE_ADMIN_KEY_AqeenznCs6t3TLWMUzd_3BFTTmagiPpWaPgEcMQjhi';
const MODEL = 'venice-sd35';

const router = express.Router();

router.get('/sdapi/v1/options', (req, res) => res.json({}));
router.get('/sdapi/v1/progress', (req, res) => res.json({ progress: 1, state: {} }));
router.get('/sdapi/v1/sd-models', (req, res) => res.json([{ title: MODEL, model_name: MODEL, hash: null, sha256: null }]));

function collect(req) {
    return new Promise(done => {
        let data = '';
        req.on('data', c => { data += c; });
        req.on('end', () => {
            try { done(JSON.parse(data || '{}')); } catch { done({}); }
        });
    });
}

async function txt2img(req, res) {
    const body = req.body && Object.keys(req.body).length ? req.body : await collect(req);
    if (!body.prompt) {
        res.status(400).json({ error: 'prompt is required' });
        return;
    }

    let upstream;
    try {
        upstream = await fetch('https://api.venice.ai/api/v1/image/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
            body: JSON.stringify({
                model: MODEL,
                prompt: body.prompt,
                negative_prompt: body.negative_prompt || undefined,
                width: Number(body.width) || 1024,
                height: Number(body.height) || 1024,
                steps: Number(body.steps) || 25,
                cfg_scale: Number(body.cfg_scale) || 7,
                return_binary: false,
            }),
        });
    } catch (err) {
        res.status(500).json({ error: String(err) });
        return;
    }

    const text = await upstream.text();

    if (!upstream.ok) {
        console.error('[venice-shim] venice', upstream.status, text);
        res.status(upstream.status).json({ error: text });
        return;
    }

    let data = {};
    try { data = JSON.parse(text); } catch { res.status(502).json({ error: 'bad json' }); return; }

    const images = data.images || [];
    if (!images.length) {
        res.status(502).json({ error: 'no images returned', raw: data });
        return;
    }

    res.json({ images: images, parameters: {}, info: '{}' });
}

router.post('/sdapi/v1/txt2img', txt2img);

export function mountVeniceShim(app) {
    app.use(router);
    console.log('[venice-shim] routes attached');
}
