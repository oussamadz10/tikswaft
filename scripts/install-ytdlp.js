// Runs after `npm install` (Render build): fetch the yt-dlp binary.
// Never fails the build: the server retries the download at startup if needed.
const { installBinary } = require('../lib/ytdlp');

installBinary()
    .then(() => require('../lib/warp').install().catch((e) => console.warn('[warp] postinstall skipped: ' + e.message)))
    .then(() => process.exit(0))
    .catch((e) => {
        console.warn('[yt-dlp] postinstall download failed, will retry at runtime: ' + e.message);
        process.exit(0);
    });
