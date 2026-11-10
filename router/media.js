// YouTube / Instagram / Facebook / X downloader API
//
//   POST /api/media/info      { url }                                  -> preview + available media
//   POST /api/media/prepare   { url, type, quality, index, start, duration }
//                             type: video | audio | mute | trim | image | thumbnail
//                             -> { success, downloadUrl, filename }   (file is ready on the server)
//   GET  /api/media/file/:token                                        -> the prepared file (attachment)
//   GET  /api/media/direct?url=...&type=...                            -> prepare + download in one request
'use strict';

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');

const ytdlp = require('../lib/ytdlp');
const { resolve, friendlyError, youtubeId, BROWSER_UA } = require('../lib/resolvers');

if (ytdlp.ffmpegPath) ffmpeg.setFfmpegPath(ytdlp.ffmpegPath);

const router = express.Router();

const WORK_DIR = path.join(os.tmpdir(), 'tikswaft-jobs');
fs.mkdirSync(WORK_DIR, { recursive: true });

const MAX_VIDEO_SECONDS = Number(process.env.MAX_VIDEO_SECONDS || 3600);   // 1 hour
const MAX_AUDIO_SECONDS = Number(process.env.MAX_AUDIO_SECONDS || 3 * 3600);
const MAX_TRIM_SECONDS = Number(process.env.MAX_TRIM_SECONDS || 600);
const FILE_TTL_MS = 20 * 60 * 1000;
const PREFIX = { youtube: 'youswaft', instagram: 'inswaft', facebook: 'faceswaft', x: 'xswaft', pinterest: 'pinswaft', xiaohongshu: 'redswaft' };

// ---------- small job queue (free Render instance: keep heavy work limited) ----------
const MAX_JOBS = Number(process.env.MAX_JOBS || 2);
let running = 0;
const waiting = [];
function withSlot(fn) {
    return new Promise((resolveP, rejectP) => {
        const start = () => {
            running++;
            Promise.resolve().then(fn).then(resolveP, rejectP).finally(() => {
                running--;
                if (waiting.length) waiting.shift()();
            });
        };
        if (running < MAX_JOBS) start(); else waiting.push(start);
    });
}

// ---------- prepared files ----------
const files = new Map(); // token -> { file, dir, filename, at }
function register(file, dir, filename) {
    const token = crypto.randomBytes(16).toString('hex');
    files.set(token, { file, dir, filename, at: Date.now() });
    return token;
}
function rmDir(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ } }
setInterval(() => {
    const now = Date.now();
    for (const [t, f] of files) if (now - f.at > FILE_TTL_MS) { rmDir(f.dir); files.delete(t); }
    // orphan folders (crashed jobs)
    try {
        fs.readdirSync(WORK_DIR).forEach((d) => {
            const p = path.join(WORK_DIR, d);
            if (now - fs.statSync(p).mtimeMs > FILE_TTL_MS * 2 && ![...files.values()].some((f) => f.dir === p)) rmDir(p);
        });
    } catch (e) { /* ignore */ }
}, 60 * 1000).unref();

// ---------- helpers ----------
function slug(text, fallback) {
    const s = String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/https?:\/\/\S+/g, '').replace(/[^\p{L}\p{N}_\s-]/gu, '').trim().replace(/\s+/g, '_').slice(0, 50);
    return s || fallback;
}

function badRequest(msg) { const e = new Error(msg); e.status = 400; return e; }

function toSeconds(v) {
    if (v === undefined || v === null || v === '') return NaN;
    const s = String(v).trim().replace(',', '.');
    if (s.includes(':')) return s.split(':').reduce((acc, p) => acc * 60 + Number(p), 0);
    return Number(s);
}

