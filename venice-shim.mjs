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

async function models(req, res) {
    const type = new URL(req.url, 'http://x').searchParams.get('type') || 'text';
    try {
        const up = await fetch('https://api.venice.ai/api/v1/models?type=' + type, {
           
