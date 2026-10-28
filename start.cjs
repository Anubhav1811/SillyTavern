// start.cjs — front listeners on candidate ports, ST behind them.
const net = require('node:net');

const assigned = process.env.PORT;
const isSocket = !!assigned && !/^\d+$/.test(assigned);
const ST_PORT = 8765;

const targets = new Set();
if (assigned) targets.add(assigned);
for (const p of ['3000', '8000', '8080', '5000']) targets.add(p);

console.log('[boot] PORT env =', JSON.stringify(assigned), '| socket =', isSocket, '| targets =', [...targets].join(','), '| stPort =', ST_PORT);

process.env.SILLYTAVERN_PORT = String(ST_PORT);
process.env.SILLYTAVERN_LISTEN = 'true';

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
                pending.forEach((c) => up.write(c));
                pending = [];
                client.pipe(up);
                up.pipe(client);
            });
            up.on('error', () => {
                up.destroy();
                if (!live && tries++ < 400) setTimeout(attempt, 250);
                else if (!live) client.destroy();
            });
        };

        client.on('data', (c) => { if (!live) pending.push(c); });
        client.on('error', () => {});
        attempt();
    });

    server.on('error', (e) => console.error('[boot] front', target, 'failed:', e.code || e.message));
    server.listen(target, () => console.log('[boot] FRONT LISTENING on', target));
}

(async () => {
    const { CommandLineParser } = await import('./src/command-line.js');
    const { serverDirectory } = await import('./src/server-directory.js');

    const cliArgs = new CommandLineParser().parse(process.argv);
    globalThis.DATA_ROOT = cliArgs.dataRoot;
    globalThis.COMMAND_LINE_ARGS = cliArgs;
    process.chdir(serverDirectory);

    console.log('[boot] dataRoot =', cliArgs.dataRoot, '| port =', cliArgs.port, '| listen =', cliArgs.listen);

    [...targets].forEach(startFront);

    await import('./src/server-main.js');
    console.log('[boot] server-main loaded');
})().catch((err) => {
    console.error('[boot] FATAL:', err);
    process.exit(1);
});
