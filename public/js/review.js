/* ═══════════════════════════════════════════════════════
   Review Page — Browse recordings with filters
   ═══════════════════════════════════════════════════════ */

window.reviewPage = (() => {
  let currentOffset = 0;
  const pageSize = 20;
  let totalRecordings = 0;

  // DOM refs
  const $ = (id) => document.getElementById(id);

  function init() {
    $('filter-category').addEventListener('change', () => {
      currentOffset = 0;
      loadRecordings();
    });

    $('btn-prev-page').addEventListener('click', () => {
      currentOffset = Math.max(0, currentOffset - pageSize);
      loadRecordings();
    });

    $('btn-next-page').addEventListener('click', () => {
      currentOffset += pageSize;
      loadRecordings();
    });

    $('detail-modal-close').addEventListener('click', closeDetail);
    $('detail-modal-backdrop').addEventListener('click', closeDetail);
  }

  async function loadRecordings() {
    const list = $('recording-list');
    list.innerHTML = buildSkeletons(5);

    try {
      const category = $('filter-category').value;
      const data = await api.listRecordings({
        category: category || undefined,
        limit: pageSize,
        offset: currentOffset,
      });

      totalRecordings = data.total;
      $('review-total-count').textContent = `${totalRecordings} recording${totalRecordings !== 1 ? 's' : ''} total`;

      if (data.recordings.length === 0) {
        list.innerHTML = `
          <div class="empty-state">
            <div class="empty-state__icon">🎙️</div>
            <div class="empty-state__title">No recordings yet</div>
            <div class="empty-state__desc">Start a capture session to begin collecting audio data.</div>
          </div>`;
        updatePagination();
        return;
      }

      list.innerHTML = '';
      data.recordings.forEach(rec => {
        list.appendChild(buildRecordingItem(rec));
      });

      updatePagination();
    } catch (err) {
      console.error('Load recordings error:', err);
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">⚠️</div>
          <div class="empty-state__title">Failed to load</div>
          <div class="empty-state__desc">${err.message}</div>
        </div>`;
    }
  }

  function buildRecordingItem(rec) {
    const item = document.createElement('div');
    item.className = 'recording-item';
    item.addEventListener('click', () => openDetail(rec.id));

    const duration = rec.duration_ms ? formatDuration(rec.duration_ms) : '—';
    const date = rec.created_at ? formatDate(rec.created_at) : '—';
    const size = rec.file_size_bytes ? formatBytes(rec.file_size_bytes) : '—';
    const category = rec.prompt_category || '—';
    const badgeColor = getCategoryColor(category);

    item.innerHTML = `
      <button class="recording-item__play" title="Details">📄</button>
      <div class="recording-item__info">
        <div class="recording-item__prompt">${escHtml(rec.prompt_text_snapshot || '—')}</div>
        <div class="recording-item__meta">
          <span>${date}</span>
          <span class="recording-item__meta-separator"></span>
          <span>${size}</span>
        </div>
      </div>
      <div class="recording-item__tags">
        <span class="badge badge--${badgeColor}">${formatCategory(category)}</span>
      </div>
      <span class="recording-item__duration">${duration}</span>
    `;

    return item;
  }

  async function openDetail(id) {
    try {
      const rec = await api.getRecording(id);
      renderDetail(rec);
      $('detail-modal').classList.add('visible');
    } catch (err) {
      toast.error(`Failed to load detail: ${err.message}`);
    }
  }

  function closeDetail() {
    $('detail-modal').classList.remove('visible');
  }

  function renderDetail(rec) {
    const body = $('detail-modal-body');

    body.innerHTML = `
      <div>
        <div class="detail-section__title">Prompt</div>
        <p style="color: var(--cc-text-primary); font-size: var(--cc-text-base);">${escHtml(rec.prompt_text_snapshot || rec.prompt_text || '—')}</p>
        <div style="margin-top: 8px;">
          <span class="badge badge--${getCategoryColor(rec.prompt_category)}">${formatCategory(rec.prompt_category)}</span>
          <span class="badge badge--muted">${rec.capture_status || 'uploaded'}</span>
        </div>
      </div>

      <div>
        <div class="detail-section__title">Recording</div>
        <div class="detail-grid">
          <div class="detail-field">
            <span class="detail-field__label">Duration</span>
            <span class="detail-field__value">${rec.duration_ms ? (rec.duration_ms / 1000).toFixed(1) + 's' : '—'}</span>
          </div>
          <div class="detail-field">
            <span class="detail-field__label">File Size</span>
            <span class="detail-field__value">${formatBytes(rec.file_size_bytes)}</span>
          </div>
          <div class="detail-field">
            <span class="detail-field__label">Content Type</span>
            <span class="detail-field__value">${rec.content_type || '—'}</span>
          </div>
          <div class="detail-field">
            <span class="detail-field__label">Sample Rate</span>
            <span class="detail-field__value">${rec.audio_context_sample_rate ? rec.audio_context_sample_rate + ' Hz' : '—'}</span>
          </div>
        </div>
      </div>

      <div>
        <div class="detail-section__title">Location</div>
        <div class="detail-grid">
          <div class="detail-field">
            <span class="detail-field__label">Latitude</span>
            <span class="detail-field__value">${fmtNum(rec.location_lat, 6)}</span>
          </div>
          <div class="detail-field">
            <span class="detail-field__label">Longitude</span>
            <span class="detail-field__value">${fmtNum(rec.location_lon, 6)}</span>
          </div>
          <div class="detail-field">
            <span class="detail-field__label">Speed</span>
            <span class="detail-field__value">${rec.location_speed != null ? (rec.location_speed * 2.237).toFixed(1) + ' mph' : '—'}</span>
          </div>
          <div class="detail-field">
            <span class="detail-field__label">Accuracy</span>
            <span class="detail-field__value">${rec.location_accuracy != null ? rec.location_accuracy.toFixed(0) + ' m' : '—'}</span>
          </div>
        </div>
      </div>

      <div>
        <div class="detail-section__title">Motion Sensors</div>
        <div class="detail-grid">
          <div class="detail-field">
            <span class="detail-field__label">Accel X/Y/Z</span>
            <span class="detail-field__value">${fmtVec(rec.motion_accel_x, rec.motion_accel_y, rec.motion_accel_z)}</span>
          </div>
          <div class="detail-field">
            <span class="detail-field__label">Orientation α/β/γ</span>
            <span class="detail-field__value">${fmtVec(rec.orientation_alpha, rec.orientation_beta, rec.orientation_gamma)}</span>
          </div>
          <div class="detail-field">
            <span class="detail-field__label">Compass</span>
            <span class="detail-field__value">${rec.compass_heading != null ? rec.compass_heading.toFixed(0) + '°' : '—'}</span>
          </div>
          <div class="detail-field">
            <span class="detail-field__label">Screen Orientation</span>
            <span class="detail-field__value">${rec.screen_orientation_type || '—'}</span>
          </div>
        </div>
      </div>

      <div>
        <div class="detail-section__title">Timestamps</div>
        <div class="detail-grid">
          <div class="detail-field">
            <span class="detail-field__label">Captured</span>
            <span class="detail-field__value">${formatDateTime(rec.capture_started_at)}</span>
          </div>
          <div class="detail-field">
            <span class="detail-field__label">Uploaded</span>
            <span class="detail-field__value">${formatDateTime(rec.upload_completed_at)}</span>
          </div>
        </div>
      </div>

      <div>
        <div class="detail-section__title">Storage</div>
        <div class="detail-field">
          <span class="detail-field__label">Object Key</span>
          <span class="detail-field__value" style="word-break: break-all;">${escHtml(rec.object_key || '—')}</span>
        </div>
      </div>
    `;
  }

  function updatePagination() {
    const start = currentOffset + 1;
    const end = Math.min(currentOffset + pageSize, totalRecordings);
    $('pagination-info').textContent = totalRecordings > 0 ? `${start}–${end} of ${totalRecordings}` : 'No results';
    $('btn-prev-page').disabled = currentOffset === 0;
    $('btn-next-page').disabled = currentOffset + pageSize >= totalRecordings;
  }

  function buildSkeletons(count) {
    let html = '';
    for (let i = 0; i < count; i++) {
      html += `
        <div class="recording-item" style="pointer-events:none;">
          <div class="skeleton" style="width:40px;height:40px;border-radius:50%;"></div>
          <div style="flex:1;display:flex;flex-direction:column;gap:6px;">
            <div class="skeleton" style="width:70%;height:14px;"></div>
            <div class="skeleton" style="width:40%;height:10px;"></div>
          </div>
          <div class="skeleton" style="width:60px;height:20px;border-radius:999px;"></div>
          <div class="skeleton" style="width:40px;height:14px;"></div>
        </div>`;
    }
    return html;
  }

  // ── Helpers ────────────────────────────────────────
  function formatDuration(ms) {
    const s = Math.round(ms / 1000);
    return `${s}s`;
  }

  function formatBytes(bytes) {
    if (bytes == null) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function formatCategory(cat) {
    if (!cat) return '—';
    return cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function getCategoryColor(cat) {
    const map = {
      free_form: 'blue', task_oriented: 'green', short_command: 'amber',
      hard_transcription: 'red', read_speech: 'violet', turn_taking: 'muted',
    };
    return map[cat] || 'muted';
  }

  function fmtNum(val, decimals = 2) {
    return val != null ? Number(val).toFixed(decimals) : '—';
  }

  function fmtVec(x, y, z) {
    if (x == null && y == null && z == null) return '—';
    return `${fmtNum(x, 1)}, ${fmtNum(y, 1)}, ${fmtNum(z, 1)}`;
  }

  function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return { init, loadRecordings };
})();
