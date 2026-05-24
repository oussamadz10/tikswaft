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

// دالة مساعدة لحذف الملفات المؤقتة
function cleanupFiles(files) {
    files.forEach(file => {
        if (fs.existsSync(file)) {
            try { fs.unlinkSync(file); } catch (e) { console.error("Error deleting file:", e.message); }
        }
    });
}

// ==========================================
// 1. مسار معالجة الفيديوهات العام (قص) - متوافق مع الهواتف
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

        const fileName = `tiktok_processed_${Date.now()}.mp4`;
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Accept-Ranges', 'bytes');

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
// 4. أداة كتم الصوت الاحترافية - متوافقة مع الهواتف
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

        console.log("⏳ 2. حفظ الفيديو مؤقتاً في السيرفر...");
        const writer = fs.createWriteStream(inputPath);
        const videoStream = await axios({ method: 'get', url: videoUrl, responseType: 'stream' });
        videoStream.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        console.log("⏳ 3. بدء عملية كتم الصوت الصاروخية عبر Stream Copy...");
        ffmpeg(inputPath)
            .outputOptions([
                '-an',          // إلغاء الصوت تماماً
                '-c:v copy'     // نسخ وسم الفيديو الأصلي مباشرة بدون إعادة ترميز لتوفير الوقت
            ])
            .on('start', () => console.log('🎬 جاري معالجة كتم الصوت الفوري...'))
            .on('error', (err) => {
                console.error('❌ خطأ FFmpeg:', err.message);
                cleanupFiles([inputPath, outputPath]);
                if (!res.headersSent) res.status(500).send("Error processing video");
            })
            .on('end', () => {
                console.log('✅ انتهت المعالجة في لحظات! جاري بدء التنزيل للمستخدم...');
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

// ==========================================
// 5. مسار جديد للتحميل المباشر (بدون معالجة) - أفضل للهواتف
// ==========================================
app.post('/download-video', async (req, res) => {
    const { tiktokUrl } = req.body;

    try {
        console.log("⏳ تحميل مباشر للفيديو...");
        const response = await axios.get(`https://www.tikwm.com/api/?url=${tiktokUrl}`);

        if (!response.data || !response.data.data || !response.data.data.play) {
            throw new Error("لم يتم العثور على الفيديو");
        }

        let videoLink = response.data.data.play;
        if (!videoLink.startsWith('http')) {
            videoLink = 'https://www.tikwm.com' + videoLink;
        }

        const videoResponse = await axios({
            method: 'get',
            url: videoLink,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Referer': 'https://www.tiktok.com/'
            }
        });

        const fileName = `tikswaft_${Date.now()}.mp4`;
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Accept-Ranges', 'bytes');

        videoResponse.data.pipe(res);

    } catch (error) {
        console.error("❌ خطأ في التحميل:", error.message);
        res.status(500).send("فشل في تحميل الفيديو");
    }
});

// ==========================================
// 6. صفحة بسيطة للهواتف (مضمنة في الكود)
// ==========================================
app.get('/mobile', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>TikSwaft - تحميل فيديوهات تيك توك</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    font-family: Arial, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                    padding: 20px;
                }
                .container {
                    max-width: 500px;
                    margin: 0 auto;
                    background: white;
                    border-radius: 20px;
                    padding: 30px 20px;
                    box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                }
                h1 { text-align: center; color: #667eea; margin-bottom: 10px; }
                p { text-align: center; color: #666; margin-bottom: 30px; }
                input {
                    width: 100%;
                    padding: 15px;
                    border: 2px solid #e0e0e0;
                    border-radius: 10px;
                    font-size: 16px;
                    margin-bottom: 20px;
                }
                button {
                    width: 100%;
                    padding: 15px;
                    margin-bottom: 10px;
                    border: none;
                    border-radius: 10px;
                    font-size: 16px;
                    font-weight: bold;
                    cursor: pointer;
                    transition: transform 0.2s;
                    color: white;
                }
                button:active { transform: scale(0.98); }
                .btn-primary { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
                .btn-secondary { background: #48bb78; }
                .btn-audio { background: #4299e1; }
                .loading {
                    display: none;
                    text-align: center;
                    padding: 20px;
                }
                .spinner {
                    width: 40px;
                    height: 40px;
                    border: 4px solid #f3f3f3;
                    border-top: 4px solid #667eea;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                    margin: 0 auto;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                .message {
                    padding: 15px;
                    border-radius: 10px;
                    margin-top: 20px;
                    display: none;
                }
                .message.success { background: #d4edda; color: #155724; display: block; }
                .message.error { background: #f8d7da; color: #721c24; display: block; }
                .info {
                    text-align: center;
                    margin-top: 20px;
                    font-size: 12px;
                    color: #999;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🎵 TikSwaft</h1>
                <p>تحميل فيديوهات تيك توك</p>
                <input type="text" id="url" placeholder="أدخل رابط تيك توك هنا...">
                <button class="btn-primary" onclick="downloadVideo()">📥 تحميل فيديو</button>
                <button class="btn-secondary" onclick="downloadMuted()">🔇 تحميل بدون صوت</button>
                <button class="btn-audio" onclick="downloadAudio()">🎵 تحميل الصوت فقط</button>
                <div class="loading" id="loading">
                    <div class="spinner"></div>
                    <p>جاري التحميل...</p>
                </div>
                <div class="message" id="message"></div>
                <div class="info">💡 اضغط مع الاستمرار على زر التحميل ثم اختر "حفظ الرابط"</div>
            </div>

            <script>
                async function downloadVideo() {
                    const url = document.getElementById('url').value;
                    if (!url) {
                        showMessage('الرجاء إدخال رابط تيك توك', 'error');
                        return;
                    }
                    showLoading(true);
                    try {
                        const response = await fetch('/download-video', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ tiktokUrl: url })
                        });
                        if (!response.ok) throw new Error('فشل التحميل');
                        const blob = await response.blob();
                        const downloadUrl = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = downloadUrl;
                        a.download = 'tikswaft_video.mp4';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        window.URL.revokeObjectURL(downloadUrl);
                        showMessage('✅ تم التحميل بنجاح!', 'success');
                    } catch (error) {
                        showMessage('❌ فشل التحميل: ' + error.message, 'error');
                    } finally {
                        showLoading(false);
                    }
                }

                async function downloadMuted() {
                    const url = document.getElementById('url').value;
                    if (!url) {
                        showMessage('الرجاء إدخال رابط تيك توك', 'error');
                        return;
                    }
                    showLoading(true);
                    try {
                        const response = await fetch('/mute-video', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ tiktokUrl: url })
                        });
                        if (!response.ok) throw new Error('فشل التحميل');
                        const blob = await response.blob();
                        const downloadUrl = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = downloadUrl;
                        a.download = 'tikswaft_muted.mp4';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        window.URL.revokeObjectURL(downloadUrl);
                        showMessage('✅ تم تحميل الفيديو بدون صوت!', 'success');
                    } catch (error) {
                        showMessage('❌ فشل التحميل', 'error');
                    } finally {
                        showLoading(false);
                    }
                }

                async function downloadAudio() {
                    const url = document.getElementById('url').value;
                    if (!url) {
                        showMessage('الرجاء إدخال رابط تيك توك', 'error');
                        return;
                    }
                    showLoading(true);
                    try {
                        const response = await fetch('/process-audio', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ tiktokUrl: url })
                        });
                        if (!response.ok) throw new Error('فشل التحميل');
                        const blob = await response.blob();
                        const downloadUrl = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = downloadUrl;
                        a.download = 'tikswaft_audio.mp3';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        window.URL.revokeObjectURL(downloadUrl);
                        showMessage('✅ تم تحميل الصوت!', 'success');
                    } catch (error) {
                        showMessage('❌ فشل تحميل الصوت', 'error');
                    } finally {
                        showLoading(false);
                    }
                }

                function showLoading(show) {
                    document.getElementById('loading').style.display = show ? 'block' : 'none';
                }

                function showMessage(msg, type) {
                    const msgDiv = document.getElementById('message');
                    msgDiv.textContent = msg;
                    msgDiv.className = 'message ' + type;
                    setTimeout(() => {
                        msgDiv.className = 'message';
                        msgDiv.style.display = 'none';
                    }, 3000);
                }
            </script>
        </body>
        </html>
    `);
});

// إعداد منفذ خادم الويب
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 TikSwaft Server is running on port ${PORT}`);
    console.log(`📱 افتح على هاتفك: http://YOUR_IP:${PORT}/mobile`);
});
// ==========================================
// 🚀 مسار كتم الصوت المباشر للهواتف (GET Stream)
// ==========================================
app.get('/mute-video-direct', async (req, res) => {
    const { tiktokUrl } = req.query;
    if (!tiktokUrl) return res.status(400).send("URL is required");

    const inputPath = path.join(__dirname, `input_${Date.now()}.mp4`);
    const outputPath = path.join(__dirname, `output_${Date.now()}.mp4`);

    try {
        const response = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`);
        const videoUrl = response.data.data.play;
        if (!videoUrl) return res.status(400).send("Video not found");

        // حفظ الملف مؤقتاً لعمل معالجة سريعة بدون لاغ
        const writer = fs.createWriteStream(inputPath);
        const videoStream = await axios({ method: 'get', url: videoUrl, responseType: 'stream' });
        videoStream.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        // إرسال الهيدر للأندرويد لبدء التحميل الفوري في الخلفية
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', 'attachment; filename="tikswaft-muted.mp4"');

        ffmpeg(inputPath)
            .outputOptions(['-an', '-c:v copy']) // كتم فوري بدون إعادة ترميز
            .on('error', (err) => {
                cleanupFiles([inputPath, outputPath]);
                if (!res.headersSent) res.status(500).send("Error");
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

// ==========================================
// 🚀 مسار تحميل الصوت المباشر للهواتف (GET Stream)
// ==========================================
app.get('/audio-direct', async (req, res) => {
    const { tiktokUrl } = req.query;
    try {
        const response = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`);
        const audioLink = response.data.data.music;

        if (!audioLink) return res.status(400).send("Audio not found");

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', 'attachment; filename="tikswaft_audio.mp3"');

        const audioStream = await axios({ method: 'get', url: audioLink, responseType: 'stream' });
        audioStream.data.pipe(res);
    } catch (error) {
        res.status(500).send("Error fetching audio");
    }
});