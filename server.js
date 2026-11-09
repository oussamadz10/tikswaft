const express = require('express');
const cors = require('cors');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
app.set('trust proxy', 1);
app.use(cors({ exposedHeaders: ['Content-Disposition'] }));
app.use(express.json({ limit: '100kb' }));

if (ffmpegInstaller.path) ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Health check / wake-up ping (the website pings this when a page opens)
app.get('/', (req, res) => res.json({ success: true, service: 'TikSwaft API' }));
app.get('/healthz', (req, res) => res.send('ok'));

// TikTok — kept at the root (used by tikswaft.com and the Android app) and under /api/tiktok
const tiktokRouter = require('./router/tiktok');
app.use('/', tiktokRouter);
app.use('/api/tiktok', tiktokRouter);

// YouTube, Instagram, Facebook, X (Twitter)
const mediaRouter = require('./router/media');
app.use('/api/media', mediaRouter);

app.use((err, req, res, next) => {
    console.error(err);
    if (!res.headersSent) res.status(err.status || 500).json({ success: false, error: 'Server error' });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`TikSwaft server running on port ${PORT}`);
    // Make sure yt-dlp exists and is current (platform changes break old versions)
    require('./lib/ytdlp').selfUpdate();
});
server.requestTimeout = 0;      // long downloads/conversions
server.headersTimeout = 120000;
