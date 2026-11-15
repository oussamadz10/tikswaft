// "Home worker": a copy of this server running on a home computer (residential IP),
// reachable through a Cloudflare tunnel. YouTube blocks data-center IPs, so Render
// forwards YouTube requests to the worker while it is online.
//
// The worker proves it knows WORKER_SECRET (set on Render and on the PC) with an HMAC.
'use strict';

const crypto = require('crypto');
const axios = require('axios');

const SECRET = process.env.WORKER_SECRET || '';
const IS_WORKER = process.env.IS_WORKER === '1';
const STALE_MS = 3 * 60 * 1000;   // the worker re-registers every minute

let current = null;               // { url, at, failures }

function sign(url, ts) {
    return crypto.createHmac('sha256', SECRET).update(url + '|' + ts).digest('hex');
}

function register({ url, ts, sig }) {
    if (!SECRET) throw Object.assign(new Error('WORKER_SECRET is not set on the server'), { status: 503 });
    if (typeof url !== 'string' || !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(url)) throw Object.assign(new Error('Bad worker URL'), { status: 400 });
    const t = Number(ts);
    if (!t || Math.abs(Date.now() - t) > 5 * 60 * 1000) throw Object.assign(new Error('Clock skew or old request'), { status: 400 });
    const expected = sign(url, t);
    const ok = typeof sig === 'string' && sig.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    if (!ok) throw Object.assign(new Error('Bad signature'), { status: 403 });
    if (!current || current.url !== url) console.log('[worker] registered ' + url);
    current = { url, at: Date.now(), failures: 0 };
    return { ok: true };
}

function active() {
    if (IS_WORKER || !current) return null;
    if (Date.now() - current.at > STALE_MS) return null;
    return current.url;
}

function status() {
    return { configured: !!SECRET, online: !!active(), lastSeenSecondsAgo: current ? Math.round((Date.now() - current.at) / 1000) : null };
}

// Forward a JSON POST to the worker; returns null when the worker cannot be reached
async function forward(path, body) {
    const base = active();
    if (!base) return null;
    try {
        const r = await axios.post(base + path, body, {
            timeout: 20 * 60 * 1000, validateStatus: () => true,
            headers: { 'Content-Type': 'application/json' }
        });
        // a tunnel error page is HTML, our API always answers JSON
        if (typeof r.data !== 'object' || r.data === null) throw new Error('worker answered ' + r.status);
        current.failures = 0;
        if (r.data.downloadUrl && r.data.downloadUrl.startsWith('/')) r.data.downloadUrl = base + r.data.downloadUrl;
        return { status: r.status, data: r.data };
    } catch (e) {
        console.warn('[worker] unreachable: ' + e.message);
        if (current && ++current.failures >= 2) current = null;
        return null;
    }
}

module.exports = { register, active, status, forward, sign, IS_WORKER };
