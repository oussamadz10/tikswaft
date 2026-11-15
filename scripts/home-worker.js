// Runs on a home computer: starts this server in "worker" mode, opens a free
// Cloudflare quick tunnel to it, and tells the Render server where to find it.
//
//   Windows: double-click start-youtube-worker.bat
//   Others:  WORKER_SECRET=... node scripts/home-worker.js
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin');
const PORT = Number(process.env.WORKER_PORT || 3005);
const RENDER = (process.env.RENDER_URL || 'https://tikswaft.onrender.com').replace(/\/$/, '');
const SECRET_FILE = path.join(ROOT, 'worker-secret.txt');
const SECRET = (process.env.WORKER_SECRET || (fs.existsSync(SECRET_FILE) ? fs.readFileSync(SECRET_FILE, 'utf8') : '')).trim();

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

if (!SECRET) {
    console.error('\n  worker-secret.txt is missing or empty. Put the same secret there and in Render (WORKER_SECRET).\n');
    process.exit(1);
}

function download(url, dest, redirects = 0) {
    return new Promise((resolve, reject) => {
        if (redirects > 8) return reject(new Error('Too many redirects'));
        https.get(url, { headers: { 'User-Agent': 'tikswaft-worker' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                return resolve(download(new URL(res.headers.location, url).toString(), dest, redirects + 1));
            }
            if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
            const out = fs.createWriteStream(dest + '.part');
            res.pipe(out);
            out.on('finish', () => out.close(() => { fs.renameSync(dest + '.part', dest); resolve(dest); }));
            out.on('error', reject);
        }).on('error', reject);
    });
}

async function cloudflaredPath() {
    const name = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
    const file = path.join(BIN, name);
    if (fs.existsSync(file)) return file;
    fs.mkdirSync(BIN, { recursive: true });
    const asset = process.platform === 'win32' ? 'cloudflared-windows-amd64.exe'
        : process.platform === 'darwin' ? 'cloudflared-darwin-amd64.tgz' : 'cloudflared-linux-amd64';
    log('Downloading cloudflared (first run only)...');
    await download('https://github.com/cloudflare/cloudflared/releases/latest/download/' + asset, file);
    try { fs.chmodSync(file, 0o755); } catch (e) { /* windows */ }
    return file;
}

// ---- 1. the server, in worker mode ----
function startServer() {
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
        cwd: ROOT, stdio: 'inherit',
        env: Object.assign({}, process.env, { PORT: String(PORT), IS_WORKER: '1' })
    });
    child.on('exit', (code) => { log('Server stopped (' + code + '), restarting in 5 s'); setTimeout(startServer, 5000); });
}

// ---- 2. the tunnel ----
let publicUrl = null;
async function startTunnel() {
    const bin = await cloudflaredPath();
    const child = spawn(bin, ['tunnel', '--no-autoupdate', '--url', 'http://localhost:' + PORT], { cwd: ROOT });
    const onData = (d) => {
        const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
        if (m && m[0] !== publicUrl) {
            publicUrl = m[0];
            log('Tunnel ready: ' + publicUrl);
            registerNow();
        }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => { log('Tunnel stopped (' + code + '), restarting in 5 s'); publicUrl = null; setTimeout(startTunnel, 5000); });
}

// ---- 3. tell Render where we are (every minute) ----
function registerNow() {
    if (!publicUrl) return;
    const ts = Date.now();
    const sig = crypto.createHmac('sha256', SECRET).update(publicUrl + '|' + ts).digest('hex');
    const body = JSON.stringify({ url: publicUrl, ts, sig });
    const req = https.request(RENDER + '/api/media/worker/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 60000
    }, (res) => {
        let text = '';
        res.on('data', (d) => { text += d; });
        res.on('end', () => {
            if (res.statusCode === 200) { if (!registerNow.ok) log('Connected to ' + RENDER + ' — YouTube now runs on this computer.'); registerNow.ok = true; }
            else { registerNow.ok = false; log('Render refused the registration (' + res.statusCode + '): ' + text.slice(0, 200)); }
        });
    });
    req.on('error', (e) => { registerNow.ok = false; log('Cannot reach Render (it may be waking up): ' + e.message); });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end(body);
}

log('TikSwaft YouTube worker starting. Keep this window open.');
startServer();
startTunnel().catch((e) => { log('Tunnel failed: ' + e.message); process.exit(1); });
setInterval(registerNow, 60 * 1000);
