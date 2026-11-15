// Cloudflare WARP as a local SOCKS5 proxy, used only when YouTube blocks the server's IP.
//   wgcf      registers a free WARP device and writes a WireGuard profile
//   wireproxy runs that WireGuard tunnel in user space and exposes SOCKS5 on 127.0.0.1
// No root, no kernel module: both are single static binaries.
'use strict';

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const https = require('https');
const { spawn, execFile } = require('child_process');

const BIN_DIR = path.join(__dirname, '..', 'bin');
const WGCF = path.join(BIN_DIR, 'wgcf');
const WIREPROXY = path.join(BIN_DIR, 'wireproxy');
const WORK = path.join(os.tmpdir(), 'tikswaft-warp');
const PORT = Number(process.env.WARP_PORT || 40000);

let proc = null;
let starting = null;
let lastError = null;

function get(url, redirects = 0) {
    return new Promise((resolve, reject) => {
        if (redirects > 8) return reject(new Error('Too many redirects'));
        https.get(url, { headers: { 'User-Agent': 'tikswaft-server', Accept: '*/*' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                return resolve(get(new URL(res.headers.location, url).toString(), redirects + 1));
            }
            if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' for ' + url)); }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

async function latestAsset(repo, pattern) {
    const rel = JSON.parse((await get('https://api.github.com/repos/' + repo + '/releases/latest')).toString());
    const asset = (rel.assets || []).find((a) => pattern.test(a.name));
    if (!asset) throw new Error('No matching asset in ' + repo);
    return asset.browser_download_url;
}

function run(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, Object.assign({ timeout: 60000 }, opts), (err, stdout, stderr) => {
            if (err) { err.message += ' ' + String(stderr || stdout).slice(-300); return reject(err); }
            resolve(String(stdout));
        });
    });
}

async function install() {
    if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('WARP proxy only set up for linux x64');
    fs.mkdirSync(BIN_DIR, { recursive: true });
    if (!fs.existsSync(WGCF)) {
        const url = await latestAsset('ViRb3/wgcf', /linux_amd64$/);
        fs.writeFileSync(WGCF, await get(url));
        fs.chmodSync(WGCF, 0o755);
        console.log('[warp] wgcf installed');
    }
    if (!fs.existsSync(WIREPROXY)) {
        const url = await latestAsset('pufferffish/wireproxy', /linux_amd64\.tar\.gz$/);
        const tgz = path.join(BIN_DIR, 'wireproxy.tar.gz');
        fs.writeFileSync(tgz, await get(url));
        await run('tar', ['-xzf', tgz, '-C', BIN_DIR]);
        fs.unlinkSync(tgz);
        fs.chmodSync(WIREPROXY, 0o755);
        console.log('[warp] wireproxy installed');
    }
}

function portOpen() {
    return new Promise((resolve) => {
        const s = net.connect(PORT, '127.0.0.1');
        s.once('connect', () => { s.destroy(); resolve(true); });
        s.once('error', () => resolve(false));
        s.setTimeout(1500, () => { s.destroy(); resolve(false); });
    });
}

async function startInner() {
    await install();
    fs.mkdirSync(WORK, { recursive: true });
    const profile = path.join(WORK, 'wgcf-profile.conf');
    if (!fs.existsSync(path.join(WORK, 'wgcf-account.toml'))) {
        await run(WGCF, ['register', '--accept-tos'], { cwd: WORK });
    }
    if (!fs.existsSync(profile)) {
        await run(WGCF, ['generate'], { cwd: WORK });
    }
    const conf = path.join(WORK, 'wireproxy.conf');
    fs.writeFileSync(conf, `WGConfig = ${profile}\n\n[Socks5]\nBindAddress = 127.0.0.1:${PORT}\n`);
    proc = spawn(WIREPROXY, ['-c', conf], { stdio: ['ignore', 'ignore', 'pipe'] });
    let errText = '';
    proc.stderr.on('data', (d) => { errText = (errText + d).slice(-500); });
    proc.on('exit', (code) => { console.warn('[warp] wireproxy exited ' + code + ' ' + errText); proc = null; });
    for (let i = 0; i < 30; i++) {
        if (await portOpen()) { console.log('[warp] proxy ready on ' + PORT); return proxyUrl(); }
        if (!proc) break;
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('wireproxy did not start: ' + errText);
}

function proxyUrl() { return 'socks5://127.0.0.1:' + PORT; }

// Returns the proxy URL, starting the tunnel on first use
async function ensure() {
    if (process.env.WARP_DISABLED === '1') throw new Error('WARP disabled');
    if (proc && await portOpen()) return proxyUrl();
    if (!starting) {
        starting = startInner()
            .then((u) => { lastError = null; return u; })
            .catch((e) => { lastError = e.message; throw e; })
            .finally(() => { starting = null; });
    }
    return starting;
}

function status() {
    return { running: !!proc, lastError, installed: fs.existsSync(WGCF) && fs.existsSync(WIREPROXY) };
}

module.exports = { ensure, install, status };