async function fetchToFile(url, dest, referer) {
    const res = await axios({
        method: 'get', url, responseType: 'stream', timeout: 60000, maxRedirects: 10,
        headers: { 'User-Agent': BROWSER_UA, ...(referer ? { Referer: referer } : {}) }
    });
    await new Promise((ok, fail) => {
        const out = fs.createWriteStream(dest);
        res.data.pipe(out);
        out.on('finish', ok);
        out.on('error', fail);
        res.data.on('error', fail);
    });
    if (!fs.statSync(dest).size) throw new Error('Downloaded file is empty');
    return { file: dest, contentType: res.headers['content-type'] || '' };
}

function runFfmpeg(input, output, configure) {
    return new Promise((ok, fail) => {
        const cmd = ffmpeg(input);
        configure(cmd);
        cmd.on('error', (err) => fail(new Error('Processing failed: ' + err.message.split('\n')[0])))
            .on('end', () => ok(output))
            .save(output);
    });
}

function formatFor(quality, videoOnly) {
    const q = Number(quality) || Number(process.env.MAX_HEIGHT || 1080);
    const h = Math.min(q, Number(process.env.MAX_HEIGHT || 1080));
    return videoOnly
        ? ['-f', `bv*[height<=${h}][ext=mp4]/bv*[height<=${h}]/b[height<=${h}]/bv*/b`, '-S', 'vcodec:h264']
        : ['-f', `bv*[height<=${h}]+ba/b[height<=${h}]/bv*+ba/b`, '-S', `vcodec:h264,acodec:m4a`, '--merge-output-format', 'mp4'];
}

// Get a local video file for one media item (yt-dlp first, direct URL second)
async function getVideoFile(info, item, dir, { quality, videoOnly, section } = {}) {
    const errors = [];
    if (info.engine === 'ytdlp' || info.engine === 'none' || !item.url) {
        try {
            const target = item.pageUrl || info.url;
            const extra = [...formatFor(quality, videoOnly)];
            if (info.media.length > 1 && info.platform === 'instagram') extra.push('--playlist-items', String(item.index + 1));
            if (section) extra.push('--download-sections', `*${section.start}-${section.start + section.duration}`);
            try {
                return await ytdlp.downloadTo(target, info.platform, dir, extra);
            } catch (e) {
                if (info.platform !== 'youtube') throw e;
                errors.push(e);
                return await ytdlp.downloadTo(target, info.platform, dir, [...extra, '--extractor-args', 'youtube:player_client=tv,web_safari,mweb,android_vr']);
            }
        } catch (e) {
            errors.push(e);
        }
    }
    if (item.url) {
        try {
            return (await fetchToFile(item.url, path.join(dir, 'source.mp4'), info.url)).file;
        } catch (e) {
            if (item.sdUrl && item.sdUrl !== item.url) return (await fetchToFile(item.sdUrl, path.join(dir, 'source.mp4'), info.url)).file;
            errors.push(e);
        }
    }
    throw new Error(friendlyError(errors[0] && errors[0].message, info.platform));
}

