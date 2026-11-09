// Turns a YouTube / Instagram / Facebook / X link into a normalized media description.
// yt-dlp is the main engine; each platform also has a lightweight fallback.
'use strict';

const axios = require('axios');
const ytdlp = require('./ytdlp');

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const PLATFORMS = {
    youtube: /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i,
    instagram: /(^|\.)(instagram\.com|instagr\.am|ddinstagram\.com)$/i,
    facebook: /(^|\.)(facebook\.com|fb\.watch|fb\.com|fb\.gg)$/i,
    x: /(^|\.)(twitter\.com|x\.com|t\.co|vxtwitter\.com|fxtwitter\.com|fixupx\.com|fixvx\.com)$/i
};

function detectPlatform(raw) {
    let u;
    try { u = new URL(String(raw).trim()); } catch (e) { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    for (const [name, re] of Object.entries(PLATFORMS)) if (re.test(u.hostname)) return name;
    return null;
}

// Follow redirects of short/share links (fb.watch, facebook.com/share/..., t.co)
async function expandUrl(url) {
    try {
        const res = await axios.get(url, {
            maxRedirects: 10, timeout: 15000, headers: { 'User-Agent': BROWSER_UA },
            validateStatus: () => true, responseType: 'stream'
        });
        res.data.destroy();
        const finalUrl = res.request && res.request.res && res.request.res.responseUrl;
        return finalUrl || url;
    } catch (e) {
        return url;
    }
}

async function normalizeUrl(url, platform) {
    url = String(url).trim();
    const u = new URL(url);
    if (platform === 'x') {
        if (/t\.co$/i.test(u.hostname)) url = await expandUrl(url);
        const m = url.match(/status(?:es)?\/(\d+)/);
        if (m) return 'https://x.com/i/status/' + m[1];
    }
    if (platform === 'facebook' && (/fb\.watch$/i.test(u.hostname) || /\/share\//.test(u.pathname))) {
        const expanded = await expandUrl(url);
        if (!/login/.test(expanded)) return expanded;
    }
    if (platform === 'instagram') {
        const m = u.pathname.match(/\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
        if (m) return 'https://www.instagram.com/' + (m[1] === 'reels' ? 'reel' : m[1]) + '/' + m[2] + '/';
    }
    if (platform === 'youtube') {
        const id = youtubeId(url);
        if (id) return 'https://www.youtube.com/watch?v=' + id;
    }
    return url;
}

function youtubeId(url) {
    try {
        const u = new URL(url);
        if (/youtu\.be$/i.test(u.hostname)) return u.pathname.slice(1).split('/')[0] || null;
        if (u.searchParams.get('v')) return u.searchParams.get('v');
        const m = u.pathname.match(/\/(shorts|embed|live|v)\/([A-Za-z0-9_-]{6,})/);
        return m ? m[2] : null;
    } catch (e) { return null; }
}

// ---------- normalize yt-dlp JSON ----------
function heightsFrom(formats) {
    const max = Number(process.env.MAX_HEIGHT || 1080);
    const set = new Set();
    (formats || []).forEach((f) => {
        if (f.vcodec && f.vcodec !== 'none' && f.height) {
            const std = [2160, 1440, 1080, 720, 480, 360, 240, 144].find((h) => f.height >= h * 0.9) || f.height;
            if (std <= max) set.add(std);
        }
    });
    return [...set].sort((a, b) => b - a).slice(0, 5);
}

function fromYtDlp(info, platform, url) {
    const entries = info._type === 'playlist' && Array.isArray(info.entries) ? info.entries.filter(Boolean) : [info];
    const media = entries.map((e, i) => {
        const isVideo = !!((e.formats && e.formats.some((f) => f.vcodec && f.vcodec !== 'none')) || e.duration);
        return {
            index: i,
            type: isVideo ? 'video' : 'image',
            url: e.url || null,
            pageUrl: e.webpage_url || e.original_url || url,
            thumbnail: e.thumbnail || null,
            width: e.width || null,
            height: e.height || null,
            duration: e.duration || null,
            qualities: heightsFrom(e.formats)
        };
    });
    const first = entries[0] || {};
    return {
        engine: 'ytdlp',
        platform,
        url,
        id: info.id || first.id || null,
        title: info.title || first.title || info.description || '',
        uploader: info.uploader || info.channel || first.uploader || '',
        thumbnail: info.thumbnail || first.thumbnail || null,
        duration: first.duration || info.duration || null,
        media
    };
}

// ---------- fallbacks ----------
async function xFallback(url) {
    const id = (url.match(/status(?:es)?\/(\d+)/) || [])[1];
    if (!id) throw new Error('Invalid X/Twitter link (no status id)');
    // 1) vxtwitter
    try {
        const { data } = await axios.get('https://api.vxtwitter.com/Twitter/status/' + id, { timeout: 15000 });
        const list = (data && data.media_extended) || [];
        if (list.length) {
            return {
                engine: 'direct', platform: 'x', url, id,
                title: data.text || 'X post', uploader: data.user_name || data.user_screen_name || '',
                thumbnail: list[0].thumbnail_url || (list[0].type === 'image' ? list[0].url : null),
                duration: list[0].duration_millis ? list[0].duration_millis / 1000 : null,
                media: list.map((m, i) => ({
                    index: i, type: m.type === 'image' ? 'image' : 'video', url: m.url,
                    thumbnail: m.thumbnail_url || (m.type === 'image' ? m.url : null),
                    width: m.size && m.size.width, height: m.size && m.size.height,
                    duration: m.duration_millis ? m.duration_millis / 1000 : null, qualities: []
                }))
            };
        }
    } catch (e) { /* try next */ }
    // 2) fxtwitter
    const { data } = await axios.get('https://api.fxtwitter.com/status/' + id, { timeout: 15000 });
    const t = data && data.tweet;
    const all = (t && t.media && t.media.all) || [];
    if (!all.length) throw new Error('This post has no video or photo');
    return {
        engine: 'direct', platform: 'x', url, id,
        title: t.text || 'X post', uploader: (t.author && t.author.name) || '',
        thumbnail: all[0].thumbnail_url || all[0].url, duration: all[0].duration || null,
        media: all.map((m, i) => ({
            index: i, type: m.type === 'photo' ? 'image' : 'video', url: m.url,
            thumbnail: m.thumbnail_url || (m.type === 'photo' ? m.url : null),
            width: m.width, height: m.height, duration: m.duration || null, qualities: []
        }))
    };
}

function decodeHtml(s) {
    return String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function unescapeJson(s) {
    try { return JSON.parse('"' + s + '"'); } catch (e) { return s.replace(/\\\//g, '/'); }
}
function metaTag(html, prop) {
    const re = new RegExp('<meta[^>]+(?:property|name)=["\']' + prop + '["\'][^>]+content=["\']([^"\']*)', 'i');
    const m = html.match(re);
    return m ? decodeHtml(m[1]) : null;
}

let instagramGetUrl = null;
try { instagramGetUrl = require('instagram-url-direct'); } catch (e) { /* optional */ }

async function instagramFallback(url) {
    // 1) instagram-url-direct package
    const fn = typeof instagramGetUrl === 'function' ? instagramGetUrl : (instagramGetUrl && instagramGetUrl.instagramGetUrl);
    if (fn) {
        try {
            const r = await fn(url);
            const details = (r && r.media_details) || [];
            const list = details.length
                ? details.map((d) => ({ type: d.type === 'video' ? 'video' : 'image', url: d.url, thumbnail: d.thumbnail || (d.type !== 'video' ? d.url : null) }))
                : ((r && r.url_list) || []).map((u) => ({ type: /\.mp4|video/i.test(u) ? 'video' : 'image', url: u, thumbnail: null }));
            if (list.length) {
                const info = r.post_info || {};
                return {
                    engine: 'direct', platform: 'instagram', url, id: null,
                    title: info.caption || 'Instagram post', uploader: info.owner_username || '',
                    thumbnail: list[0].thumbnail || null, duration: null,
                    media: list.map((m, i) => Object.assign({ index: i, qualities: [] }, m))
                };
            }
        } catch (e) { /* try next */ }
    }
    // 2) public embed page
    const code = (url.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/) || [])[1];
    if (!code) throw new Error('Unsupported Instagram link');
    const { data: html } = await axios.get('https://www.instagram.com/p/' + code + '/embed/captioned/', {
        timeout: 15000, headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9' }
    });
    const media = [];
    const vids = [...String(html).matchAll(/\\?"video_url\\?"\s*:\s*\\?"([^"\\]*(?:\\.[^"\\]*)*?)\\?"/g)];
    vids.forEach((m) => {
        const u = unescapeJson(m[1].replace(/\\\\/g, '\\'));
        if (u.startsWith('http') && !media.some((x) => x.url === u)) media.push({ type: 'video', url: u, thumbnail: null });
    });
    if (!media.length) {
        const imgs = [...String(html).matchAll(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/g)].map((m) => decodeHtml(m[1]));
        imgs.forEach((u) => media.push({ type: 'image', url: u, thumbnail: u }));
    }
    if (!media.length) throw new Error('Could not find media. The post may be private or need login.');
    const thumb = metaTag(html, 'og:image') || (media[0].type === 'image' ? media[0].url : null);
    return {
        engine: 'direct', platform: 'instagram', url, id: code,
        title: 'Instagram post', uploader: '', thumbnail: thumb, duration: null,
        media: media.map((m, i) => Object.assign({ index: i, qualities: [] }, m, { thumbnail: m.thumbnail || thumb }))
    };
}

async function facebookFallback(url) {
    const { data: html } = await axios.get(url, {
        timeout: 20000,
        headers: {
            'User-Agent': BROWSER_UA, 'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9', 'Sec-Fetch-Mode': 'navigate'
        }
    });
    const s = String(html);
    const pick = (...keys) => {
        for (const k of keys) {
            const m = s.match(new RegExp('"' + k + '"\\s*:\\s*"([^"]+)"'));
            if (m) return unescapeJson(m[1]);
        }
        return null;
    };
    const hd = pick('browser_native_hd_url', 'playable_url_quality_hd', 'hd_src');
    const sd = pick('browser_native_sd_url', 'playable_url', 'sd_src');
    const video = hd || sd;
    if (!video) throw new Error('Could not find the video. It may be private, or only visible to logged-in users.');
    const thumb = metaTag(s, 'og:image');
    return {
        engine: 'direct', platform: 'facebook', url, id: null,
        title: metaTag(s, 'og:title') || 'Facebook video', uploader: '', thumbnail: thumb, duration: null,
        media: [{ index: 0, type: 'video', url: video, sdUrl: sd, thumbnail: thumb, qualities: [] }]
    };
}

async function youtubeFallback(url) {
    // Only metadata (title + thumbnail) — the download itself needs yt-dlp
    const id = youtubeId(url);
    const { data } = await axios.get('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url), { timeout: 10000 });
    return {
        engine: 'none', platform: 'youtube', url, id,
        title: data.title || 'YouTube video', uploader: data.author_name || '',
        thumbnail: id ? 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' : data.thumbnail_url, duration: null, media: []
    };
}

const FALLBACKS = { x: xFallback, instagram: instagramFallback, facebook: facebookFallback, youtube: youtubeFallback };

// Friendly error text from yt-dlp messages
function friendlyError(msg, platform) {
    const m = String(msg || '');
    if (/confirm you.?re not a bot|Sign in to confirm/i.test(m)) return 'YouTube is temporarily blocking our server. Please try again in a few minutes.';
    if (/private/i.test(m)) return 'This content is private. Only public posts can be downloaded.';
    if (/login|log in|cookies|authentication|rate.?limit/i.test(m)) return 'This content needs a login or the platform is limiting requests. Please try again later.';
    if (/age/i.test(m) && platform === 'youtube') return 'This video is age-restricted and cannot be downloaded.';
    if (/not available|unavailable|removed|deleted|does not exist|404/i.test(m)) return 'This content is unavailable or was removed.';
    if (/Unsupported URL/i.test(m)) return 'This link type is not supported. Please paste a direct link to a video or post.';
    if (/no video|no media|There is no video/i.test(m)) return 'No video was found in this post.';
    return m.length && m.length < 200 ? m : 'Could not process this link. Make sure it is public and try again.';
}

// ---------- main entry ----------
const cache = new Map();
const CACHE_MS = 15 * 60 * 1000;

async function resolve(rawUrl) {
    const platform = detectPlatform(rawUrl);
    if (!platform) {
        const e = new Error('Please paste a valid YouTube, Instagram, Facebook or X (Twitter) link.');
        e.status = 400;
        throw e;
    }
    const url = await normalizeUrl(rawUrl, platform);
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.info;

    let info = null;
    let firstError = null;

    // X: the fxtwitter/vxtwitter APIs are fast and include photos, so try them first
    const order = platform === 'x' ? ['fallback', 'ytdlp'] : ['ytdlp', 'fallback'];
    for (const step of order) {
        try {
            if (step === 'ytdlp') info = fromYtDlp(await ytdlp.getInfo(url, platform), platform, url);
            else info = await FALLBACKS[platform](url);
            if (info && (info.media.length || info.engine === 'none')) break;
        } catch (e) {
            console.warn('[' + platform + '] ' + step + ' failed: ' + e.message);
            if (!firstError || step === 'ytdlp') firstError = e;
            info = null;
        }
    }
    if (!info) {
        const e = new Error(friendlyError(firstError && firstError.message, platform));
        e.status = 422;
        throw e;
    }
    if (info.engine === 'none') {
        // metadata only (YouTube blocked) — report the yt-dlp error but keep thumbnail/title
        info.error = friendlyError(firstError && firstError.message, platform);
    }
    cache.set(url, { at: Date.now(), info });
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return info;
}

module.exports = { resolve, detectPlatform, normalizeUrl, friendlyError, youtubeId, BROWSER_UA };
