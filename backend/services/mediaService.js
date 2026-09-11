const { spawn } = require('child_process');
const { promises: fsPromises, readdirSync } = require('fs');
const path = require('path');
const { join } = require('path');

const { ensureDirectory, resolveBinary } = require('../utils/file');
const { sanitizeText, createSafeFilename } = require('../utils/url');

const tempDirectory =
  process.env.TEMP_DIR || join(__dirname, '..', 'temp');
const downloadJobs = new Map();

ensureDirectory(tempDirectory);

function getDownloadJob(requestId) {
  const key = String(requestId);
  let job = downloadJobs.get(key);
  if (!job) {
    job = { listeners: new Set(), child: null, cancelled: false, lastProgress: null };
    downloadJobs.set(key, job);
  }
  return job;
}

function publishDownloadProgress(requestId, progress) {
  const job = getDownloadJob(requestId);
  job.lastProgress = progress;
  job.listeners.forEach((listener) => listener(progress));
}

function subscribeDownloadProgress(requestId, listener) {
  const job = getDownloadJob(requestId);
  job.listeners.add(listener);
  if (job.lastProgress) listener(job.lastProgress);
  return () => job.listeners.delete(listener);
}

function cancelDownload(requestId) {
  const job = downloadJobs.get(String(requestId));
  if (!job) return false;
  job.cancelled = true;
  if (job.child && !job.child.killed) {
    job.child.kill();
  }
  publishDownloadProgress(requestId, { status: 'cancelled', message: 'Download cancelled.' });
  return true;
}

function removeDownloadJob(requestId) {
  setTimeout(() => downloadJobs.delete(String(requestId)), 30000);
}

function parseProgress(line) {
  const match = line.match(/\[download\]\s+([\d.]+)%.*?of\s+(?:~\s*)?([\d.]+\s*[KMGTP]?i?B)?(?:\s+at\s+([\d.]+\s*[KMGTP]?i?B\/s))?(?:\s+ETA\s+(\S+))?/i);
  if (!match) return null;

  const percent = Math.min(100, Math.max(0, Number(match[1])));
  const totalBytes = parseSize(match[2]);
  const speedBytes = parseSize(match[3] && match[3].replace(/\/s$/i, ''));
  return {
    status: 'downloading',
    percent,
    downloadedBytes: totalBytes ? Math.round(totalBytes * percent / 100) : null,
    totalBytes,
    speedBytes,
    etaSeconds: parseEta(match[4])
  };
}

function parseSize(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^([\d.]+)\s*([KMGTP]?i?B)?$/i);
  if (!match) return null;
  const units = { B: 1, KB: 1000, MB: 1000 ** 2, GB: 1000 ** 3, TB: 1000 ** 4,
    KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3, TIB: 1024 ** 4 };
  return Math.round(Number(match[1]) * (units[String(match[2] || 'B').toUpperCase()] || 1));
}