async function prepare(body) {
    const type = String(body.type || 'video').toLowerCase();
    if (!['video', 'audio', 'mute', 'trim', 'image', 'thumbnail'].includes(type)) throw badRequest('Unknown download type');
    if (!body.url) throw badRequest('A link is required');

    // Thumbnails of YouTube videos don't need the full extractor
    if (type === 'thumbnail' && youtubeId(body.url)) {
        const id = youtubeId(body.url);
        const dir = fs.mkdtempSync(path.join(WORK_DIR, 'j'));
        let saved = null;
        for (const name of ['maxresdefault', 'sddefault', 'hqdefault']) {
            try { saved = (await fetchToFile(`https://i.ytimg.com/vi/${id}/${name}.jpg`, path.join(dir, 'thumb.jpg'))).file; break; } catch (e) { /* next */ }
        }
        if (!saved) { rmDir(dir); throw new Error('Thumbnail not found'); }
        return { token: register(saved, dir, `youswaft_thumbnail_${id}.jpg`), filename: `youswaft_thumbnail_${id}.jpg` };
    }

    const info = await resolve(body.url);
    const index = Math.max(0, parseInt(body.index, 10) || 0);
    const item = info.media[index] || info.media[0] || { index: 0, type: 'video', url: null, pageUrl: info.url };
    const base = PREFIX[info.platform] + '_' + slug(info.title, info.id || Date.now());
    const duration = item.duration || info.duration || 0;

    return withSlot(async () => {
        const dir = fs.mkdtempSync(path.join(WORK_DIR, 'j'));
        try {
            let file;
            let filename;

            if (type === 'thumbnail') {
                const src = item.thumbnail || info.thumbnail;
                if (!src) throw new Error('No thumbnail available');
                file = (await fetchToFile(src, path.join(dir, 'thumb.jpg'), info.url)).file;
                filename = base + '_thumbnail.jpg';
            } else if (type === 'image') {
                if (item.type !== 'image' || !item.url) throw badRequest('This item is not an image');
                let r;
                try { r = await fetchToFile(item.url, path.join(dir, 'image'), info.url); }
                catch (e) { if (!item.altUrl) throw e; r = await fetchToFile(item.altUrl, path.join(dir, 'image'), info.url); }
                const ext = /png/.test(r.contentType) ? 'png' : /webp/.test(r.contentType) ? 'webp' : 'jpg';
                file = path.join(dir, 'image.' + ext);
                fs.renameSync(r.file, file);
                filename = `${base}_${index + 1}.${ext}`;
            } else if (type === 'audio') {
                if (duration > MAX_AUDIO_SECONDS) throw badRequest('This audio is too long (max ' + Math.round(MAX_AUDIO_SECONDS / 60) + ' minutes).');
                if (item.type === 'image') throw badRequest('This post is a photo, it has no audio.');
                let ok = false;
                if (info.engine === 'ytdlp' || info.engine === 'none') {
                    try {
                        const extra = ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '192K'];
                        if (info.media.length > 1 && info.platform === 'instagram') extra.push('--playlist-items', String(index + 1));
                        file = await ytdlp.downloadTo(item.pageUrl || info.url, info.platform, dir, extra);
                        ok = /\.mp3$/i.test(file);
                    } catch (e) { if (!item.url) throw new Error(friendlyError(e.message, info.platform)); }
                }
                if (!ok) {
                    const src = await getVideoFile(info, item, dir, { quality: 360 });
                    file = await runFfmpeg(src, path.join(dir, 'audio.mp3'), (c) => c.noVideo().audioCodec('libmp3lame').audioBitrate(192));
                }
                filename = base + '.mp3';
            } else if (type === 'mute') {
                if (duration > MAX_VIDEO_SECONDS) throw badRequest('This video is too long (max ' + Math.round(MAX_VIDEO_SECONDS / 60) + ' minutes).');
                const src = await getVideoFile(info, item, dir, { quality: body.quality, videoOnly: true });
                file = await runFfmpeg(src, path.join(dir, 'muted.mp4'), (c) => c.noAudio().videoCodec('copy').outputOptions(['-movflags', '+faststart']));
                filename = base + '_muted.mp4';
            } else if (type === 'trim') {
                const start = toSeconds(body.start);
                let len = toSeconds(body.duration);
                if (!isFinite(start) || start < 0) throw badRequest('Start time must be 0 or more (seconds or mm:ss).');
                if (!isFinite(len) || len <= 0) throw badRequest('Duration must be more than 0 seconds.');
                if (len > MAX_TRIM_SECONDS) throw badRequest('Maximum trim length is ' + MAX_TRIM_SECONDS + ' seconds.');
                if (duration && start >= duration) throw badRequest('Start time is after the end of the video (' + Math.floor(duration) + 's).');
                if (duration) len = Math.min(len, duration - start);
                // For long videos let yt-dlp fetch only the needed part
                const useSection = duration > 180 && (info.engine === 'ytdlp');
                const src = await getVideoFile(info, item, dir, {
                    quality: body.quality || 720,
                    section: useSection ? { start: Math.max(0, Math.floor(start) - 2), duration: Math.ceil(len) + 4 } : null
                });
                const offset = useSection ? start - Math.max(0, Math.floor(start) - 2) : start;
                file = await runFfmpeg(src, path.join(dir, 'trimmed.mp4'), (c) => c
                    .setStartTime(offset).setDuration(len)
                    .videoCodec('libx264').audioCodec('aac')
                    .outputOptions(['-preset', 'veryfast', '-crf', '23', '-movflags', '+faststart']));
                filename = `${base}_trim_${Math.floor(start)}s-${Math.floor(start + len)}s.mp4`;
            } else {
                if (item.type === 'image') throw badRequest('This item is a photo. Use the image download button.');
                if (duration > MAX_VIDEO_SECONDS) throw badRequest('This video is too long (max ' + Math.round(MAX_VIDEO_SECONDS / 60) + ' minutes).');
                file = await getVideoFile(info, item, dir, { quality: body.quality });
                const ext = path.extname(file).slice(1) || 'mp4';
                filename = `${base}${body.quality ? '_' + body.quality + 'p' : ''}.${ext}`;
            }

            if (!file || !fs.existsSync(file) || !fs.statSync(file).size) throw new Error('The file could not be created. Please try again.');
            return { token: register(file, dir, filename), filename, size: fs.statSync(file).size };
        } catch (e) {
            rmDir(dir);
            throw e;
        }
    });
}

