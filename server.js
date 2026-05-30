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

// ضبط محرك FFmpeg (تلقائي بين Render والكمبيوتر المحلي)
if (process.env.FFMPEG_PATH) {
    ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
} else if (ffmpegInstaller.path) {
    ffmpeg.setFfmpegPath(ffmpegInstaller.path);
}

// دالة مساعدة لحذف الملفات المؤقتة من السيرفر
function cleanupFiles(files) {
    files.forEach(file => {
        if (fs.existsSync(file)) {
            try { fs.unlinkSync(file); } catch (e) { console.error("Error deleting file:", e.message); }
        }
    });
}

// ==========================================================================
// 💻 [بوابة موقع الويب - Netlify] - مسارات الـ POST القديمة (آمنة ومحمية 100%)
// ==========================================================================

app.post('/download-video', async (req, res) => {
    const { tiktokUrl } = req.body;
    try {
        const response = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`);
        const videoResponse = await axios({ method: 'get', url: response.data.data.play, responseType: 'stream', headers: { 'User-Agent': 'Mozilla/5.0' } });
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="tikswaft_${Date.now()}.mp4"`);
        videoResponse.data.pipe(res);
    } catch (error) {
        res.status(500).send("فشل في تحميل الفيديو");
    }
});

app.post('/mute-video', async (req, res) => {
    const { tiktokUrl } = req.body;
    const inputPath = path.join(__dirname, `input_${Date.now()}.mp4`);
    const outputPath = path.join(__dirname, `output_${Date.now()}.mp4`);
    try {
        const response = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`);
        const videoUrl = response.data.data.play;
        const writer = fs.createWriteStream(inputPath);
        const videoStream = await axios({ method: 'get', url: videoUrl, responseType: 'stream' });
        videoStream.data.pipe(writer);
        await new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject); });

        ffmpeg(inputPath).outputOptions(['-an', '-c:v copy']).on('error', (err) => { cleanupFiles([inputPath, outputPath]); res.status(500).send("Error"); })
            .on('end', () => { res.download(outputPath, 'tikswaft-muted.mp4', () => cleanupFiles([inputPath, outputPath])); }).save(outputPath);
    } catch (error) {
        cleanupFiles([inputPath, outputPath]);
        res.status(500).send("Server Error");
    }
});

app.post('/trim-video', async (req, res) => {
    const { tiktokUrl, startTime, duration } = req.body;
    const inputPath = path.join(__dirname, `input_${Date.now()}.mp4`);
    const outputPath = path.join(__dirname, `output_${Date.now()}.mp4`);
    try {
        const response = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`);
        const videoUrl = response.data.data.play;
        const writer = fs.createWriteStream(inputPath);
        const videoStream = await axios({ method: 'get', url: videoUrl, responseType: 'stream' });
        videoStream.data.pipe(writer);
        await new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject); });

        ffmpeg(inputPath)
            .setStartTime(parseInt(startTime))
            .setDuration(parseInt(duration))
            .outputOptions(['-c:v copy', '-c:a copy'])
            .on('error', (err) => { cleanupFiles([inputPath, outputPath]); res.status(500).send("Error"); })
            .on('end', () => { res.download(outputPath, 'tikswaft-trimmed.mp4', () => cleanupFiles([inputPath, outputPath])); })
            .save(outputPath);
    } catch (error) {
        cleanupFiles([inputPath, outputPath]);
        res.status(500).send("Server Error");
    }
});

app.post('/process-audio', async (req, res) => {
    const { tiktokUrl } = req.body;
    try {
        const response = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`);
        const audioStream = await axios({ method: 'get', url: response.data.data.music, responseType: 'stream' });
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', 'attachment; filename="tiktok_audio.mp3"');
        audioStream.data.pipe(res);
    } catch (error) {
        res.status(500).send("فشل في تحميل الصوت.");
    }
});

app.post('/download-image', async (req, res) => {
    const { imageUrl, index } = req.body;
    try {
        const imageResponse = await axios({ method: 'get', url: imageUrl, responseType: 'stream', headers: { 'User-Agent': 'Mozilla/5.0' } });
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Content-Disposition', `attachment; filename="tikswaft_img_${index}.jpg"`);
        imageResponse.data.pipe(res);
    } catch (error) {
        res.status(500).send("Failed to download image");
    }
});

// ==========================================================================
// 📱 [بوابة تطبيق الهاتف - Android] - مسارات الـ GET المباشرة المستقلة
// ==========================================================================

app.get('/mute-video-direct', async (req, res) => {
    const { tiktokUrl } = req.query;
    if (!tiktokUrl) return res.status(400).send("URL is required");

    const uniqueId = Date.now();
    const inputPath = path.join(__dirname, `input_direct_${uniqueId}.mp4`);
    const outputPath = path.join(__dirname, `output_direct_${uniqueId}.mp4`);

    try {
        const response = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`);
        if (!response.data || !response.data.data || !response.data.data.play) return res.status(400).send("Video not found");

        const videoUrl = response.data.data.play;
        const writer = fs.createWriteStream(inputPath);
        const videoStream = await axios({ method: 'get', url: videoUrl, responseType: 'stream' });
        videoStream.data.pipe(writer);
        await new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject); });

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', 'attachment; filename="tikswaft-muted.mp4"');

        ffmpeg(inputPath)
            .outputOptions(['-an', '-c:v copy', '-movflags frag_keyframe+empty_moov'])
            .toFormat('mp4')
            .on('error', (err) => { cleanupFiles([inputPath, outputPath]); if (!res.headersSent) res.status(500).send("Error"); })
            .on('end', () => { setTimeout(() => { cleanupFiles([inputPath, outputPath]); }, 5000); })
            .pipe(res, { end: true });
    } catch (error) {
        cleanupFiles([inputPath, outputPath]);
        if (!res.headersSent) res.status(500).send("Server Error");
    }
});

