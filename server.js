const express = require('express');
const cors = require('cors');
const axios = require('axios');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

ffmpeg.setFfmpegPath(ffmpegPath);

// دالة مساعدة لحذف الملفات المؤقتة لتنظيف الذاكرة دائماً
function cleanupFiles(files) {
    files.forEach(file => {
        if (fs.existsSync(file)) {
            try { fs.unlinkSync(file); } catch (e) { console.error("Error deleting file:", e.message); }
        }
    });
}

// ==========================================
// 1. مسار معالجة الفيديوهات العام (قص)
// ==========================================
app.post('/process-video', async (req, res) => {
    console.log("Request received for Video URL:", req.body.tiktokUrl);
    const { tiktokUrl, action, startTime, duration } = req.body;

    try {
        const response = await axios.get(`https://www.tikwm.com/api/?url=${tiktokUrl}`);

        if (!response.data || !response.data.data || !response.data.data.play) {
            throw new Error("لم يتم العثور على الفيديو، تأكد من الرابط.");
        }

        let videoLink = response.data.data.play;
        if (!videoLink.startsWith('http')) {
            videoLink = 'https://www.tikwm.com' + videoLink;
        }

        const videoStream = await axios({
            method: 'get',
            url: videoLink,
            responseType: 'stream',
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        let command = ffmpeg(videoStream.data);

        if (action === 'mute') {
            command.noAudio();
        } else if (action === 'trim') {
            command.outputOptions([
                `-ss ${startTime || '00:00:00'}`,
                `-t ${duration || 10}`
            ]);
        }

        res.header('Content-Disposition', 'attachment; filename="tiktok_processed.mp4"');

        command
            .toFormat('mp4')
            .outputOptions('-movflags frag_keyframe+empty_moov')
            .on('start', () => console.log('⏳ جاري معالجة الفيديو العام...'))
            .on('error', (err) => {
                console.error('❌ تفاصيل خطأ المحرك:', err.message);
                if (!res.headersSent) res.status(500).send("حدث خطأ أثناء المعالجة");
            })
            .pipe(res, { end: true });

    } catch (error) {
        console.error("❌ Server Error (Video):", error.message);
        if (!res.headersSent) res.status(500).send("Internal Server Error");
    }
});

// ==========================================
// 2. مسار تحميل الصور 📸
// ==========================================
app.post('/download-image', async (req, res) => {
    const { imageUrl, index } = req.body;

    try {
        const imageResponse = await axios({
            method: 'get',
            url: imageUrl,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/114.0.0.0 Safari/537.36',
                'Referer': 'https://www.tiktok.com/'
            }
        });

        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Content-Disposition', `attachment; filename="tikswaft_img_${index || Date.now()}.jpg"`);

        imageResponse.data.pipe(res);
    } catch (error) {
        console.error("❌ Image Download Error:", error.message);
        res.status(500).send("Failed to download image");
    }
});

// ==========================================
// 3. مسار استخراج وتحميل الصوت (MP3) 🎵
// ==========================================
app.post('/process-audio', async (req, res) => {
    const { tiktokUrl } = req.body;
    try {
        const response = await axios.get(`https://www.tikwm.com/api/?url=${tiktokUrl}`);
        const data = response.data.data;

        if (!data || !data.music) {
            return res.status(400).send("لم يتم العثور على صوت لهذا الرابط.");
        }

        let audioLink = data.music;
        console.log("✅ جاري معالجة الصوت من الرابط:", audioLink);

        const audioStream = await axios({
            method: 'get',
            url: audioLink,
            responseType: 'stream',
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', 'attachment; filename="tiktok_audio.mp3"');

        audioStream.data.pipe(res);

    } catch (error) {
        console.error("❌ خطأ في السيرفر:", error.message);
        res.status(500).send("فشل في تحميل الصوت.");
    }
});

// ==========================================
// 4. أداة كتم الصوت الاحترافية (حل مشكلة الـ Stream Closed) 🛠️
// ==========================================
app.post('/mute-video', async (req, res) => {
    const { tiktokUrl } = req.body;
    if (!tiktokUrl) return res.status(400).send("URL is required");

    const inputPath = path.join(__dirname, `input_${Date.now()}.mp4`);
    const outputPath = path.join(__dirname, `output_${Date.now()}.mp4`);

    try {
        console.log("⏳ 1. جلب رابط الفيديو من تيك توك...");
        const response = await axios.get(`https://www.tikwm.com/api/?url=${tiktokUrl}`);
        const videoUrl = response.data.data.play;
        if (!videoUrl) return res.status(400).send("Video not found");

        console.log("⏳ 2. حفظ الفيديو مؤقتاً في السيرفر لحماية الذاكرة...");
        const writer = fs.createWriteStream(inputPath);
        const videoStream = await axios({ method: 'get', url: videoUrl, responseType: 'stream' });
        videoStream.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        console.log("⏳ 3. بدء عملية كتم الصوت عبر FFmpeg...");
        ffmpeg(inputPath)
            .outputOptions('-an')
            .format('mp4')
            .on('start', () => console.log('🎬 جاري معالجة كتم الصوت...'))
            .on('error', (err) => {
                console.error('❌ خطأ FFmpeg:', err.message);
                cleanupFiles([inputPath, outputPath]);
                if (!res.headersSent) res.status(500).send("Error processing video");
            })
            .on('end', () => {
                console.log('✅ انتهت المعالجة! جاري بدء التنزيل للمستخدم...');
                res.download(outputPath, 'tikswaft-muted.mp4', (err) => {
                    cleanupFiles([inputPath, outputPath]);
                });
            })
            .save(outputPath);

    } catch (error) {
        console.error("❌ خطأ عام في الكتم:", error.message);
        cleanupFiles([inputPath, outputPath]);
        if (!res.headersSent) res.status(500).send("Server Error");
    }
});

// إعداد منفذ خادم الويب
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 TikSwaft Server is running on port ${PORT}`);
});