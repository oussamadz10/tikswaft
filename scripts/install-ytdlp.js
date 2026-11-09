// Runs after `npm install` (Render build): fetch the yt-dlp binary.
// Never fails the build: the server retries the download at startup if needed.
const { installBinary } = require('../lib/ytdlp');

installBinary()
    .then(() => process.exit(0))
    .catch((e) => {
        console.warn('[yt-dlp] postinstall download failed, will retry at runtime: ' + e.message);
        process.exit(0);
    });
