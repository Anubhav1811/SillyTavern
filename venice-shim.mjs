// venice-shim.mjs
import express from 'express';

const KEY = 'VENICE_INFERENCE_KEY_uESc3MG_Kbz9_eS9GXiapfq4_arrmGeiBtA3gr5LMV';
const DEFAULT_MODEL = 'venice-uncensored-1-2';
const IMAGE_MODEL = 'flux-dev';

function send(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
}

function collect(req) {
    return new Promise(done => {
        let data = '';
        req.on('data', c => { data += c; });
        req.on('end', () => {
            try { done(JSON.parse(data || '{}')); } catch { done({}); }
        });
    });
}

async function chat(req, res) {
    const body = await collect(req);

    let upstream;
    try {
        upstream = await fetch('https://api.venice.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
            body: JSON.stringify({
                model: body.model || DEFAULT_MODEL,
                messages: body.messages || [],
                temperature: body.temperature ?? 0.9,
                top_p: 1,
                max_tokens: body.max_tokens || 400,
                stream: true,
                venice_parameters: { include_venice_system_prompt: false },
            }),
        });
    } catch (err) {
        send(res, 500, { error: String(err) });
        return;
    }

    if (!upstream.ok) {
        const text = await upstream.text();
        console.error('[venice-shim] chat', upstream.status, text);
        send(res, upstream.status, { error: text });
        return;
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });

    for await (const chunk of upstream.body) res.write(chunk);
    res.end();
}

async function image(req, res) {
    const body = await collect(req);
    if (!body.prompt) { send(res, 400, { error: 'prompt required' }); return; }

    let upstream;
    try {
        upstream = await fetch('https://api.venice.ai/api/v1/image/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
            body: JSON.stringify({
                model: body.model || IMAGE_MODEL,
                prompt: body.prompt,
                negative_prompt: body.negative_prompt || 'blurry, low quality, deformed',
                width: Number(body.width) || 832,
                height: Number(body.height) || 1216,
                steps: 30,
                cfg_scale: 7,
                return_binary: false,
            }),
        });
    } catch (err) { send(res, 500, { error: String(err) }); return; }

    const text = await upstream.text();
    if (!upstream.ok) { console.error('[venice-shim] image', upstream.status, text); send(res, upstream.status, { error: text }); return; }

    let data = {};
    try { data = JSON.parse(text); } catch { send(res, 502, { error: 'bad json' }); return; }

    const images = data.images || [];
    if (!images.length) { send(res, 502, { error: 'no images' }); return; }

    send(res, 200, { images });
}

export function mountVeniceShim(app) {
    const router = express.Router();

    router.post('/candy/chat', (req, res) => { chat(req, res); });
    router.post('/candy/image', (req, res) => { image(req, res); });

    router.get('/sdapi/v1/options', (req, res) => send(res, 200, {}));
    router.get('/sdapi/v1/progress', (req, res) => send(res, 200, { progress: 1, state: {} }));
    router.get('/sdapi/v1/sd-models', (req, res) => send(res, 200, [{ title: IMAGE_MODEL, model_name: IMAGE_MODEL }]));
    router.get('/sdapi/v1/samplers', (req, res) => send(res, 200, [{ name: 'Euler a' }]));
    router.get('/sdapi/v1/schedulers', (req, res) => send(res, 200, [{ name: 'Automatic' }]));
    router.get('/sdapi/v1/upscalers', (req, res) => send(res, 200, [{ name: 'None' }]));
    router.get('/sdapi/v1/loras', (req, res) => send(res, 200, []));

    app.use(router);

    const stack = (app._router || app.router).stack;
    const layer = stack.pop();
    stack.unshift(layer);

    console.log('[venice-shim] routes attached');
}