function parseEta(value) {
  if (!value || value === 'Unknown') return null;
  const parts = String(value).split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

async function cleanupDownloadFiles(prefix) {
  const files = readdirSync(tempDirectory);
  await Promise.all(files
    .filter((file) => file.startsWith(prefix))
    .map((file) => fsPromises.unlink(path.join(tempDirectory, file)).catch(() => {})));
}

/**
 * Find FFmpeg binary folder.
 */
function getFfmpegDirectory() {
  const fs = require('fs');
  const possiblePaths = [
    "C:\\Users\\Priyanka\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0-full_build\\bin",
    process.env.FFMPEG_PATH ? path.dirname(process.env.FFMPEG_PATH) : null,
  ].filter(Boolean);

  for (const dir of possiblePaths) {
    try {
      const ffmpegFile = path.join(dir, 'ffmpeg.exe');
      if (fs.existsSync(ffmpegFile)) {
        return dir;
      }
    } catch (_) {
      // Ignore
    }
  }
  return null;
}

/**
 * Map format to a standard resolution label.
 */
function getStandardLabel(format) {
  if (format.format_note) {
    const match = String(format.format_note).match(/^(\d+p)/i);
    if (match) {
      return match[1].toLowerCase();
    }
    const numMatch = String(format.format_note).match(/^(\d+)$/);
    if (numMatch) {
      return `${numMatch[1]}p`;
    }
  }
  const h = Math.min(format.width || 0, format.height || 0) || format.height || 0;
  if (h <= 144) return '144p';
  if (h <= 240) return '240p';
  if (h <= 360) return '360p';
  if (h <= 480) return '480p';
  if (h <= 720) return '720p';
  if (h <= 1080) return '1080p';
  if (h <= 1440) return '1440p';
  return '2160p';
}

/**
 * Get yt-dlp.
 *
 * On your PC there are two yt-dlp installations.
 * Prefer Python 3.13 installation if it exists, otherwise fall back to PATH.
 */
async function getYtDlpBinary() {
  const possiblePaths = [
    process.env.YTDLP_PATH,
    path.join(
      process.env.LOCALAPPDATA || '',
      'Programs',
      'Python',
      'Python313',
      'Scripts',
      'yt-dlp.exe'
    ),
    path.join(
      process.env.LOCALAPPDATA || '',
      'Programs',
      'Python',
      'Python37',
      'Scripts',
      'yt-dlp.exe'
    )
  ].filter(Boolean);

  for (const binary of possiblePaths) {
    try {
      await fsPromises.access(binary);
      return binary;
    } catch (_) {
      // Try next path
    }
  }

  return await resolveBinary('yt-dlp');
}

/**
 * Analyze a YouTube/media URL.
 */
async function analyzeMediaService(url) {
  let ytDlpBinary;

  try {
    ytDlpBinary = await getYtDlpBinary();
  } catch (_) {
    ytDlpBinary = null;
  }

  if (!ytDlpBinary) {
    return {
      success: false,
      message: 'yt-dlp is not installed or could not be found on the server.'
    };
  }

  /**
   * --dump-single-json:
   * Returns complete metadata including:
   * title
   * thumbnail
   * duration
   * uploader
   * formats
   *
   * --no-playlist:
   * Prevents playlist downloads.
   */
  const args = [
    '--dump-single-json',
    '--no-warnings',
    '--no-playlist',
    '--skip-download',
    '--no-check-certificates',
    '--js-runtimes',
    'node',
    '--extractor-args',
    'youtube:player_client=web_embedded,web,tv',
    url
  ];

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    const child = spawn(ytDlpBinary, args, {
      windowsHide: true
    });

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      resolve({
        success: false,
        message: `Failed to start yt-dlp: ${error.message}`
      });
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.error('yt-dlp analyze error:', stderr);

        return resolve({
          success: false,
          message:
            stderr.trim() ||
            'Unable to analyze this video. Please check the URL and try again.'
        });
      }

      try {
        const info = JSON.parse(stdout);

        /**
         * Keep usable video formats.
         *
         * Unlike the old version, we DON'T restrict everything to
         * H.264/AVC only.
         *
         * YouTube can provide:
         * - AVC / H.264
         * - VP9
         * - AV1
         *
         * All of them can be downloaded and FFmpeg can merge them.
         */
        const videoFormats = (info.formats || [])
          .filter((f) => {
            const hasVideo = f.vcodec && f.vcodec !== 'none';
            const hasResolution = (f.width && f.width > 0) || (f.height && f.height > 0);
            return hasVideo && hasResolution;
          });

        const mappedFormats = videoFormats.map((f) => {
          const stdLabel = getStandardLabel(f);
          const stdHeight = parseInt(stdLabel, 10) || f.height || 0;
          const isMp4 = (f.ext === 'mp4');
          const isAvc = f.vcodec && f.vcodec.toLowerCase().includes('avc');
          
          return {
            id: String(f.format_id),
            label: stdLabel,
            resolution: f.resolution || `${f.width}x${f.height}`,
            width: Number(f.width || 0),
            height: Number(f.height || 0),
            stdHeight,
            ext: f.ext || 'mp4',
            filesize: Number(f.filesize || 0) || Number(f.filesize_approx || 0),
            fps: f.fps || null,
            vcodec: f.vcodec || null,
            acodec: f.acodec || null,
            hasAudio: f.acodec && f.acodec !== 'none' ? true : false,
            hasVideo: true,
            isMp4,
            isAvc
          };
        });

        const audioFormats = (info.formats || [])
          .filter((f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'))
          .map((f) => ({
            id: String(f.format_id),
            abr: Number(f.abr || f.tbr || 0),
            ext: f.ext || 'm4a',
            acodec: f.acodec
          }))
          .filter((format) => format.abr > 0)
          .sort((a, b) => b.abr - a.abr);

        // Sort to prefer highest resolution, then highest actual pixels, then MP4 with H.264/AVC, then MP4, then audio
        mappedFormats.sort((a, b) => {
          if (b.stdHeight !== a.stdHeight) {
            return b.stdHeight - a.stdHeight;
          }
          const aPixels = a.width * a.height;
          const bPixels = b.width * b.height;
          if (bPixels !== aPixels) {
            return bPixels - aPixels;
          }
          const aPref = a.isMp4 && a.isAvc;
          const bPref = b.isMp4 && b.isAvc;
          if (aPref !== bPref) {
            return bPref ? 1 : -1;
          }
          if (a.isMp4 !== b.isMp4) {
            return b.isMp4 ? 1 : -1;
          }
          if (a.hasAudio !== b.hasAudio) {
            return b.hasAudio ? 1 : -1;
          }
          return b.filesize - a.filesize;
        });

        const uniqueFormats = [];
        const seenHeights = new Set();

        for (const format of mappedFormats) {
          if (!seenHeights.has(format.stdHeight)) {
            seenHeights.add(format.stdHeight);
            uniqueFormats.push(format);
          }
        }

        // Final sort UI from highest to lowest
        uniqueFormats.sort((a, b) => b.stdHeight - a.stdHeight);

        resolve({
          success: true,
          info: {
            id: info.id || 'unknown',
            title: sanitizeText(info.title || 'Untitled media'),
            thumbnail: info.thumbnail || info.thumbnails?.at(-1)?.url || '',
            duration: Number(info.duration || 0),
            uploader: info.uploader || info.channel || 'Unknown uploader',
            view_count: Number(info.view_count || 0)
          },
          formats: uniqueFormats.slice(0, 20)
          ,
          audioFormats: audioFormats.slice(0, 20)
        });
      } catch (error) {
        console.error('yt-dlp JSON parse error:', error);
        console.error('stdout:', stdout);
        console.error('stderr:', stderr);

        resolve({
          success: false,
          message:
            'The response from yt-dlp could not be parsed.'
        });
      }
    });
  });
}

