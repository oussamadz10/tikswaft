const express = require('express');
const cors = require('cors');
const axios = require('axios');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

if (ffmpegInstaller.path) {
    ffmpeg.setFfmpegPath(ffmpegInstaller.path);
}

function cleanupFiles(files) {
    files.forEach(file => {
        if (fs.existsSync(file)) {
            try { fs.unlinkSync(file); } catch (e) { }
        }
    });
}

// 📱 1. مسار تحميل الفيديو بدون علامة مائية
app.get('/download-video', async (req, res) => {
    const { tiktokUrl } = req.query;
    if (!tiktokUrl) return res.status(400).send("URL is required");
    try {
        const response = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`);
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', 'attachment; filename="tikswaft_hd.mp4"');
        const videoStream = await axios({ method: 'get', url: response.data.data.play, responseType: 'stream' });
        videoStream.data.pipe(res);
    } catch (e) { if (!res.headersSent) res.status(500).send("Error"); }
});

// 📱 2. مسار قص الفيديو المباشر
app.get('/trim-video-direct', async (req, res) => {
    const { tiktokUrl, startTime, duration } = req.query;
    if (!tiktokUrl || !startTime || !duration) return res.status(400).send("Missing parameters");
    const uniqueId = Date.now();
    const inputPath = path.join(__dirname, `input_td_${uniqueId}.mp4`);
    try {
        const response = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`);
        const writer = fs.createWriteStream(inputPath);
        const videoStream = await axios({ method: 'get', url: response.data.data.play, responseType: 'stream' });
        videoStream.data.pipe(writer);
        await new Promise((resolve) => writer.on('finish', resolve));
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', 'attachment; filename="tikswaft_trimmed.mp4"');
        ffmpeg(inputPath).setStartTime(parseInt(startTime)).setDuration(parseInt(duration))
            .outputOptions(['-c:v copy', '-c:a copy', '-movflags frag_keyframe+empty_moov']).toFormat('mp4')
            .on('error', () => { cleanupFiles([inputPath]); if (!res.headersSent) res.status(500).send("Error"); })
            .on('end', () => { setTimeout(() => { cleanupFiles([inputPath]); }, 5000); })
            .pipe(res, { end: true });
    } catch (e) { cleanupFiles([inputPath]); if (!res.headersSent) res.status(500).send("Error"); }
});

// 📱 3. مسار كتم الفيديو المباشر
app.get('/mute-video-direct', async (req, res) => {
    const { tiktokUrl } = req.query;
    if (!tiktokUrl) return res.status(400).send("URL is required");
    const uniqueId = Date.now();
    const inputPath = path.join(__dirname, `input_md_${uniqueId}.mp4`);
    try {
        const response = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`);
        const writer = fs.createWriteStream(inputPath);
        const videoStream = await axios({ method: 'get', url: response.data.data.play, responseType: 'stream' });
        videoStream.data.pipe(writer);
        await new Promise((resolve) => writer.on('finish', resolve));
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', 'attachment; filename="tikswaft-muted.mp4"');
        ffmpeg(inputPath).outputOptions(['-an', '-c:v copy', '-movflags frag_keyframe+empty_moov']).toFormat('mp4')
            .on('error', () => { cleanupFiles([inputPath]); if (!res.headersSent) res.status(500).send("Error"); })
            .on('end', () => { setTimeout(() => { cleanupFiles([inputPath]); }, 5000); })
            .pipe(res, { end: true });
    } catch (e) { cleanupFiles([inputPath]); if (!res.headersSent) res.status(500).send("Error"); }
});

// 📱 4. مسار سحب الصوت المباشر
app.get('/audio-direct', async (req, res) => {
    const { tiktokUrl } = req.query;
    if (!tiktokUrl) return res.status(400).send("URL is required");
    try {
        const response = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`);
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', 'attachment; filename="tikswaft_audio.mp3"');
        const audioStream = await axios({ method: 'get', url: response.data.data.music, responseType: 'stream' });
        audioStream.data.pipe(res);
    } catch (e) { if (!res.headersSent) res.status(500).send("Error"); }
});

// 📱 5. مسار تحميل الصور الفردية المباشر
app.get('/image-direct', async (req, res) => {
    const { imageUrl, index } = req.query;
    if (!imageUrl) return res.status(400).send("Image URL is required");
    try {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Content-Disposition', `attachment; filename="tikswaft_img_${index || Date.now()}.jpg"`);
        const imgRes = await axios({ method: 'get', url: imageUrl, responseType: 'stream' });
        imgRes.data.pipe(res);
    } catch (error) { if (!res.headersSent) res.status(500).send("Error"); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 TikSwaft Server is running on port ${PORT}`);
});