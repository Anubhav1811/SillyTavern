// venice-shim.mjs
// Mounts A1111-compatible routes at the FRONT of ST's express stack.
// Uses plain Node response methods so it does not depend on express's init layer.
const KEY = 'VENICE_ADMIN_KEY_AqeenznCs6t3TLWMUzd_3BFTTmagiPpWaPgEcMQjhi';
const MODEL = 'venice-sd35';

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

async function txt2img(req, res) {
    const body = await collect(req);
    if (!body.prompt) {
        send(res, 400, { error: 'prompt is required' });
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
        send(res, 500, { error: String(err) });
        return;
    }

    const text = await upstream.text();

    if (!upstream.ok) {
        console.error('[venice-shim] venice', upstream.status, text);
        send(res, upstream.status, { error: text });
        return;
    }

    let data = {};
    try { data = JSON.parse(text); } catch { send(res, 502, { error: 'bad json' }); return; }

    const images = data.images || [];
    if (!images.length) {
        send(res, 502, { error: 'no images returned', raw: data });
        return;
    }

    send(res, 200, { images: images, parameters: {}, info: '{}' });
}

function handler(req, res, next) {
    const path = req.url.split('?')[0];

    if (req.method === 'GET' && path === '/sdapi/v1/options') {
        send(res, 200, {});
        return;
    }

    if (req.method === 'GET' && path === '/sdapi/v1/progress') {
        send(res, 200, { progress: 1, state: {} });
        return;
    }

    if (req.method === 'GET' && path === '/sdapi/v1/sd-models') {
        send(res, 200, [{ title: MODEL, model_name: MODEL, hash: null, sha256: null }]);
        return;
    }

    if (req.method === 'GET' && path === '/sdapi/v1/samplers') {
        send(res, 200, [{ name: 'Euler a' }, { name: 'DPM++ 2M Karras' }]);
        return;
    }

    if (req.method === 'GET' && path === '/sdapi/v1/schedulers') {
        send(res, 200, [{ name: 'Automatic' }, { name: 'Karras' }]);
        return;
    }

    if (req.method === 'POST' && path === '/sdapi/v1/txt2img') {
        txt2img(req, res);
        return;
    }

    next();
}

export function mountVeniceShim(app) {
    const router = app._router || app.router;
    if (!router || !Array.isArray(router.stack)) {
        console.error('[venice-shim] no router stack found');
        return;
    }

    router.stack.unshift({
        name: 'veniceShim',
        handle: handler,
        params: undefined,
        path: undefined,
        keys: [],
        route: undefined,
        method: undefined,
    });

    console.log('[venice-shim] routes attached');
}
