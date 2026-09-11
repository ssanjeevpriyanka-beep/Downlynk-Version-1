const { isValidMediaUrl, sanitizeText } = require('../utils/url');

function validateAnalyzeBody(req, res, next) {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ success: false, message: 'A media URL is required.' });
  }

  const normalizedUrl = url.trim();
  if (!isValidMediaUrl(normalizedUrl)) {
    return res.status(400).json({ success: false, message: 'The requested URL is invalid or unsupported.' });
  }

  req.body.url = normalizedUrl;
  next();
}

function validateDownloadBody(req, res, next) {
  const { url, formatId, type = 'video' } = req.body || {};
  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ success: false, message: 'A media URL is required.' });
  }

  if (!formatId || typeof formatId !== 'string' || !formatId.trim()) {
    return res.status(400).json({ success: false, message: 'A media quality is required.' });
  }

  if (type !== 'video' && type !== 'audio') {
    return res.status(400).json({ success: false, message: 'The download type is invalid.' });
  }

  if (!/^[a-zA-Z0-9_.-]+$/.test(formatId)) {
    return res.status(400).json({ success: false, message: 'The selected quality is invalid.' });
  }

  const normalizedUrl = url.trim();
  if (!isValidMediaUrl(normalizedUrl)) {
    return res.status(400).json({ success: false, message: 'The requested URL is invalid or unsupported.' });
  }

  req.body.url = normalizedUrl;
  req.body.qualityLabel = sanitizeText(req.body.qualityLabel || 'download');
  req.body.type = type;
  next();
}

function notFound(req, res) {
  res.status(404).json({ success: false, message: 'Route not found.' });
}

function errorHandler(err, req, res, next) {
  console.error(err);
  res.status(err.status || 500).json({ success: false, message: err.message || 'Internal Server Error.' });
}

module.exports = {
  validateAnalyzeBody,
  validateDownloadBody,
  notFound,
  errorHandler
};
