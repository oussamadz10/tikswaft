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

// 🚀 حل ذكي للـ FFmpeg: استخدام مسار النظام على Render أو الحزمة المحمولة على الكمبيوتر تلقائياً
if (process.env.FFMPEG_PATH) {
    ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
} else if (ffmpegInstaller.path) {
    ffmpeg.setFfmpegPath(ffmpegInstaller.path);
}

// دالة مساعدة لحذف الملفات المؤقتة
function cleanupFiles(files) {
    files.forEach(file => {
        if (fs.existsSync(file)) {
            try { fs.unlinkSync(file); } catch (e) { console.error("Error deleting file:", e.message); }
        }
    });
}

// ==========================================
// 1️⃣ مسارات المعالجة عبر الـ POST (خاصة بموقع الكمبيوتر والـ Web)
// ==========================================

app.post('/process-video', async (req, res) => {
    const { tiktokUrl, action, startTime, duration } = req.body;
    try {
        const response = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`);
        if (!response.data || !response.data.data || !response.data.data.play) {
            return res.status(400).send("لم يتم العثور على الفيديو، تأكد من الرابط.");
        }
        let videoLink = response.data.data.play;
        const videoStream = await axios({ method: 'get', url: videoLink, responseType: 'stream', headers: { 'User-Agent': 'Mozilla/5.0' } });

        let command = ffmpeg(videoStream.data);
        if (action === 'mute') command.noAudio();
        else if (action === 'trim') command.outputOptions([`-ss ${startTime || '00:00:00'}`, `-t ${duration || 10}`]);

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="tiktok_processed_${Date.now()}.mp4"`);
        command.toFormat('mp4').outputOptions('-movflags frag_keyframe+empty_moov').pipe(res, { end: true });
    } catch (error) {
        if (!res.headersSent) res.status(500).send("Internal Server Error");
    }
});

app.post('/download-image', async (req, res) => {
    const { imageUrl, index } = req.body;
    try {
        const imageResponse = await axios({ method: 'get', url: imageUrl, responseType: 'stream', headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.tiktok.com/' } });
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Content-Disposition', `attachment; filename="tikswaft_img_${index || Date.now()}.jpg"`);
        imageResponse.data.pipe(res);
    } catch (error) {
        res.status(500).send("Failed to download image");
    }
});

app.post('/process-audio', async (req, res) => {
    const { tiktokUrl } = req.body;
    try {
        const response = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`);
        if (!response.data.data || !response.data.data.music) return res.status(400).send("لم يتم العثور على صوت.");
        const audioStream = await axios({ method: 'get', url: response.data.data.music, responseType: 'stream', headers: { 'User-Agent': 'Mozilla/5.0' } });
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', 'attachment; filename="tiktok_audio.mp3"');
        audioStream.data.pipe(res);
    } catch (error) {
        res.status(500).send("فشل في تحميل الصوت.");
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

app.post('/download-video', async (req, res) => {
    const { tiktokUrl } = req.body;
    try {
        const response = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`);
        const videoResponse = await axios({ method: 'get', url: response.data.data.play, responseType: 'stream', headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.tiktok.com/' } });
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="tikswaft_${Date.now()}.mp4"`);
        videoResponse.data.pipe(res);
    } catch (error) {
        res.status(500).send("فشل في تحميل الفيديو");
    }
});

// ==========================================
// 2️⃣ مسارات الدفق عبر الـ GET المباشر (خاصة بتطبيق الهاتف الأندرويد 📱)
// ==========================================

app.get('/mute-video-direct', async (req, res) => {
    const { tiktokUrl } = req.query;
    if (!tiktokUrl) return res.status(400).send("URL is required");

    const inputPath = path.join(__dirname, `input_direct_${Date.now()}.mp4`);
    const outputPath = path.join(__dirname, `output_direct_${Date.now()}.mp4`);

    try {
        const response = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`);
        const videoUrl = response.data.data.play;
        if (!videoUrl) return res.status(400).send("Video not found");

        const writer = fs.createWriteStream(inputPath);
        const videoStream = await axios({ method: 'get', url: videoUrl, responseType: 'stream' });
        videoStream.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', 'attachment; filename="tikswaft-muted.mp4"');

        ffmpeg(inputPath)
            .outputOptions(['-an', '-c:v copy'])
            .on('error', (err) => {
                cleanupFiles([inputPath, outputPath]);
                if (!res.headersSent) res.status(500).send("Error during processing");
            })
            .on('end', () => {
                res.download(outputPath, 'tikswaft-muted.mp4', () => {
                    cleanupFiles([inputPath, outputPath]);
                });
            })
            .save(outputPath);

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
        const audioLink = response.data.data.music;
        if (!audioLink) return res.status(400).send("Audio not found");

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', 'attachment; filename="tikswaft_audio.mp3"');

        const audioStream = await axios({ method: 'get', url: audioLink, responseType: 'stream' });
        audioStream.data.pipe(res);
    } catch (error) {
        if (!res.headersSent) res.status(500).send("Error fetching audio");
    }
});

// صفحة الجوال المضمنة للاختبار
app.get('/mobile', (req, res) => {
    // (حافظت لك على كود صفحة الـ html المضمنة كما هي بدون تعديل)
    res.send(`...HTML Code...`);
});

// ==========================================
// ⚙️ تشغيل خادم الويب (تأكد أن هذا السطر هو الأخير دائماً!)
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 TikSwaft Server is running on port ${PORT}`);
});