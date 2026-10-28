// Hostinger binds the app to a dynamic port via process.env.PORT.
// SillyTavern reads its port from SILLYTAVERN_PORT, so bridge them.
if (process.env.PORT && !process.env.SILLYTAVERN_PORT) {
    process.env.SILLYTAVERN_PORT = process.env.PORT;
}

await import('./server.js');