/**
 * Download selected quality.
 */
async function downloadMediaService({
  url,
  formatId,
  qualityLabel,
  requestId,
  hasAudio,
  type = 'video'
}) {
  const ytDlpBinary = await getYtDlpBinary();

  if (!ytDlpBinary) {
    return {
      success: false,
      message:
        'yt-dlp is not installed on this server.'
    };
  }

  const safeName = createSafeFilename(qualityLabel || 'download');

  const safeRequestId = String(requestId || Date.now())
    .replace(/[^a-zA-Z0-9_-]/g, '');

  const outputTemplate = join(
    tempDirectory,
    `${safeName}-${safeRequestId}.%(ext)s`
  );

  let selectedFormat;
  let audioQuality;
  const height = extractHeight(qualityLabel);
  const formatHasAudio = hasAudio || (formatId === '18' || formatId === '22');

  if (type === 'audio') {
    audioQuality = String(qualityLabel || '').match(/^(\d{2,3})\s*kbps$/i);
    if (!audioQuality) {
      return { success: false, message: 'The selected audio quality is not supported.' };
    }
    selectedFormat = formatId && formatId !== 'best' ? `${formatId}/bestaudio` : 'bestaudio';
  } else if (formatId && formatId !== 'best') {
    if (formatHasAudio) {
      selectedFormat = [
        formatId,
        '18',
        'bestvideo+bestaudio/best'
      ].join('/');
    } else {
      selectedFormat = [
        `${formatId}+bestaudio/best`,
        `bestvideo[height<=${height}][vcodec^=avc]+bestaudio/best`,
        `bestvideo[height<=${height}]+bestaudio/best`,
        '18',
        'bestvideo+bestaudio/best'
      ].join('/');
    }
  } else {
    selectedFormat = 'bestvideo+bestaudio/best';
  }

  const args = [
    '--format',
    selectedFormat,

    '--output',
    outputTemplate,

    '--no-playlist',

    '--restrict-filenames',

    '--no-warnings',

    '--newline',

    '--js-runtimes',
    'node',

    '--no-part',

    '--extractor-args',
    'youtube:player_client=web_embedded,web,tv'
  ];

  if (type === 'audio') {
    args.push(
      '--extract-audio',
      '--audio-format',
      'mp3',
      '--audio-quality',
      `${audioQuality[1]}K`
    );
  } else {
    args.splice(2, 0, '--merge-output-format', 'mp4');
  }

  const ffmpegDir = getFfmpegDirectory();
  if (ffmpegDir) {
    args.push('--ffmpeg-location', ffmpegDir);
  }

  args.push(url);

  console.log('---------------------------------------------');
  console.log('Downlynk download');
  console.log('yt-dlp:', ytDlpBinary);
  console.log('URL:', url);
  console.log('Format:', selectedFormat);
  console.log('Output:', outputTemplate);
  if (ffmpegDir) {
    console.log('FFmpeg:', ffmpegDir);
  }
  console.log('---------------------------------------------');

  return new Promise((resolve) => {
    let stderr = '';
    let stdout = '';
    let progressBuffer = '';
    const job = getDownloadJob(safeRequestId);
    const handleOutput = (chunk) => {
      progressBuffer += chunk.toString();
      const lines = progressBuffer.split(/\r?\n/);
      progressBuffer = lines.pop() || '';
      lines.forEach((line) => {
        const progress = parseProgress(line);
        if (progress) publishDownloadProgress(safeRequestId, progress);
      });
    };

    const child = spawn(
      ytDlpBinary,
      args,
      {
        windowsHide: true
      }
    );
    job.child = child;

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      handleOutput(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      handleOutput(chunk);
    });

    child.on('error', (error) => {
      job.child = null;
      cleanupDownloadFiles(`${safeName}-${safeRequestId}`);
      removeDownloadJob(safeRequestId);
      resolve({
        success: false,
        message:
          `Failed to start download process: ${error.message}`
      });
    });

    child.on('close', async (code) => {
      job.child = null;
      console.log('yt-dlp exit code:', code);

      if (code !== 0) {
        console.error('Download error:', stderr);
        await cleanupDownloadFiles(`${safeName}-${safeRequestId}`);
        if (job.cancelled) {
          removeDownloadJob(safeRequestId);
          return resolve({ success: false, cancelled: true, message: 'Download cancelled.' });
        }
        publishDownloadProgress(safeRequestId, { status: 'error', message: 'Download failed.' });
        removeDownloadJob(safeRequestId);

        return resolve({
          success: false,
          message:
            cleanYtDlpError(stderr) ||
            'yt-dlp failed to download this video.'
        });
      }

      try {
        const files = readdirSync(tempDirectory);

        const prefix = `${safeName}-${safeRequestId}`;

        /**
         * Find final output.
         */
        const downloaded = files.find((file) => {
          if (!file.startsWith(prefix)) {
            return false;
          }

          if (file.endsWith('.part')) {
            return false;
          }

          if (file.endsWith('.ytdl')) {
            return false;
          }

          if (file.endsWith('.txt')) {
            return false;
          }

          /**
           * Ignore temporary format files.
           */
          if (/\.f\d+\./i.test(file)) {
            return false;
          }

          return true;
        });

        if (!downloaded) {
          console.error(
            'Files in temp directory:',
            files
          );

          cleanupDownloadFiles(`${safeName}-${safeRequestId}`);
          publishDownloadProgress(safeRequestId, { status: 'error', message: 'The downloaded file could not be found.' });
          removeDownloadJob(safeRequestId);
          return resolve({
            success: false,
            message:
              'Download completed but the output file could not be found.'
          });
        }

        const finalPath = path.join(
          tempDirectory,
          downloaded
        );

        const stat =
          await fsPromises.stat(finalPath);

        if (!stat.isFile() || stat.size === 0) {
          await cleanupDownloadFiles(`${safeName}-${safeRequestId}`);
          publishDownloadProgress(safeRequestId, { status: 'error', message: 'The downloaded file is empty or invalid.' });
          removeDownloadJob(safeRequestId);
          return resolve({
            success: false,
            message:
              'The downloaded file is empty or invalid.'
          });
        }

        const ext =
          path.extname(downloaded).toLowerCase();

        let contentType =
          'application/octet-stream';

        if (ext === '.mp4') {
          contentType = 'video/mp4';
        } else if (ext === '.webm') {
          contentType = 'video/webm';
        } else if (ext === '.mkv') {
          contentType = 'video/x-matroska';
        } else if (ext === '.mp3') {
          contentType = 'audio/mpeg';
        }

        resolve({
          success: true,
          tempPath: finalPath,
          filename: downloaded,
          contentType
        });
        publishDownloadProgress(safeRequestId, { status: 'ready', percent: 100, totalBytes: stat.size, downloadedBytes: stat.size });
        removeDownloadJob(safeRequestId);
      } catch (error) {
        console.error(
          'Output file error:',
          error
        );

        await cleanupDownloadFiles(`${safeName}-${safeRequestId}`);
        publishDownloadProgress(safeRequestId, { status: 'error', message: 'The downloaded file could not be prepared.' });
        removeDownloadJob(safeRequestId);
        resolve({
          success: false,
          message: error.message
        });
      }
    });
  });
}

