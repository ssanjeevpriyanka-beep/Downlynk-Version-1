const state = {
  selectedFormat: null,
  currentMedia: null,
  downloadType: 'video',
  downloadController: null,
  progressSource: null,
  resetVersion: 0
};

/* ---------------------------------------------------------------------- */
/* Theme                                                                   */
/* ---------------------------------------------------------------------- */

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const toggle = document.getElementById('themeToggle');
  toggle.setAttribute('aria-pressed', String(theme === 'light'));
  toggle.setAttribute('aria-label', theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
  try { localStorage.setItem('mdp-theme', theme); } catch (error) { /* storage unavailable */ }
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('mdp-theme'); } catch (error) { /* storage unavailable */ }
  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  applyTheme(saved || (prefersLight ? 'light' : 'dark'));

  document.getElementById('themeToggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'light' ? 'dark' : 'light');
  });
}

/* ---------------------------------------------------------------------- */
/* Toasts                                                                   */
/* ---------------------------------------------------------------------- */

const TOAST_ICONS = { success: 'bi-check-circle', error: 'bi-exclamation-triangle', info: 'bi-lightning-charge-fill' };

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<i class="bi ${TOAST_ICONS[type] || TOAST_ICONS.info}"></i><span>${message}</span>`;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  setTimeout(() => {
    toast.classList.remove('is-visible');
    setTimeout(() => toast.remove(), 260);
  }, 3600);
}

/* ---------------------------------------------------------------------- */
/* Platform detection + URL validation                                     */
/* ---------------------------------------------------------------------- */

const PLATFORMS = [
  { name: 'YouTube', icon: 'bi-youtube', pattern: /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i },
  { name: 'Instagram', icon: 'bi-instagram', pattern: /(^|\.)instagram\.com$/i },
  { name: 'TikTok', icon: 'bi-tiktok', pattern: /(^|\.)tiktok\.com$/i },
  { name: 'X (Twitter)', icon: 'bi-twitter-x', pattern: /(^|\.)twitter\.com$|(^|\.)x\.com$/i },
  { name: 'Facebook', icon: 'bi-facebook', pattern: /(^|\.)facebook\.com$|(^|\.)fb\.watch$/i },
  { name: 'Vimeo', icon: 'bi-vimeo', pattern: /(^|\.)vimeo\.com$/i },
  { name: 'Reddit', icon: 'bi-reddit', pattern: /(^|\.)reddit\.com$/i }
];

function detectPlatform(rawValue) {
  const value = rawValue.trim();
  if (!value) return { state: 'idle' };

  let url;
  try {
    url = new URL(value);
  } catch (error) {
    return { state: 'invalid' };
  }

  if (!/^https?:$/.test(url.protocol)) return { state: 'invalid' };

  const match = PLATFORMS.find((platform) => platform.pattern.test(url.hostname));
  if (match) return { state: 'valid', name: match.name, icon: match.icon };
  return { state: 'unknown' };
}

function renderDetection(rawValue) {
  const result = detectPlatform(rawValue);
  const badge = document.getElementById('detectBadge');
  const icon = document.getElementById('detectIcon');
  const label = document.getElementById('detectLabel');

  badge.classList.remove('is-idle', 'is-valid', 'is-unknown', 'is-invalid');

  if (result.state === 'idle') {
    badge.classList.add('is-idle');
    icon.className = 'bi bi-dot';
    label.textContent = 'Waiting for a link';
  } else if (result.state === 'invalid') {
    badge.classList.add('is-invalid');
    icon.className = 'bi bi-x-circle';
    label.textContent = "That doesn't look like a full URL yet";
  } else if (result.state === 'unknown') {
    badge.classList.add('is-unknown');
    icon.className = 'bi bi-question-circle';
    label.textContent = 'Link looks valid — source not confirmed, we\'ll still try';
  } else {
    badge.classList.add('is-valid');
    icon.className = `bi ${result.icon}`;
    label.textContent = `${result.name} link detected`;
  }

  return result;
}

/* ---------------------------------------------------------------------- */
/* Drag and drop                                                            */
/* ---------------------------------------------------------------------- */

function initDropzone() {
  const zone = document.getElementById('urlDropzone');
  const input = document.getElementById('urlInput');
  let dragDepth = 0;

  ['dragenter', 'dragover'].forEach((evt) => {
    zone.addEventListener(evt, (event) => {
      event.preventDefault();
      dragDepth += 1;
      zone.classList.add('is-dragover');
    });
  });

  ['dragleave', 'dragend'].forEach((evt) => {
    zone.addEventListener(evt, () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) zone.classList.remove('is-dragover');
    });
  });

  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    zone.classList.remove('is-dragover');

    const text = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain');
    if (!text) return;

    input.value = text.trim();
    renderDetection(input.value);
    showToast('Link dropped in.', 'success');
  });
}

/* ---------------------------------------------------------------------- */
/* Media preview + format rendering                                         */
/* ---------------------------------------------------------------------- */

function setBusy(isBusy) {
  const scan = document.getElementById('scanIndicator');
  const analyzeButton = document.getElementById('analyzeButton');
  scan.classList.toggle('d-none', !isBusy);
  analyzeButton.disabled = isBusy;
}

function initialOf(name) {
  const trimmed = (name || '').trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

function renderMediaPreview(data) {
  const previewCard = document.getElementById('previewCard');
  const previewEmpty = document.getElementById('previewEmpty');
  const title = document.getElementById('mediaTitle');
  const sub = document.getElementById('mediaSub');
  const thumbnail = document.getElementById('mediaThumbnail');
  const avatar = document.getElementById('channelAvatar');
  const qualityBadge = document.getElementById('qualityBadge');
  const durationBadge = document.getElementById('durationBadge');
  const qualities = document.getElementById('qualitiesList');
  const qualityNote = document.getElementById('qualityNote');
  const downloadButton = document.getElementById('downloadButton');

  state.currentMedia = data;
  state.downloadType = 'video';
  downloadButton.classList.remove('d-none');
  title.textContent = data.title;
  sub.textContent = `${data.uploader} · ${Number(data.viewCount || 0).toLocaleString()} views`;
  thumbnail.src = data.thumbnail || '/images/placeholder.svg';
  thumbnail.alt = data.title;
  avatar.textContent = initialOf(data.uploader);
  durationBadge.textContent = data.duration;

  renderQualityOptions();

  previewEmpty.classList.add('d-none');
  previewCard.classList.remove('d-none');
}

function renderQualityOptions() {
  const data = state.currentMedia;
  const formats = state.downloadType === 'audio' ? (data.audioFormats || []) : (data.formats || []);
  const qualities = document.getElementById('qualitiesList');
  const qualityNote = document.getElementById('qualityNote');
  const qualityBadge = document.getElementById('qualityBadge');
  const qualityHeading = document.getElementById('qualityHeading');

  qualityHeading.textContent = state.downloadType === 'audio' ? 'Audio Quality' : 'Video Quality';
  if (!formats.length) {
    state.selectedFormat = null;
    qualities.innerHTML = `<p class="quality-sub">No compatible ${state.downloadType} qualities were detected.</p>`;
    qualityNote.textContent = 'Try another link';
    qualityBadge.textContent = 'N/A';
    return;
  }

  state.selectedFormat = formats[0];
  qualityBadge.textContent = state.downloadType === 'audio'
    ? `${Math.round(state.selectedFormat.abr)}k`
    : state.selectedFormat.resolution;
  qualities.innerHTML = formats.map((format, index) => {
    const label = state.downloadType === 'audio'
      ? `${Math.round(format.abr)} kbps`
      : format.resolution;
    const ext = state.downloadType === 'audio' ? 'MP3' : format.ext.toUpperCase();
    return `<button type="button" class="format-chip ${index === 0 ? 'active' : ''}" data-format-id="${format.id}">
      <strong>${label}</strong>${ext}
    </button>`;
  }).join('');

  qualities.querySelectorAll('.format-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      qualities.querySelectorAll('.format-chip').forEach((item) => item.classList.remove('active'));
      chip.classList.add('active');
      state.selectedFormat = formats.find((format) => format.id === chip.dataset.formatId) || formats[0];
      const label = state.downloadType === 'audio'
        ? `${Math.round(state.selectedFormat.abr)} kbps`
        : state.selectedFormat.resolution;
      qualityNote.textContent = `${label} selected`;
      qualityBadge.textContent = state.downloadType === 'audio' ? `${Math.round(state.selectedFormat.abr)}k` : state.selectedFormat.resolution;
    });
  });
  qualityNote.textContent = `${state.downloadType === 'audio' ? `${Math.round(state.selectedFormat.abr)} kbps` : state.selectedFormat.resolution} selected`;
}

/* ---------------------------------------------------------------------- */
/* Analyze + download                                                      */
/* ---------------------------------------------------------------------- */

async function analyzeUrl() {
  const input = document.getElementById('urlInput');
  const value = input.value.trim();
  const detection = renderDetection(value);

  if (!value || detection.state === 'invalid') {
    showToast('Please paste a full media URL, e.g. https://…', 'error');
    return;
  }

  const requestVersion = state.resetVersion;
  setBusy(true);
  try {
    const response = await fetch(`${CONFIG.API_BASE_URL}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: value })
    });
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Analysis failed.');
    }

    if (requestVersion !== state.resetVersion) return;
    renderMediaPreview(result.data);
    showToast('Media analyzed successfully.', 'success');
  } catch (error) {
    if (requestVersion !== state.resetVersion) return;
    showToast(error.message, 'error');
  } finally {
    setBusy(false);
  }
}