app.get('/audio-direct', async (req, res) => {
    const { tiktokUrl } = req.query;
    if (!tiktokUrl) return res.status(400).send("URL is required");
    try {
        const response = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`);
        if (!response.data.data || !response.data.data.music) return res.status(400).send("Audio not found");

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', 'attachment; filename="tikswaft_audio.mp3"');

        const audioStream = await axios({ method: 'get', url: response.data.data.music, responseType: 'stream' });
        audioStream.data.pipe(res);
    } catch (error) {
        if (!res.headersSent) res.status(500).send("Error fetching audio");
    }
});
// ==========================================================================
// 📱 [بوابة تطبيق الهاتف] - مسار تحميل الفيديو الأصلي بدون علامة مائية
// ==========================================================================
app.get('/video-direct', async (req, res) => {
    const { tiktokUrl } = req.query;
    if (!tiktokUrl) return res.status(400).send("URL is required");

    try {
        console.log("⏳ جلب رابط الفيديو بدون علامة مائية...");
        const response = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`);

        if (!response.data || !response.data.data || !response.data.data.play) {
            return res.status(400).send("Video not found");
        }

        const cleanVideoUrl = response.data.data.play;

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', 'attachment; filename="tikswaft_hd.mp4"');

        const videoStream = await axios({ method: 'get', url: cleanVideoUrl, responseType: 'stream' });
        videoStream.data.pipe(res);

    } catch (error) {
        console.error("❌ خطأ في سيرفر الفيديو النظيف:", error.message);
        if (!res.headersSent) res.status(500).send("Error fetching video");
    }
});

// ==========================================================================
// 📱 [بوابة تطبيق الهاتف] - مسار قص الفيديو المباشر (Trim GET Stream)
// ==========================================================================
app.get('/trim-video-direct', async (req, res) => {
    const { tiktokUrl, startTime, duration } = req.query;
    if (!tiktokUrl || !startTime || !duration) return res.status(400).send("Missing parameters");

    const uniqueId = Date.now();
    const inputPath = path.join(__dirname, `input_trim_${uniqueId}.mp4`);
    const outputPath = path.join(__dirname, `output_trim_${uniqueId}.mp4`);

    try {
        const response = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`);
        if (!response.data || !response.data.data || !response.data.data.play) return res.status(400).send("Video not found");

        const videoUrl = response.data.data.play;
        const writer = fs.createWriteStream(inputPath);
        const videoStream = await axios({ method: 'get', url: videoUrl, responseType: 'stream' });
        videoStream.data.pipe(writer);
        await new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject); });

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', 'attachment; filename="tikswaft_trimmed.mp4"');

        ffmpeg(inputPath)
            .setStartTime(parseInt(startTime))
            .setDuration(parseInt(duration))
            .outputOptions(['-c:v copy', '-c:a copy', '-movflags frag_keyframe+empty_moov'])
            .toFormat('mp4')
            .on('error', (err) => { cleanupFiles([inputPath, outputPath]); if (!res.headersSent) res.status(500).send("Trim Error"); })
            .on('end', () => { setTimeout(() => { cleanupFiles([inputPath, outputPath]); }, 5000); })
            .pipe(res, { end: true });
    } catch (error) {
        cleanupFiles([inputPath, outputPath]);
        if (!res.headersSent) res.status(500).send("Server Error");
    }
});
// ==========================================
// ⚙️ تشغيل خادم الويب
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 TikSwaft Server is running on port ${PORT}`);
});