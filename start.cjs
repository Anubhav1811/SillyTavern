// start.cjs — Hostinger entry point for SillyTavern.
//
// Why this file exists:
//  1. No top-level await — it crashes ESM entry files on Hostinger's Passenger setup.
//  2. Hostinger assigns no PORT, so we listen on the plausible ones and forward
//     to SillyTavern on an internal port.
//  3. Passenger serves the app's public/ directory as static files, ahead of Node.
//     That is fine for everything except lib.js, which must be the compiled
//     bundle rather than the source. We copy the webpack output over it.
//  4. LiteSpeed caches Node responses; we keep cache lookup off.

const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');

const assigned = process.env.PORT;
const isSocket = !!assigned && !/^\d+$/.test(assigned);
const ST_PORT = 8765;

const targets = new Set();
if (assigned) targets.add(assigned);
for (const p of ['3000', '8000', '8080', '5000']) targets.add(p);

console.log(
    '[boot] PORT =', JSON.stringify(assigned),
    '| socket =', isSocket,
    '| targets =', [...targets].join(','),
    '| stPort =', ST_PORT,
);

process.env.SILLYTAVERN_PORT = String(ST_PORT);
process.env.SILLYTAVERN_LISTEN = 'true';

/**
 * Front listener: accepts the public connection and pipes it to SillyTavern,
 * retrying upstream while ST compiles its frontend.
 * @param {string} target Port or socket path to listen on.
 */
function startFront(target) {
    const server = net.createServer((client) => {
        console.log('[boot] HIT on front', target);

        let pending = [];
        let live = false;
        let tries = 0;

        const attempt = () => {
            const up = net.connect(ST_PORT, '127.0.0.1');

            up.on('connect', () => {
                live = true;
                pending.forEach((chunk) => up.write(chunk));
                pending = [];
                client.pipe(up);
                up.pipe(client);
            });

            up.on('error', () => {
                up.destroy();
                if (!live && tries++ < 400) {
                    setTimeout(attempt, 250);
                } else if (!live) {
                    client.destroy();
                }
            });
        };

        client.on('data', (chunk) => { if (!live) pending.push(chunk); });
        client.on('error', () => {});
        attempt();
    });

    server.on('error', (e) => console.error('[boot] front', target, 'failed:', e.code || e.message));
    server.listen(target, () => console.log('[boot] FRONT LISTENING on', target));
}

/**
 * Copies the compiled webpack bundle over every public/lib.js that gets served
 * statically. Watches for a while so the fresh compile is picked up too.
 * @param {string} serverDirectory SillyTavern install directory.
 * @param {string} dataRoot SillyTavern data root.
 */
function syncBundle(serverDirectory, dataRoot) {
    const wpRoot = path.join(dataRoot, '_webpack');
    const dests = [
        path.join(serverDirectory, 'public', 'lib.js'),
        path.join(path.resolve(dataRoot, '..'), 'public_html', 'lib.js'),
    ];

    let ticks = 0;
    console.log('[boot] watching for bundle');

    const timer = setInterval(() => {
        if (ticks++ > 375) {
            console.log('[boot] stopped watching for bundle');
            return clearInterval(timer);
        }

        let dirs = [];
        try {
            dirs = fs.readdirSync(wpRoot, { withFileTypes: true })
                .filter((d) => d.isDirectory()).map((d) => d.name);
        } catch { return; }

        for (const d of dirs) {
            const src = path.join(wpRoot, d, 'output', 'lib.js');
            let stat;
            try {
                stat = fs.statSync(src);
            } catch { continue; }
            if (stat.size < 50000) continue;

            for (const dest of dests) {
                try {
                    let cur = 0;
                    try { cur = fs.statSync(dest).size; } catch { /* missing */ }
                    if (cur === stat.size) continue;
                    fs.copyFileSync(src, dest);
                    console.log('[boot] BUNDLE COPIED', stat.size, 'bytes ->', dest);
                } catch (e) {
                    console.error('[boot] copy to', dest, 'failed:', e.message);
                }
            }
        }
    }, 400);
}

const HT_BEGIN = '# --- ST-BOOT-BEGIN ---';
const HT_END = '# --- ST-BOOT-END ---';

/**
 * Managed block in public_html/.htaccess: disables LiteSpeed cache lookup and
 * forces revalidation so nothing goes stale.
 * @param {string} dataRoot SillyTavern data root.
 */
function patchHtaccess(dataRoot) {
    const htaccess = path.join(path.resolve(dataRoot, '..'), 'public_html', '.htaccess');

    let content = '';
    try {
        if (fs.existsSync(htaccess)) content = fs.readFileSync(htaccess, 'utf8');
    } catch (e) {
        console.error('[boot] htaccess read failed:', e.message);
    }

    const begin = content.indexOf(HT_BEGIN);
    const end = content.indexOf(HT_END);
    if (begin !== -1 && end !== -1) {
        content = content.slice(0, begin) + content.slice(end + HT_END.length);
    }

    const block = [
        HT_BEGIN,
        '<IfModule LiteSpeed>',
        'CacheLookup off',
        '</IfModule>',
        HT_END,
        '',
    ].join('\n');

    try {
        fs.writeFileSync(htaccess, block + content.trimStart());
        console.log('[boot] htaccess patched');
    } catch (e) {
        console.error('[boot] htaccess patch failed:', e.message);
    }
}

(async () => {
    const { CommandLineParser } = await import('./src/command-line.js');
    const { serverDirectory } = await import('./src/server-directory.js');

    const cliArgs = new CommandLineParser().parse(process.argv);
    globalThis.DATA_ROOT = cliArgs.dataRoot;
    globalThis.COMMAND_LINE_ARGS = cliArgs;
    process.chdir(serverDirectory);

    console.log('[boot] dataRoot =', cliArgs.dataRoot);

    [...targets].forEach(startFront);
    patchHtaccess(cliArgs.dataRoot);
    syncBundle(serverDirectory, cliArgs.dataRoot);

    await import('./src/server-main.js');
    console.log('[boot] server-main loaded');
})().catch((err) => {
    console.error('[boot] FATAL:', err);
    process.exit(1);
});