async function downloadMedia() {
  if (!state.currentMedia || !state.selectedFormat) {
    showToast('Analyze a media URL before downloading.', 'error');
    return;
  }

  const progressBar = document.getElementById('downloadProgressBar');
  const progressText = document.getElementById('downloadProgressText');
  const downloadButton = document.getElementById('downloadButton');
  const cancelButton = document.getElementById('cancelDownloadButton');
  const progressDetails = document.getElementById('downloadProgressDetails');
  const controller = new AbortController();
  const requestId = window.crypto && crypto.randomUUID
    ? crypto.randomUUID()
    : `download-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const requestVersion = state.resetVersion;
  state.downloadController = controller;
  state.progressSource = new EventSource(`${CONFIG.API_BASE_URL}/api/download-progress/${requestId}`);
  state.progressSource.onmessage = (event) => {
    const progress = JSON.parse(event.data);
    if (progress.status === 'downloading') {
      updateDownloadProgress(progressBar, progressText, progressDetails, progress);
    }
  };
  state.progressSource.onerror = () => {};
  progressBar.style.width = '0%';
  progressText.textContent = 'Preparing download…';
  progressDetails.classList.remove('d-none');
  progressDetails.textContent = 'Waiting for download data…';
  downloadButton.disabled = true;
  cancelButton.classList.remove('d-none');

  try {
    const response = await fetch(`${CONFIG.API_BASE_URL}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
      signal: controller.signal,
      body: JSON.stringify({
        url: state.currentMedia.url,
        formatId: state.selectedFormat.id,
        qualityLabel: state.downloadType === 'audio'
          ? `${Math.round(state.selectedFormat.abr)} kbps`
          : state.selectedFormat.label,
        hasAudio: state.selectedFormat.hasAudio,
        type: state.downloadType
      })
    });

    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.message || 'Download failed.');
    }

    // Guard: if the server returns text/plain the response is not a video
    // (e.g. a fallback error message). Surface it as a real error instead of
    // saving a corrupt file that won't play.
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/plain') || contentType.includes('application/json')) {
      const text = await response.text();
      let msg = 'Download failed: server returned an unexpected response.';
      try { msg = JSON.parse(text).message || msg; } catch (_) { /* not JSON */ }
      throw new Error(msg);
    }

    if (!response.body) {
      throw new Error('The server returned an invalid download response.');
    }

    progressText.textContent = 'Streaming file…';
    const totalBytes = Number(response.headers.get('content-length')) || 0;
    const reader = response.body.getReader();
    const chunks = [];
    let downloadedBytes = 0;
    const startedAt = performance.now();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      downloadedBytes += value.byteLength;
      updateDownloadProgress(progressBar, progressText, progressDetails, {
        status: 'downloading',
        percent: totalBytes ? downloadedBytes / totalBytes * 100 : null,
        downloadedBytes,
        totalBytes,
        speedBytes: downloadedBytes / ((performance.now() - startedAt) / 1000),
        etaSeconds: totalBytes && downloadedBytes ? (totalBytes - downloadedBytes) / (downloadedBytes / ((performance.now() - startedAt) / 1000)) : null
      });
    }
    const blob = new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' });
    const disposition = response.headers.get('content-disposition') || '';
    const filenameMatch = disposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)"?/i);
    const filename = filenameMatch ? decodeURIComponent(filenameMatch[1]) : `${state.currentMedia.title || 'download'}.${state.selectedFormat.ext || 'mp4'}`;
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);

    progressBar.style.width = '100%';
    progressText.textContent = 'Download complete';
    progressDetails.textContent = totalBytes ? `100% • ${formatBytes(totalBytes)}` : '100%';
    showToast('Download started. Your browser is saving the file.', 'success');
  } catch (error) {
    if (requestVersion !== state.resetVersion) return;
    if (controller.signal.aborted) {
      progressBar.style.width = '0%';
      progressText.textContent = 'Download cancelled.';
      progressDetails.textContent = '';
      return;
    }
    progressBar.style.width = '0%';
    progressText.textContent = 'Download failed';
    progressDetails.textContent = '';
    showToast(error.message, 'error');
  } finally {
    if (state.downloadController === controller) {
      state.downloadController = null;
      if (state.progressSource) {
        state.progressSource.close();
        state.progressSource = null;
      }
      cancelButton.classList.add('d-none');
      downloadButton.disabled = false;
    }
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return 'calculating…';
  const rounded = Math.ceil(seconds);
  return rounded >= 60 ? `${Math.floor(rounded / 60)}m ${rounded % 60}s` : `${rounded}s`;
}

