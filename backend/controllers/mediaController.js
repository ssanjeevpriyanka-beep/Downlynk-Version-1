const path = require('path');
const fs = require('fs');
const {
  analyzeMediaService,
  downloadMediaService,
  subscribeDownloadProgress,
  cancelDownload
} = require('../services/mediaService');
const { formatDuration } = require('../utils/file');

async function healthCheck(req, res) {
  res.json({
    success: true,
    message: 'Downlynk is online.',
    timestamp: new Date().toISOString()
  });
}

async function analyzeMedia(req, res, next) {
  try {
    const result = await analyzeMediaService(req.body.url);
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message });
    }

    const preview = {
      id: result.info.id || result.info.title,
      title: result.info.title || 'Untitled media',
      thumbnail: result.info.thumbnail || '/images/placeholder.svg',
      duration: formatDuration(result.info.duration || 0),
      durationSeconds: Number(result.info.duration || 0),
      uploader: result.info.uploader || 'Unknown uploader',
      viewCount: result.info.view_count || 0,
      formats: result.formats,
      audioFormats: result.audioFormats,
      url: req.body.url
    };

    return res.json({ success: true, data: preview });
  } catch (error) {
    next(error);
  }
}

async function downloadMedia(req, res, next) {
  const requestId = req.headers['x-request-id'] || `${Date.now()}`;
  const cancelHandler = () => cancelDownload(requestId);
  req.once('aborted', cancelHandler);
  res.once('close', cancelHandler);

  try {
    const result = await downloadMediaService({
      url: req.body.url,
      formatId: req.body.formatId,
      qualityLabel: req.body.qualityLabel,
      hasAudio: req.body.hasAudio,
      type: req.body.type,
      requestId
    });

    req.removeListener('aborted', cancelHandler);
    res.removeListener('close', cancelHandler);
    if (result.cancelled) {
      return res.status(499).json({ success: false, message: result.message });
    }

    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message });
    }

    const tempPath = result.tempPath;
    const filename = result.filename || 'download.mp4';

    // Get file size so we can send Content-Length — without it the browser
    // cannot verify the download is complete and some players refuse to open it.
    const stat = await fs.promises.stat(tempPath);

    res.setHeader('Content-Type', result.contentType || 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'no-store');

    const stream = fs.createReadStream(tempPath);
    stream.on('error', async (error) => {
      try {
        await fs.promises.unlink(tempPath);
      } catch (cleanupError) {
        // ignore cleanup errors
      }
      next(error);
    });

    stream.pipe(res);

    res.on('close', async () => {
      if (!res.writableFinished) {
        stream.destroy();
        cancelDownload(requestId);
        try {
          await fs.promises.unlink(tempPath);
        } catch (cleanupError) {
          // ignore cleanup errors
        }
      }
    });

    res.on('finish', async () => {
      try {
        await fs.promises.unlink(tempPath);
      } catch (cleanupError) {
        // ignore cleanup errors
      }
    });
  } catch (error) {
    next(error);
  }
}

function downloadProgress(req, res) {
  const requestId = req.params.requestId;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (progress) => {
    res.write(`data: ${JSON.stringify(progress)}\n\n`);
    if (progress.status === 'ready' || progress.status === 'error' || progress.status === 'cancelled') {
      res.end();
    }
  };
  const unsubscribe = subscribeDownloadProgress(requestId, send);
  req.once('close', unsubscribe);
}

module.exports = {
  healthCheck,
  analyzeMedia,
  downloadMedia,
  downloadProgress
};
