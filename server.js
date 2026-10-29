#!/usr/bin/env node
import { CommandLineParser } from './src/command-line.js';
import { serverDirectory } from './src/server-directory.js';
import http from 'node:http';

console.log(`Node version: ${process.version}. Running in ${process.env.NODE_ENV} environment. Server directory: ${serverDirectory}`);

/* --- venice shim: capture the express app --- */
const __origCreateServer = http.createServer;
http.createServer = function (listener) {
    globalThis.__ST_APP__ = listener;
    return __origCreateServer.call(http, listener);
};
/* --- end --- */

// config.yaml will be set when parsing command line arguments
const cliArgs = new CommandLineParser().parse(process.argv);
globalThis.DATA_ROOT = cliArgs.dataRoot;
globalThis.COMMAND_LINE_ARGS = cliArgs;
process.chdir(serverDirectory);

try {
    await import('./src/server-main.js');
} catch (error) {
    console.error('A critical error has occurred while starting the server:', error);
}

/* --- venice shim: mount routes --- */
if (globalThis.__ST_APP__) {
    const { mountVeniceShim } = await import('./venice-shim.mjs');
    mountVeniceShim(globalThis.__ST_APP__);
} else {
    console.error('[venice-shim] app not captured');
}
/* --- end --- */