/**
 * Extract height from quality label.
 *
 * Example:
 * "1080p" -> 1080
 * "720p"  -> 720
 */
function extractHeight(label) {
  if (!label) {
    return 0;
  }

  const match = String(label).match(
    /(\d{3,4})p/i
  );

  return match ? Number(match[1]) : 0;
}

/**
 * Make yt-dlp errors easier for the frontend to display.
 */
function cleanYtDlpError(error) {
  if (!error) {
    return '';
  }

  const text = String(error).trim();

  if (
    text.includes(
      'Sign in to confirm you’re not a bot'
    )
  ) {
    return 'YouTube requires verification for this video. Please try another video.';
  }

  if (
    text.includes(
      'Sign in to confirm you are not a bot'
    )
  ) {
    return 'YouTube requires verification for this video. Please try another video.';
  }

  if (
    text.includes(
      'Requested format is not available'
    )
  ) {
    return 'The selected quality is not available for this video. Please select another quality.';
  }

  if (
    text.includes(
      'Video unavailable'
    )
  ) {
    return 'This YouTube video is unavailable.';
  }

  if (
    text.includes(
      'Private video'
    )
  ) {
    return 'This video is private and cannot be downloaded.';
  }

  return text;
}

module.exports = {
  analyzeMediaService,
  downloadMediaService,
  subscribeDownloadProgress,
  cancelDownload
};