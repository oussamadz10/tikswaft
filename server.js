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

// 🚀 التصحيح الذهبي لـ FFmpeg: ربط المسار التلقائي ليعمل على Render بدون أخطاء
if (ffmpegInstaller.path) {
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

// ==========================================================================
// 💻 [بوابة موقع الويب - Netlify] - مسارات الـ POST القديمة (آمنة ومحمية)
// ==========================================================================

app.post('/process-video', async (req, res) => {
    const { tiktokUrl, action, startTime, duration } = req.body;
    if (!tiktokUrl) return res.status(400).send("URL is required");

    const uniqueId = Date.now();
    const inputPath = path.join(__dirname, `input_post_${uniqueId}.mp4`);
    const outputPath = path.join(__dirname, `output_post_${uniqueId}.mp4`);

    try {
        const response = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`);
        if (!response.data || !response.data.data || !response.data.data.play) return res.status(400).send("Video not found");

        const videoUrl = response.data.data.play;
        const writer = fs.createWriteStream(inputPath);
        const videoStream = await axios({ method: 'get', url: videoUrl, responseType: 'stream' });
        videoStream.data.pipe(writer);
        await new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject); });

        let ffCommand = ffmpeg(inputPath);

        if (action === 'mute') {
            ffCommand.outputOptions(['-an', '-c:v copy']);
        } else if (action === 'trim') {
            ffCommand.setStartTime(parseInt(startTime)).setDuration(parseInt(duration)).outputOptions(['-c:v copy', '-c:a copy']);
        }

        ffCommand.on('error', (err) => { cleanupFiles([inputPath, outputPath]); res.status(500).send("FFmpeg Error"); })
            .on('end', () => { res.download(outputPath, 'tikswaft_processed.mp4', () => cleanupFiles([inputPath, outputPath])); })
            .save(outputPath);

    } catch (error) {
        cleanupFiles([inputPath, outputPath]);
        res.status(500).send("Server Error");
    }
});

app.post('/mute-video', async (req, res) => {
    const { tiktokUrl } = req.body;
    const inputPath = path.join(__dirname, `input_m_${Date.now()}.mp4`);
    const outputPath = path.join(__dirname, `output_m_${Date.now()}.mp4`);
    try {
        const response = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`);
        const writer = fs.createWriteStream(inputPath);
        await axios({ method: 'get', url: response.data.data.play, responseType: 'stream' }).then(r => r.data.pipe(writer));
        await new Promise((resolve) => writer.on('finish', resolve));

        ffmpeg(inputPath).outputOptions(['-an', '-c:v copy']).on('error', () => { cleanupFiles([inputPath, outputPath]); res.status(500).send("Error"); })
            .on('end', () => { res.download(outputPath, 'tikswaft-muted.mp4', () => cleanupFiles([inputPath, outputPath])); }).save(outputPath);
    } catch (e) { cleanupFiles([inputPath, outputPath]); res.status(500).send("Error"); }
});

app.post('/process-audio', async (req, res) => {
    const { tiktokUrl } = req.body;
    try {
        const response = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`);
        const audioStream = await axios({ method: 'get', url: response.data.data.music, responseType: 'stream' });
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', 'attachment; filename="tiktok_audio.mp3"');
        audioStream.data.pipe(res);
    } catch (e) { res.status(500).send("Error"); }
});

app.post('/download-image', async (req, res) => {
    const { imageUrl, index } = req.body;
    try {
        const imgRes = await axios({ method: 'get', url: imageUrl, responseType: 'stream' });
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Content-Disposition', `attachment; filename="tikswaft_img_${index}.jpg"`);
        imgRes.data.pipe(res);
    } catch (e) { res.status(500).send("Error"); }
});
const instagramGetUrl = require('instagram-url-direct');

app.post('/instagram-download', async (req, res) => {
    const { instagramUrl } = req.body;
    if (!instagramUrl) return res.status(400).json({ error: "Link required" });

    try {
        // المكتبة تقوم بفك وحل الرابط مباشرة من خوادم إنستغرام عبر سيرفرك
        let links = await instagramGetUrl(instagramUrl);

        // التحقق من وجود روابط ميديا مستخرجة
        if (links && links.url_list && links.url_list.length > 0) {
            const directVideoUrl = links.url_list[0]; // الرابط المباشر لملف الـ MP4

            res.json({ videoUrl: directVideoUrl });
        } else {
            throw new Error("No media found on this link");
        }
    } catch (error) {
        console.error("Backend Instagram Error:", error);
        res.status(500).json({ error: "Failed to process Instagram link directly" });
    }
});


// ==========================================================================
// 📱 [بوابة تطبيق الهاتف - Android] - مسارات الـ GET المباشرة المستقلة 🚀
// ==========================================================================

// ==========================================================================
// 📱 [بوابة تطبيق الهاتف] - مسار جلب وتحميل الفيديو الأصلي بدون علامة مائية (GET)
// ==========================================================================
app.get('/download-video', async (req, res) => {
    const { tiktokUrl } = req.query;

    // التأكد من إرسال الرابط من الهاتف
    if (!tiktokUrl) {
        return res.status(400).send("URL is required");
    }

    try {
        console.log("⏳ جاري الاتصال بـ API وجلب رابط الفيديو النظيف...");

        // جلب البيانات من السيرفر الوسيط لفك العلامة المائية
        const response = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`);

        // التحقق من أن الرابط سليم ويحتوي على فيديو
        if (!response.data || !response.data.data || !response.data.data.play) {
            return res.status(400).send("Video not found or link is invalid");
        }

        const cleanVideoUrl = response.data.data.play;

        // 🚨 الهيدرات السحرية التي تجعل مدير تحميلات أندرويد يصطاد الملف ويحفظه فوراً
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', 'attachment; filename="tikswaft_hd.mp4"');

        // سحب بايتات الفيديو وضخها مباشرة (Pipe) إلى جهاز المستخدم
        const videoStream = await axios({
            method: 'get',
            url: cleanVideoUrl,
            responseType: 'stream'
        });

        videoStream.data.pipe(res);

    } catch (error) {
        console.error("❌ خطأ في سيرفر تحميل الفيديو للهاتف:", error.message);
        if (!res.headersSent) {
            res.status(500).send("Error fetching video");
        }
    }
});

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
// ==========================================================================
// 📱 [بوابة تطبيق الهاتف] - مسار تحميل الصور الفردية المباشر (GET)
// ==========================================================================
app.get('/image-direct', async (req, res) => {
    const { imageUrl, index } = req.query;
    if (!imageUrl) return res.status(400).send("Image URL is required");

    try {
        console.log(`⏳ جاري جلب الصورة رقم ${index || 1}...`);

        // ضبط هيدرات التحميل المباشر ليفهمها الأندرويد ويحملها فورا
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Content-Disposition', `attachment; filename="tikswaft_img_${index || Date.now()}.jpg"`);

        // سحب الصورة وضخها مباشرة (Stream) كملف تحميل
        const imgRes = await axios({ method: 'get', url: imageUrl, responseType: 'stream' });
        imgRes.data.pipe(res);

    } catch (error) {
        console.error("❌ خطأ في سيرفر تحميل الصور:", error.message);
        if (!res.headersSent) res.status(500).send("Error fetching image");
    }
});
// ==========================================
// ⚙️ ختام الملف وتشغيل الخادم الشامل
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 TikSwaft Server is running on port ${PORT}`);
});