function updateDownloadProgress(progressBar, progressText, details, progress) {
  const percent = Number.isFinite(progress.percent) ? Math.round(progress.percent) : null;
  if (percent !== null) {
    progressBar.style.width = `${percent}%`;
    progressBar.parentElement.setAttribute('aria-valuenow', String(percent));
  }
  progressText.textContent = percent === null ? 'Downloading…' : `Downloading… ${percent}%`;
  const parts = [];
  if (percent !== null) parts.push(`${percent}%`);
  if (progress.downloadedBytes && progress.totalBytes) {
    parts.push(`${formatBytes(progress.downloadedBytes)} / ${formatBytes(progress.totalBytes)}`);
  }
  if (progress.speedBytes) parts.push(`${formatBytes(progress.speedBytes)}/s`);
  if (progress.etaSeconds !== null && progress.etaSeconds !== undefined) {
    parts.push(`ETA ${formatEta(progress.etaSeconds)}`);
  }
  details.textContent = parts.join(' • ') || 'Download in progress…';
}

function cancelDownload() {
  if (!state.downloadController) return;
  state.downloadController.abort();
}

function clearFrontendState() {
  state.resetVersion += 1;
  if (state.downloadController) {
    state.downloadController.abort();
    state.downloadController = null;
  }
  if (state.progressSource) {
    state.progressSource.close();
    state.progressSource = null;
  }

  state.currentMedia = null;
  state.selectedFormat = null;
  state.downloadType = 'video';

  document.getElementById('urlInput').value = '';
  document.getElementById('previewCard').classList.add('d-none');
  document.getElementById('previewEmpty').classList.remove('d-none');
  document.getElementById('scanIndicator').classList.add('d-none');
  document.getElementById('mediaThumbnail').src = '/images/placeholder.svg';
  document.getElementById('mediaThumbnail').alt = 'Media preview';
  document.getElementById('mediaTitle').textContent = 'Media title';
  document.getElementById('mediaSub').textContent = 'Uploader · views';
  document.getElementById('channelAvatar').textContent = '';
  document.getElementById('qualityBadge').textContent = 'HD';
  document.getElementById('durationBadge').textContent = '00:00';
  document.getElementById('qualitiesList').replaceChildren();
  document.getElementById('qualityNote').textContent = 'Select a quality';
  document.getElementById('qualityHeading').textContent = 'Video Quality';
  document.getElementById('videoTypeButton').classList.add('active');
  document.getElementById('audioTypeButton').classList.remove('active');
  document.getElementById('downloadButton').classList.add('d-none');
  document.getElementById('downloadButton').disabled = false;
  document.getElementById('cancelDownloadButton').classList.add('d-none');
  document.getElementById('downloadProgressBar').style.width = '0%';
  document.getElementById('downloadProgressText').textContent = 'Ready to stream';
  document.getElementById('downloadProgressDetails').textContent = '';
  document.getElementById('downloadProgressDetails').classList.add('d-none');
  document.getElementById('toastContainer').replaceChildren();
  renderDetection('');
  setBusy(false);
}

