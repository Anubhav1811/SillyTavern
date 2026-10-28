// start.cjs — Hostinger entry point for SillyTavern.
//
// Why this file exists:
//  1. No top-level await — it crashes ESM entry files on Hostinger's Passenger setup.
//  2. Hostinger assigns no PORT, so we listen on the plausible ones and forward
//     to SillyTavern on an internal port.
//  3. LiteSpeed sits in front of Node, serves stale cached copies of Node
//     responses, and bypasses basic auth on anything it has cached. We disable
//     cache lookup in .htaccess on every boot.
//  4. Hostinger mirrors public/ into public_html. That is fine for every file
//     except lib.js, which must be the compiled bundle, not the source. We
//     delete the stale source copy so the request falls through to Node.

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
 * Disables LiteSpeed cache lookup.
 * LiteSpeed otherwise serves stale copies of Node responses, ignores file
 * changes on disk, and bypasses basic auth on anything it has already cached.
 * @param {string} dataRoot SillyTavern data root.
 */
function disableLiteSpeedCache(dataRoot) {
    const htaccess = path.join(path.resolve(dataRoot, '..'), 'public_html', '.htaccess');

    try {
        let content = '';
        if (fs.existsSync(htaccess)) {
            content = fs.readFileSync(htaccess, 'utf8');
        }

        if (content.includes('CacheLookup off')) {
            console.log('[boot] LiteSpeed cache already disabled');
            return;
        }

        fs.writeFileSync(
            htaccess,
            '<IfModule LiteSpeed>\nCacheLookup off\n</IfModule>\n' + content,
        );
        console.log('[boot] LITESPEED CACHE DISABLED via .htaccess');
    } catch (e) {
        console.error('[boot] htaccess patch failed:', e.message);
    }
}

/**
 * Deletes public_html/lib.js when it is the small un-bundled source file, so
 * the request falls through to Node and the webpack middleware serves the real
 * compiled bundle.
 * @param {string} dataRoot SillyTavern data root.
 */
function removeStaleLib(dataRoot) {
    const publicHtml = path.join(path.resolve(dataRoot, '..'), 'public_html');
    const target = path.join(publicHtml, 'lib.js');

    try {
        fs.writeFileSync(path.join(publicHtml, '__probe.txt'), 'PROBE_OK_' + Date.now());
        console.log('[boot] probe written');
    } catch (e) {
        console.error('[boot] probe write failed:', e.message);
    }

    try {
        if (!fs.existsSync(target)) {
            console.log('[boot] no lib.js in public_html — Node will serve it');
            return;
        }

        const size = fs.statSync(target).size;

        if (size > 50000) {
            console.log('[boot] lib.js already looks bundled (' + size + ' bytes) — leaving it');
            return;
        }

        fs.rmSync(target, { force: true });
        console.log('[boot] REMOVED stale source lib.js (' + size + ' bytes) — Node will serve the bundle');
    } catch (e) {
        console.error('[boot] remove failed:', e.message);
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
    disableLiteSpeedCache(cliArgs.dataRoot);
    removeStaleLib(cliArgs.dataRoot);

    await import('./src/server-main.js');
    console.log('[boot] server-main loaded');
})().catch((err) => {
    console.error('[boot] FATAL:', err);
    process.exit(1);
});
