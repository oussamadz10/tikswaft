const express = require('express');
const router = express.Router();
const YTDLP = require('yt-dlp-wrap').default;
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');

const ytDlp = new YTDLP();

function cleanupFiles(files) {
    files.forEach(file => {
        if (fs.existsSync(file)) {
            try { fs.unlinkSync(file); } catch (e) { console.error("Error deleting file:", e.message); }
        }
    });
}

// مسار اختباري
router.get('/test', (req, res) => {
    res.json({ success: true, message: "YouSwaft YouTube router is working perfectly!" });
});

// مسار جلب معلومات الفيديو والـ Shorts
router.post('/download', async (req, res) => {
    const { youtubeUrl } = req.body;
    if (!youtubeUrl) return res.status(400).json({ error: "رابط يوتيوب مطلوب" });

    try {
        const metadata = await ytDlp.getVideoInfo([youtubeUrl, '--dump-json', '--no-playlist']);
        const videoData = JSON.parse(metadata);

        res.json({
            success: true,
            title: videoData.title,
            duration: videoData.duration,
            thumbnail: videoData.thumbnail,
            videoUrl: videoData.url || (videoData.formats && videoData.formats.pop().url)
        });
    } catch (error) {
        console.error("❌ خطأ يوتيوب:", error.message);
        res.status(500).json({ error: "فشل في معالجة رابط يوتيوب" });
    }
});

// مسار حذف الصوت (Mute Video) متوافق مع الواجهة
router.post('/mute', async (req, res) => {
    const { youtubeUrl } = req.body;
    if (!youtubeUrl) return res.status(400).json({ error: "رابط يوتيوب مطلوب" });

    const uniqueId = Date.now();
    const inputPath = path.join(__dirname, `../input_yt_${uniqueId}.mp4`);
    const outputPath = path.join(__dirname, `../output_yt_muted_${uniqueId}.mp4`);

    try {
        await ytDlp.execPromise([youtubeUrl, '-f', 'b[ext=mp4]/best[ext=mp4]/best', '-o', inputPath]);

        ffmpeg(inputPath)
            .outputOptions(['-an', '-c:v copy'])
            .on('error', (err) => {
                cleanupFiles([inputPath, outputPath]);
                if (!res.headersSent) res.status(500).send("خطأ في معالجة الفيديو");
            })
            .on('end', () => {
                res.download(outputPath, 'youSwaft_muted.mp4', () => {
                    cleanupFiles([inputPath, outputPath]);
                });
            })
            .save(outputPath);
    } catch (error) {
        cleanupFiles([inputPath, outputPath]);
        if (!res.headersSent) res.status(500).send("فشل في تحميل أو معالجة الفيديو");
    }
});

module.exports = router;