/* ---------------------------------------------------------------------- */
/* Wire up                                                                  */
/* ---------------------------------------------------------------------- */

initTheme();
initDropzone();

const urlInput = document.getElementById('urlInput');
let detectDebounce;
urlInput.addEventListener('input', () => {
  clearTimeout(detectDebounce);
  detectDebounce = setTimeout(() => renderDetection(urlInput.value), 180);
});
urlInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') analyzeUrl();
});

document.getElementById('analyzeButton').addEventListener('click', analyzeUrl);
document.getElementById('clearButton').addEventListener('click', clearFrontendState);
document.getElementById('downloadButton').addEventListener('click', downloadMedia);
document.querySelectorAll('[data-download-type]').forEach((button) => {
  button.addEventListener('click', () => {
    if (!state.currentMedia || state.downloadController) return;
    state.downloadType = button.dataset.downloadType;
    document.querySelectorAll('[data-download-type]').forEach((item) => {
      item.classList.toggle('active', item === button);
    });
    renderQualityOptions();
  });
});
document.getElementById('cancelDownloadButton').addEventListener('click', cancelDownload);
document.getElementById('pasteButton').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    urlInput.value = text;
    renderDetection(text);
    showToast('URL pasted from clipboard.', 'success');
  } catch (error) {
    showToast('Clipboard access is unavailable. Paste with Ctrl/Cmd+V instead.', 'error');
  }
});

renderDetection('');
