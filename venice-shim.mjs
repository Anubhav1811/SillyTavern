// venice-shim.mjs
import express from 'express';

const KEY = 'VENICE_INFERENCE_KEY_uESc3MG_Kbz9_eS9GXiapfq4_arrmGeiBtA3gr5LMV';
const DEFAULT_MODEL = 'venice-uncensored-1-2';
const IMAGE_MODEL = 'flux-dev';
const TTS_MODEL = 'tts-kokoro';
const TTS_VOICE = 'af_bella';
const STT_MODEL = 'whisper-large-v3';

function send(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
}

function collect(req) {
    return new Promise(done => {
        let data = '';
        req.on('data', c => { data += c; });
        req.on('end', () => { try { done(JSON.parse(data || '{}')); } catch { done({}); } });
    });
}

function collectRaw(req) {
    return new Promise(done => {
        const parts = [];
        req.on('data', c => parts.push(c));
        req.on('end', () => done(Buffer.concat(parts)));
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
    } catch (err) { send(res, 500, { error: String(err) }); return; }

    if (!upstream.ok) { const t = await upstream.text(); console.error('[shim] chat', upstream.status, t); send(res, upstream.status, { error: t }); return; }

    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
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
                negative_prompt: 'blurry, low quality, deformed, watermark',
                width: 832, height: 1216, steps: 30, cfg_scale: 7,
                return_binary: false,
            }),
        });
    } catch (err) { send(res, 500, { error: String(err) }); return; }

    const text = await upstream.text();
    if (!upstream.ok) { console.error('[shim] image', upstream.status, text); send(res, upstream.status, { error: text }); return; }

    let data = {};
    try { data = JSON.parse(text); } catch { send(res, 502, { error: 'bad json' }); return; }
    if (!data.images || !data.images.length) { send(res, 502, { error: 'no images' }); return; }
    send(res, 200, { images: data.images });
}

async function speech(req, res) {
    const body = await collect(req);
    if (!body.text) { send(res, 400, { error: 'text required' }); return; }

    let upstream;
    try {
        upstream = await fetch('https://api.venice.ai/api/v1/audio/speech', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
            body: JSON.stringify({
                model: body.model || TTS_MODEL,
                input: body.text.slice(0, 2000),
                voice: body.voice || TTS_VOICE,
                response_format: 'mp3',
                speed: 1,
            }),
        });
    } catch (err) { send(res, 500, { error: String(err) }); return; }

    if (!upstream.ok) { const t = await upstream.text(); console.error('[shim] speech', upstream.status, t); send(res, upstream.status, { error: t }); return; }

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
    res.end(buf);
}

async function transcribe(req, res) {
    const raw = await collectRaw(req);
    const type = req.headers['content-type'] || '';

    let upstream;
    try {
        upstream = await fetch('https://api.venice.ai/api/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Content-Type': type, Authorization: 'Bearer ' + KEY },
            body: raw,
        });
    } catch (err) { send(res, 500, { error: String(err) }); return; }

    const text = await upstream.text();
    if (!upstream.ok) { console.error('[shim] stt', upstream.status, text); send(res, upstream.status, { error: text }); return; }
    send(res, 200, { raw: text });
}

export function mountVeniceShim(app) {
    const router = express.Router();

    router.post('/candy/chat', (req, res) => { chat(req, res); });
    router.post('/candy/image', (req, res) => { image(req, res); });
    router.post('/candy/speech', (req, res) => { speech(req, res); });
    router.post('/candy/transcribe', (req, res) => { transcribe(req, res); });

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