function sendError(res, err, asHtml) {
    const status = err.status || 500;
    const msg = err.status ? err.message : (err.message && err.message.length < 220 ? err.message : 'Server error, please try again.');
    if (status >= 500) console.error('[media] ' + (err.stack || err.message));
    if (asHtml) {
        const safe = msg.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        return res.status(status).type('html').send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Download error</title><body style="background:#0b0b0e;color:#fff;font-family:Arial,sans-serif;text-align:center;padding:60px 20px"><h2>Download failed</h2><p style="color:#bbb">${safe}</p><p><a style="color:#25f4ee" href="javascript:history.back()">Go back</a></p></body>`);
    }
    res.status(status).json({ success: false, error: msg, detail: err.detail || (err.status ? undefined : String(err.message || '').slice(0, 400)) });
}

// ---------- routes ----------
router.get('/health', async (req, res) => {
    let ytdlpReady = false;
    try { await ytdlp.ensureYtDlp(); ytdlpReady = true; } catch (e) { /* not ready */ }
    res.json({ success: true, ytdlp: ytdlpReady, jobs: running, queued: waiting.length });
});

router.post('/info', async (req, res) => {
    try {
        const info = await resolve(String((req.body && req.body.url) || ''));
        res.json({
            success: true,
            platform: info.platform,
            title: info.title,
            uploader: info.uploader,
            thumbnail: info.thumbnail,
            duration: info.duration,
            warning: info.error || null,
            detail: info.detail || undefined,
            media: info.media.map((m) => ({
                index: m.index, type: m.type, thumbnail: m.thumbnail || info.thumbnail,
                width: m.width || null, height: m.height || null, duration: m.duration || null,
                qualities: m.qualities || []
            }))
        });
    } catch (e) { sendError(res, e); }
});

router.post('/prepare', async (req, res) => {
    req.setTimeout(20 * 60000);
    try {
        const r = await prepare(req.body || {});
        res.json({ success: true, downloadUrl: '/api/media/file/' + r.token, filename: r.filename, size: r.size });
    } catch (e) { sendError(res, e); }
});

router.get('/file/:token', (req, res) => {
    const f = files.get(req.params.token);
    if (!f || !fs.existsSync(f.file)) return sendError(res, Object.assign(new Error('This download link expired. Please start the download again.'), { status: 404 }), true);
    res.download(f.file, f.filename);
});

router.get('/direct', async (req, res) => {
    req.setTimeout(20 * 60000);
    try {
        const r = await prepare(req.query || {});
        const f = files.get(r.token);
        res.download(f.file, f.filename);
    } catch (e) { sendError(res, e, true); }
});

module.exports = router;
