# TikSwaft – free video & photo downloader API

Backend of **[TikSwaft](https://tikswaft.com/)**, a free online downloader for TikTok, YouTube, Instagram, Facebook, X (Twitter), Pinterest and RedNote (Xiaohongshu). It saves videos without watermark as MP4, converts them to MP3, and downloads photos in original quality.

## Online tools

| Platform | Tool |
|---|---|
| TikTok | [TikTok Downloader without watermark](https://tikswaft.com/) · [TikTok to MP3](https://tikswaft.com/tikswaft/audio-download) · [TikTok Slideshow Photo Downloader](https://tikswaft.com/tikswaft/image-upload) · [Mute TikTok Video](https://tikswaft.com/tikswaft/mute-video) · [Trim TikTok Video](https://tikswaft.com/tikswaft/trim-video) |
| YouTube | [YouTube Video & Shorts Downloader](https://tikswaft.com/youswaft/youswaft) |
| Instagram | [Instagram Reels & Photo Downloader](https://tikswaft.com/inswaft/inswaft) |
| Facebook | [Facebook Video Downloader](https://tikswaft.com/faceswaft/faceswaft) |
| X (Twitter) | [Twitter Video & GIF Downloader](https://tikswaft.com/xswaft/xswaft) |
| Pinterest | [Pinterest Video & Image Downloader](https://tikswaft.com/pinswaft/pinswaft) |
| RedNote / 小红书 | [RedNote Downloader without watermark](https://tikswaft.com/redswaft/redswaft) |

## How it works

- **Node.js + Express** server deployed on Render.
- **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** is downloaded as a standalone binary at install time and updated at every start.
- Each platform also has a lightweight fallback: tikwm (TikTok), vxtwitter / fxtwitter (X), Pinterest resource and widget APIs, the Instagram embed page, the Facebook page and the RedNote note page.
- **ffmpeg** handles MP3 conversion, muting and trimming.

### API

```
POST /api/media/info      { "url": "<post link>" }
POST /api/media/prepare   { "url": "...", "type": "video|audio|mute|trim|image|thumbnail", "quality": 720, "index": 0, "start": 5, "duration": 10 }
GET  /api/media/file/:token
GET  /api/media/direct?url=...&type=video
```

Legacy TikTok routes used by the website and the Android app are served at `/` and `/api/tiktok`.

### Environment variables (optional)

| Variable | Use |
|---|---|
| `COOKIES_YOUTUBE`, `COOKIES_INSTAGRAM`, `COOKIES_FACEBOOK` | Netscape `cookies.txt` content (plain or base64) for platforms that block servers |
| `YTDLP_PROXY` | Proxy URL for yt-dlp |
| `MAX_HEIGHT` | Highest video quality offered (default 1080) |
| `MAX_JOBS` | Concurrent heavy jobs (default 2) |

## Run locally

```bash
npm install
npm start
```

## Disclaimer

Only download content you own or have permission to use. TikSwaft is not affiliated with TikTok, YouTube, Instagram, Facebook, X, Pinterest or Xiaohongshu.
