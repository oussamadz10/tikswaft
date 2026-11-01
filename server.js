const express = require('express');
const cors = require('cors');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ضبط مسار FFmpeg ليعمل على Render بدون أخطاء
if (ffmpegInstaller.path) {
    ffmpeg.setFfmpegPath(ffmpegInstaller.path);
}

// 🔗 1. ربط مسارات تيك توك وإنستغرام (من الملف المعزول الذي أنشأناه)
const tiktokRouter = require('./router/tiktok');
app.use('/api/tiktok', tiktokRouter);

// 🔗 2. ربط مسارات يوتيوب الجديدة (YouSwaft) - هنا ستطور وتجرب محلياً بحرية مطلقة!
const youtubeRouter = require('./router/youtube');
app.use('/api/youtube', youtubeRouter);

// ⚙️ تشغيل السيرفر الرئيسي
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 TikSwaft Master Server is running on port ${PORT}`);
});