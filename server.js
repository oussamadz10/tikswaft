const express = require('express');
const cors = require('cors');
const axios = require('axios');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg = require('fluent-ffmpeg');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

ffmpeg.setFfmpegPath(ffmpegPath);

// ==========================================
// 1. مسار معالجة الفيديوهات (كتم وقص)
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
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/114.0.0.0 Safari/537.36' }
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
            .on('start', () => console.log('⏳ جاري معالجة الفيديو...'))
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
// 2. مسار جلب الصور الجديد 📸
// ==========================================
app.post('/process-images', async (req, res) => {
    console.log("Request received for Image URL:", req.body.tiktokUrl);

    const { tiktokUrl } = req.body;

    try {
        const response = await axios.get(`https://www.tikwm.com/api/?url=${tiktokUrl}`);
        const data = response.data.data;

        if (!data || !data.images || data.images.length === 0) {
            return res.status(400).json({ error: "هذا الرابط لا يحتوي على صور، يبدو أنه فيديو عادي." });
        }

        console.log(`✅ تم جلب ${data.images.length} صور من الرابط.`);
        res.json({ images: data.images });

    } catch (error) {
        console.error("❌ Server Error (Images):", error.message);
        res.status(500).json({ error: "حدث خطأ في السيرفر أثناء جلب الصور." });
    }
});
// ==========================================
// 3. مسار إجبار المتصفح على تحميل الصورة
// ==========================================
app.post('/download-image', async (req, res) => {
    const { imageUrl, index } = req.body;

    try {
        // جلب الصورة كبث مباشر (Stream)
        const imageStream = await axios({
            method: 'get',
            url: imageUrl,
            responseType: 'stream'
        });

        // إخبار المتصفح بأن هذا ملف يجب تحميله وليس عرضه
        res.header('Content-Disposition', `attachment; filename="tiktok_image_${index}.jpg"`);

        // ضخ الصورة للمتصفح
        imageStream.data.pipe(res);
    } catch (error) {
        console.error("❌ Error downloading image:", error.message);
        res.status(500).send("حدث خطأ أثناء تحميل الصورة");
    }
});
// ==========================================
// 4. مسار استخراج وتحميل الصوت (MP3) 🎵
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

        // إعدادات إجبار التحميل كـ MP3
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', 'attachment; filename="tiktok_audio.mp3"');

        audioStream.data.pipe(res);

    } catch (error) {
        console.error("❌ خطأ في السيرفر:", error.message);
        res.status(500).send("فشل في تحميل الصوت.");
    }
});
// تشغيل السيرفر
app.listen(3000, () => console.log('🚀 Super Server running on http://localhost:3000'));