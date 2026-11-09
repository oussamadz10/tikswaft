// yt-dlp helper: downloads the standalone yt-dlp binary (no Python needed),
// keeps it up to date, and runs it with safe arguments.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

let ffmpegPath = null;
try { ffmpegPath = require('@ffmpeg-installer/ffmpeg').path; } catch (e) { /* use ffmpeg from PATH */ }

const BIN_DIR = path.join(__dirname, '..', 'bin');
const BIN_NAME = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const BIN_PATH = process.env.YTDLP_PATH || path.join(BIN_DIR, BIN_NAME);

function assetName() {
    if (process.platform === 'win32') return 'yt-dlp.exe';
    if (process.platform === 'darwin') return 'yt-dlp_macos';
    if (process.arch === 'arm64') return 'yt-dlp_linux_aarch64';
    return 'yt-dlp_linux';
}

// Download a URL to a file, following redirects (GitHub releases redirect to a CDN)
function download(url, dest, redirects = 0) {
    return new Promise((resolve, reject) => {
        if (redirects > 8) return reject(new Error('Too many redirects'));
        https.get(url, { headers: { 'User-Agent': 'tikswaft-server' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                return resolve(download(new URL(res.headers.location, url).toString(), dest, redirects + 1));
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error('HTTP ' + res.statusCode + ' while downloading yt-dlp'));
            }
            const tmp = dest + '.part';
            const out = fs.createWriteStream(tmp);
            res.pipe(out);
            out.on('finish', () => out.close(() => {
                fs.renameSync(tmp, dest);
                try { fs.chmodSync(dest, 0o755); } catch (e) { /* windows */ }
                resolve(dest);
            }));
            out.on('error', reject);
        }).on('error', reject);
    });
}

async function installBinary() {
    fs.mkdirSync(BIN_DIR, { recursive: true });
    const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/' + assetName();
    console.log('[yt-dlp] downloading ' + url);
    await download(url, BIN_PATH);
    console.log('[yt-dlp] installed at ' + BIN_PATH);
    return BIN_PATH;
}

let readyPromise = null;
let supportsJsRuntimes = false;

function ensureYtDlp() {
    if (!readyPromise) {
        readyPromise = (async () => {
            if (!fs.existsSync(BIN_PATH)) await installBinary();
            try {
                const help = await run(['--help'], { timeout: 30000, raw: true });
                supportsJsRuntimes = help.stdout.includes('--js-runtimes');
            } catch (e) { /* ignore */ }
            return BIN_PATH;
        })().catch((err) => { readyPromise = null; throw err; });
    }
    return readyPromise;
}

// Update yt-dlp in the background (sites change often; new releases fix them)
function selfUpdate() {
    ensureYtDlp()
        .then(() => run(['-U'], { timeout: 120000, raw: true }))
        .then((r) => console.log('[yt-dlp] ' + (r.stdout.trim().split('\n').pop() || 'update checked')))
        .catch((e) => console.warn('[yt-dlp] update skipped: ' + e.message));
}

// Optional cookies per platform, from env vars (Netscape cookies.txt content, plain or base64)
const cookieFiles = {};
function cookiesFor(platform) {
    if (!platform) return null;
    if (cookieFiles[platform] !== undefined) return cookieFiles[platform];
    let raw = process.env['COOKIES_' + platform.toUpperCase()] || '';
    if (raw && !raw.includes('\t') && /^[A-Za-z0-9+/=\s]+$/.test(raw)) {
        try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch (e) { /* keep */ }
    }
    if (!raw.trim()) return (cookieFiles[platform] = null);
    const file = path.join(os.tmpdir(), 'tikswaft-cookies-' + platform + '.txt');
    fs.writeFileSync(file, raw.replace(/\\n/g, '\n'));
    return (cookieFiles[platform] = file);
}

function baseArgs(platform) {
    const args = ['--no-warnings', '--no-progress', '--no-playlist', '--no-cache-dir',
        '--socket-timeout', '20', '--retries', '3'];
    if (ffmpegPath) args.push('--ffmpeg-location', ffmpegPath);
    if (supportsJsRuntimes) args.push('--js-runtimes', 'node:' + process.execPath, '--remote-components', 'ejs:github');
    if (process.env.YTDLP_PROXY) args.push('--proxy', process.env.YTDLP_PROXY);
    const cookies = cookiesFor(platform);
    if (cookies) args.push('--cookies', cookies);
    if (platform === 'youtube' && process.env.YTDLP_YOUTUBE_ARGS) args.push('--extractor-args', 'youtube:' + process.env.YTDLP_YOUTUBE_ARGS);
    return args;
}

function run(args, opts = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(BIN_PATH, args, { windowsHide: true });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => { child.kill('SIGKILL'); }, opts.timeout || 300000);
        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', (d) => { stderr += d; if (stderr.length > 20000) stderr = stderr.slice(-20000); });
        child.on('error', (e) => { clearTimeout(timer); reject(e); });
        child.on('close', (code, signal) => {
            clearTimeout(timer);
            if (code === 0 || opts.raw) return resolve({ stdout, stderr, code });
            const err = new Error(cleanError(stderr) || ('yt-dlp exited with ' + (signal || code)));
            err.stderr = stderr;
            reject(err);
        });
    });
}

function cleanError(stderr) {
    const lines = String(stderr || '').split('\n').filter((l) => /ERROR/.test(l));
    return (lines.pop() || '').replace(/^.*?ERROR:\s*/, '').trim();
}

// Get metadata as JSON
async function getInfo(url, platform, extraArgs = []) {
    await ensureYtDlp();
    const args = baseArgs(platform).filter((a) => a !== '--no-playlist');
    if (platform !== 'instagram') args.push('--no-playlist');
    const r = await run([...args, ...extraArgs, '-J', '--', url], { timeout: 90000 });
    return JSON.parse(r.stdout);
}

// Download to a folder; returns the path of the produced file
async function downloadTo(url, platform, dir, extraArgs = []) {
    await ensureYtDlp();
    const outTpl = path.join(dir, 'media.%(ext)s');
    await run([...baseArgs(platform), ...extraArgs, '-o', outTpl, '--', url], { timeout: 15 * 60000 });
    const files = fs.readdirSync(dir)
        .filter((f) => f.startsWith('media.') && !/\.(part|ytdl|temp)$/.test(f) && !/\.f\d+\./.test(f))
        .map((f) => path.join(dir, f));
    if (!files.length) throw new Error('Download produced no file');
    files.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
    return files[0];
}

module.exports = { ensureYtDlp, installBinary, selfUpdate, getInfo, downloadTo, ffmpegPath, BIN_PATH };
