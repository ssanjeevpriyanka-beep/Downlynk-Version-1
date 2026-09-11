const { URL } = require('url');

const BLOCKED_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
const ALLOWED_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'vimeo.com', 'www.vimeo.com', 'soundcloud.com', 'www.soundcloud.com', 'twitter.com', 'www.twitter.com', 'x.com', 'www.x.com', 'tiktok.com', 'www.tiktok.com', 'instagram.com', 'www.instagram.com', 'facebook.com', 'www.facebook.com', 'bandcamp.com', 'www.bandcamp.com', 'loom.com', 'www.loom.com'];

function isValidMediaUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }

  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    if (BLOCKED_HOSTS.includes(parsed.hostname)) {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();
    if (hostname.startsWith('10.') || hostname.startsWith('192.168.') || hostname.startsWith('172.16.')) {
      return false;
    }

    return ALLOWED_HOSTS.includes(hostname) || hostname.endsWith('.youtube.com') || hostname.endsWith('.vimeo.com') || hostname.endsWith('.soundcloud.com');
  } catch (error) {
    return false;
  }
}

function sanitizeText(value) {
  return String(value || '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function createSafeFilename(value) {
  return sanitizeText(value)
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'media';
}

module.exports = {
  isValidMediaUrl,
  sanitizeText,
  createSafeFilename
};
