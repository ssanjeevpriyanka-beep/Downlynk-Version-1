const fs = require('fs');
const path = require('path');
const os = require('os');

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function createTempFilePath(dirPath, prefix) {
  ensureDirectory(dirPath);
  return path.join(dirPath, `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
}

function formatDuration(seconds) {
  if (!seconds || Number(seconds) <= 0) {
    return 'Unknown';
  }

  const totalSeconds = Math.floor(Number(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

async function resolveBinary(command) {
  const { execFile } = require('child_process');
  return new Promise((resolve) => {
    execFile(command, ['--version'], (error) => {
      if (error) {
        resolve(null);
        return;
      }
      resolve(command);
    });
  });
}

function getExtensionForFormat(formatId) {
  if (typeof formatId === 'string' && formatId.includes('mp3')) {
    return 'mp3';
  }
  return 'mp4';
}

module.exports = {
  ensureDirectory,
  createTempFilePath,
  formatDuration,
  resolveBinary,
  getExtensionForFormat
};
