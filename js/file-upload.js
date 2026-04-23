/**
 * Divine Printing — File Upload Component
 * Dropzone-style UI for artwork uploads (JPG, PNG, PDF, AI, EPS, PSD)
 * Max 10 MB per file. Integrates with quote forms and the AWS presigned URL API.
 *
 * Usage:
 *   1. Add <div id="file-upload-zone"></div> to your form
 *   2. Include this script after the DOM is loaded
 *   3. Set window.UPLOAD_API_URL = 'https://your-api-gateway-url/upload-url'
 *   4. On form submit, call DivinePrintingUpload.getUploadedKeys() to get S3 keys
 */

(function () {
  'use strict';

  // ─── Config ──────────────────────────────────────────────────────────────
  // API Gateway endpoint — Lambda returns presigned S3 upload URLs
  // Endpoint: POST https://oq0flihx9i.execute-api.us-east-2.amazonaws.com/upload-url
  // Body: { fileName, fileType, fileSize, orderId? }
  // Response: { uploadUrl, fields, key }
  const API_UPLOAD_URL    = 'https://oq0flihx9i.execute-api.us-east-2.amazonaws.com/upload-url';

  const MAX_FILE_SIZE     = 10 * 1024 * 1024; // 10 MB
  const MAX_FILES         = 5;
  const ALLOWED_EXTS      = ['jpg', 'jpeg', 'png', 'pdf', 'ai', 'eps', 'psd'];
  const ALLOWED_TYPES     = [
    'image/jpeg', 'image/jpg', 'image/png', 'application/pdf',
    'application/illustrator', 'application/postscript',
    'application/x-illustrator', 'application/eps', 'application/x-eps',
    'image/eps', 'image/x-eps', 'image/vnd.adobe.photoshop',
    'application/x-photoshop', 'application/psd', 'image/psd',
    'application/octet-stream',
  ];

  // State
  const _files      = [];  // { file, status, key, error }
  const _callbacks  = {};

  // ─── Public API ──────────────────────────────────────────────────────────
  const DivinePrintingUpload = {
    /**
     * Initialize the upload zone inside `containerId`.
     * Options: { apiUrl, orderId, onUploadComplete, onError }
     */
    init(containerId, options = {}) {
      this._options = {
        apiUrl: options.apiUrl || window.UPLOAD_API_URL || API_UPLOAD_URL,
        orderId: options.orderId || null,
        onUploadComplete: options.onUploadComplete || null,
        onError: options.onError || null,
      };
      this._container = document.getElementById(containerId);
      if (!this._container) {
        console.warn('[DivinePrintingUpload] Container not found:', containerId);
        return;
      }
      this._render();
      this._bindEvents();
    },

    /** Returns array of S3 keys for successfully uploaded files */
    getUploadedKeys() {
      return _files
        .filter(f => f.status === 'done')
        .map(f => f.key);
    },

    /** Returns true if any upload is still in progress */
    isUploading() {
      return _files.some(f => f.status === 'uploading');
    },

    /** Returns true if all added files have been uploaded successfully */
    allUploaded() {
      return _files.length > 0 && _files.every(f => f.status === 'done');
    },
  };

  // ─── Render ──────────────────────────────────────────────────────────────
  DivinePrintingUpload._render = function () {
    this._container.innerHTML = `
      <div class="dpu-zone" id="dpu-dropzone" role="button" tabindex="0"
           aria-label="Upload artwork files — click or drag and drop">
        <div class="dpu-zone-inner">
          <div class="dpu-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
                 stroke="#3d1a6e" stroke-width="1.5" stroke-linecap="round"
                 stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <p class="dpu-title">Upload Your Artwork</p>
          <p class="dpu-subtitle">
            Drag &amp; drop files here, or
            <button type="button" class="dpu-browse-btn" id="dpu-browse-btn">browse</button>
          </p>
          <p class="dpu-hint">
            Accepted: JPG, PNG, PDF, AI, EPS, PSD &mdash; Max 10 MB per file
          </p>
          <input type="file" id="dpu-file-input" class="dpu-file-input"
                 accept=".jpg,.jpeg,.png,.pdf,.ai,.eps,.psd"
                 multiple aria-hidden="true" tabindex="-1"/>
        </div>
      </div>
      <div class="dpu-file-list" id="dpu-file-list" aria-live="polite"></div>
      <p class="dpu-files-hint" id="dpu-files-hint" style="display:none;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        Up to ${MAX_FILES} files. Files upload automatically once added.
      </p>
    `;

    // Inject styles once
    if (!document.getElementById('dpu-styles')) {
      const style = document.createElement('style');
      style.id = 'dpu-styles';
      style.textContent = `
        .dpu-zone {
          border: 2px dashed #b8a9d4;
          border-radius: 14px;
          padding: 36px 24px;
          text-align: center;
          cursor: pointer;
          background: #faf8ff;
          transition: border-color .2s, background .2s;
          outline: none;
          position: relative;
        }
        .dpu-zone:hover, .dpu-zone.drag-over {
          border-color: #3d1a6e;
          background: #f0eaff;
        }
        .dpu-zone:focus-visible { box-shadow: 0 0 0 3px rgba(61,26,110,.25); }
        .dpu-zone-inner { pointer-events: none; }
        .dpu-icon { margin-bottom: 12px; }
        .dpu-title {
          font-family: 'Cinzel', serif;
          font-size: 1.05rem;
          color: #3d1a6e;
          margin: 0 0 6px;
          font-weight: 600;
        }
        .dpu-subtitle { color: #6b5b7a; margin: 0 0 6px; font-size: .95rem; }
        .dpu-hint { color: #9a8aaa; font-size: .8rem; margin: 0; }
        .dpu-browse-btn {
          background: none; border: none; padding: 0;
          color: #3d1a6e; text-decoration: underline;
          cursor: pointer; font-size: inherit;
          pointer-events: auto;
        }
        .dpu-file-input { display: none; }
        .dpu-file-list { margin-top: 16px; display: flex; flex-direction: column; gap: 10px; }
        .dpu-file-item {
          display: grid;
          grid-template-columns: 36px 1fr auto;
          align-items: center;
          gap: 10px;
          background: #fff;
          border: 1px solid #e8e2f5;
          border-radius: 10px;
          padding: 12px 14px;
        }
        .dpu-file-icon {
          width: 36px; height: 36px; border-radius: 8px;
          background: #f0eaff; display: flex; align-items: center;
          justify-content: center; font-size: 1.1rem; flex-shrink: 0;
        }
        .dpu-file-info { min-width: 0; }
        .dpu-file-name {
          font-weight: 600; color: #1a0d30; font-size: .9rem;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .dpu-file-size { color: #9a8aaa; font-size: .78rem; margin-top: 2px; }
        .dpu-file-status { font-size: .78rem; margin-top: 2px; }
        .dpu-progress-bar {
          height: 4px; border-radius: 2px; background: #e8e2f5;
          margin-top: 6px; overflow: hidden;
        }
        .dpu-progress-fill {
          height: 100%; border-radius: 2px;
          background: linear-gradient(90deg, #3d1a6e, #c9a227);
          transition: width .2s;
        }
        .dpu-remove-btn {
          background: none; border: none; color: #b8a9d4;
          cursor: pointer; padding: 4px; border-radius: 6px; flex-shrink: 0;
        }
        .dpu-remove-btn:hover { color: #c62828; background: #fff0f0; }
        .dpu-status-uploading { color: #5a2d8a; }
        .dpu-status-done { color: #2e7d32; }
        .dpu-status-error { color: #c62828; }
        .dpu-status-waiting { color: #9a8aaa; }
        .dpu-files-hint {
          display: flex; align-items: center; gap: 5px;
          font-size: .78rem; color: #9a8aaa; margin-top: 8px;
        }
        .dpu-error-msg {
          color: #c62828; font-size: .85rem; margin-top: 6px;
          padding: 8px 12px; background: #fff0f0;
          border-radius: 8px; border-left: 3px solid #c62828;
        }
      `;
      document.head.appendChild(style);
    }
  };

  // ─── Events ──────────────────────────────────────────────────────────────
  DivinePrintingUpload._bindEvents = function () {
    const zone    = document.getElementById('dpu-dropzone');
    const input   = document.getElementById('dpu-file-input');
    const browse  = document.getElementById('dpu-browse-btn');

    // Click zone or browse button
    zone.addEventListener('click', () => input.click());
    browse.addEventListener('click', (e) => { e.stopPropagation(); input.click(); });
    zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') input.click(); });

    // File input change
    input.addEventListener('change', () => {
      this._handleFiles(Array.from(input.files));
      input.value = ''; // reset so same file can be re-added if removed
    });

    // Drag-and-drop
    zone.addEventListener('dragenter', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragover',  (e) => { e.preventDefault(); });
    zone.addEventListener('dragleave', (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over'); });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      this._handleFiles(Array.from(e.dataTransfer.files));
    });
  };

  // ─── File handling ───────────────────────────────────────────────────────
  DivinePrintingUpload._handleFiles = function (newFiles) {
    const slots = MAX_FILES - _files.length;
    if (slots <= 0) {
      this._showZoneError(`Maximum ${MAX_FILES} files allowed.`);
      return;
    }

    const toAdd = newFiles.slice(0, slots);
    if (newFiles.length > slots) {
      this._showZoneError(`Only ${slots} more file(s) can be added (max ${MAX_FILES}).`);
    }

    for (const file of toAdd) {
      const ext  = file.name.toLowerCase().split('.').pop();
      const type = file.type.toLowerCase() || 'application/octet-stream';

      if (!ALLOWED_EXTS.includes(ext)) {
        this._showZoneError(`"${file.name}" — file type not allowed. Use JPG, PNG, PDF, AI, EPS, or PSD.`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        this._showZoneError(`"${file.name}" is too large (${formatBytes(file.size)}). Max 10 MB.`);
        continue;
      }

      const entry = { file, status: 'waiting', key: null, error: null, id: uniqueId() };
      _files.push(entry);
      this._renderFileItem(entry);
      this._uploadFile(entry);
    }

    const hint = document.getElementById('dpu-files-hint');
    if (hint && _files.length > 0) hint.style.display = 'flex';
  };

  DivinePrintingUpload._uploadFile = async function (entry) {
    if (!this._options.apiUrl) {
      entry.status  = 'error';
      entry.error   = 'Upload API URL not configured.';
      this._updateFileItem(entry);
      return;
    }

    // Step 1: get presigned POST URL
    entry.status = 'uploading';
    this._updateFileItem(entry, 0);

    let presignedData;
    try {
      const res = await fetch(this._options.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: entry.file.name,
          fileType: entry.file.type || 'application/octet-stream',
          fileSize: entry.file.size,
          orderId: this._options.orderId || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to get upload URL');
      }
      presignedData = json;
    } catch (err) {
      entry.status = 'error';
      entry.error  = err.message || 'Network error. Please try again.';
      this._updateFileItem(entry);
      if (this._options.onError) this._options.onError(entry);
      return;
    }

    // Step 2: POST file directly to S3 using presigned URL + fields
    const formData = new FormData();
    Object.entries(presignedData.fields).forEach(([k, v]) => formData.append(k, v));
    formData.append('file', entry.file);

    try {
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', presignedData.uploadUrl, true);

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            this._updateFileItem(entry, pct);
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error('Upload failed (HTTP ' + xhr.status + ')'));
          }
        });
        xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
        xhr.send(formData);
      });

      entry.status = 'done';
      entry.key    = presignedData.key;
      this._updateFileItem(entry, 100);
      if (this._options.onUploadComplete) this._options.onUploadComplete(entry);

    } catch (err) {
      entry.status = 'error';
      entry.error  = err.message;
      this._updateFileItem(entry);
      if (this._options.onError) this._options.onError(entry);
    }
  };

  // ─── DOM updates ─────────────────────────────────────────────────────────
  DivinePrintingUpload._renderFileItem = function (entry) {
    const list = document.getElementById('dpu-file-list');
    if (!list) return;

    const item = document.createElement('div');
    item.className = 'dpu-file-item';
    item.id = 'dpu-item-' + entry.id;
    item.innerHTML = _fileItemHTML(entry, 0);
    list.appendChild(item);
  };

  DivinePrintingUpload._updateFileItem = function (entry, progress) {
    const item = document.getElementById('dpu-item-' + entry.id);
    if (item) item.innerHTML = _fileItemHTML(entry, progress);

    // Bind the new remove button
    const btn = document.getElementById('dpu-rm-' + entry.id);
    if (btn) {
      btn.addEventListener('click', () => this._removeFile(entry.id));
    }
  };

  DivinePrintingUpload._removeFile = function (id) {
    const idx = _files.findIndex(f => f.id === id);
    if (idx !== -1) _files.splice(idx, 1);
    const item = document.getElementById('dpu-item-' + id);
    if (item) item.remove();

    const hint = document.getElementById('dpu-files-hint');
    if (hint && _files.length === 0) hint.style.display = 'none';
  };

  DivinePrintingUpload._showZoneError = function (msg) {
    const zone = document.getElementById('dpu-dropzone');
    if (!zone) return;
    let errEl = zone.parentNode.querySelector('.dpu-error-msg');
    if (!errEl) {
      errEl = document.createElement('p');
      errEl.className = 'dpu-error-msg';
      zone.parentNode.insertBefore(errEl, zone.nextSibling);
    }
    errEl.textContent = msg;
    setTimeout(() => { if (errEl.parentNode) errEl.remove(); }, 5000);
  };

  // ─── HTML builder ────────────────────────────────────────────────────────
  function _fileItemHTML(entry, progress) {
    const icon       = fileIcon(entry.file.name);
    const sizeStr    = formatBytes(entry.file.size);
    const statusText = _statusText(entry);
    const statusCls  = 'dpu-status-' + entry.status;
    const pct        = typeof progress === 'number' ? progress : 0;
    const showBar    = entry.status === 'uploading' || entry.status === 'waiting';
    const canRemove  = entry.status !== 'uploading';

    return `
      <div class="dpu-file-icon">${icon}</div>
      <div class="dpu-file-info">
        <div class="dpu-file-name" title="${escape(entry.file.name)}">${entry.file.name}</div>
        <div class="dpu-file-size">${sizeStr}</div>
        <div class="dpu-file-status ${statusCls}">${statusText}</div>
        ${showBar ? `<div class="dpu-progress-bar"><div class="dpu-progress-fill" style="width:${pct}%"></div></div>` : ''}
      </div>
      ${canRemove ? `
        <button type="button" class="dpu-remove-btn" id="dpu-rm-${entry.id}"
                aria-label="Remove ${escape(entry.file.name)}" title="Remove">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>` : '<div></div>'}
    `;
  }

  function _statusText(entry) {
    switch (entry.status) {
      case 'waiting':   return 'Waiting to upload…';
      case 'uploading': return 'Uploading…';
      case 'done':      return '✓ Uploaded successfully';
      case 'error':     return '✗ ' + (entry.error || 'Upload failed');
      default:          return '';
    }
  }

  // ─── Utilities ───────────────────────────────────────────────────────────
  function fileIcon(name) {
    const ext = name.toLowerCase().split('.').pop();
    const icons = {
      pdf: '📄', jpg: '🖼️', jpeg: '🖼️', png: '🖼️',
      ai: '🎨', eps: '🎨', psd: '🎨',
    };
    return icons[ext] || '📎';
  }

  function formatBytes(bytes) {
    if (bytes < 1024)           return bytes + ' B';
    if (bytes < 1024 * 1024)   return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function escape(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  let _counter = 0;
  function uniqueId() { return 'f' + Date.now() + (++_counter); }

  // ─── Expose globally ─────────────────────────────────────────────────────
  window.DivinePrintingUpload = DivinePrintingUpload;

  // ─── Auto-init if data attribute present ─────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    const autoZone = document.querySelector('[data-dpu-auto]');
    if (autoZone) {
      DivinePrintingUpload.init(autoZone.id, {
        apiUrl:  autoZone.dataset.dpuApiUrl  || window.UPLOAD_API_URL || API_UPLOAD_URL,
        orderId: autoZone.dataset.dpuOrderId || null,
      });
    }
  });

})();
