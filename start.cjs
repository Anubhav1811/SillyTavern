// start.cjs — Hostinger entry. No top-level await. Handles TCP port or socket.
const net = require('node:net');

const assigned = process.env.PORT;
const isSocket = !!assigned && !/^\d+$/.test(assigned);
const targetPort = isSocket ? 8000 : (assigned || 8000);

console.log('[boot] PORT env =', JSON.stringify(assigned), '| mode =', isSocket ? 'SOCKET' : 'TCP');

process.env.SILLYTAVERN_PORT = String(targetPort);

(async () => {
    const { CommandLineParser } = await import('./src/command-line.js');
    const { serverDirectory } = await import('./src/server-directory.js');

    const cliArgs = new CommandLineParser().parse(process.argv);
    globalThis.DATA_ROOT = cliArgs.dataRoot;
    globalThis.COMMAND_LINE_ARGS = cliArgs;
    process.chdir(serverDirectory);

    console.log('[boot] dataRoot =', cliArgs.dataRoot, '| port =', cliArgs.port, '| listen =', cliArgs.listen);

    await import('./src/server-main.js');

    if (isSocket) {
        const bridge = net.createServer((sock) => {
            const up = net.connect(targetPort, '127.0.0.1');
            sock.pipe(up).pipe(sock);
            sock.on('error', () => up.destroy());
            up.on('error', () => sock.destroy());
        });
        setTimeout(() => {
            bridge.listen(assigned, () => console.log('[boot] socket bridge live on', assigned));
        }, 1500);
    }
})().catch((err) => {
    console.error('[boot] FATAL:', err);
    process.exit(1);
});
