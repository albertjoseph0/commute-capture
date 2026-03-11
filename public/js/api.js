/* ═══════════════════════════════════════════════════════
   API Client — Thin wrapper around fetch for all v1 endpoints
   ═══════════════════════════════════════════════════════ */

const API_BASE = '/v1';

window.api = {
  /* ── Commutes ────────────────────────────────────── */
  async startCommute(body) {
    const res = await fetch(`${API_BASE}/commutes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await api._err(res);
    return res.json();
  },

  async getCommute(id) {
    const res = await fetch(`${API_BASE}/commutes/${id}`);
    if (!res.ok) throw await api._err(res);
    return res.json();
  },

  async endCommute(id) {
    const res = await fetch(`${API_BASE}/commutes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ended' }),
    });
    if (!res.ok) throw await api._err(res);
    return res.json();
  },

  /* ── Uploads ─────────────────────────────────────── */
  async getUploadUrl(body) {
    const res = await fetch(`${API_BASE}/uploads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await api._err(res);
    return res.json();
  },

  /* ── Recordings ──────────────────────────────────── */
  async createRecording(body) {
    const res = await fetch(`${API_BASE}/recordings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await api._err(res);
    return res.json();
  },

  async listRecordings(params = {}) {
    const qs = new URLSearchParams();
    if (params.commute_id) qs.set('commute_id', params.commute_id);
    if (params.category) qs.set('category', params.category);
    if (params.limit) qs.set('limit', params.limit);
    if (params.offset) qs.set('offset', params.offset);
    const res = await fetch(`${API_BASE}/recordings?${qs}`);
    if (!res.ok) throw await api._err(res);
    return res.json();
  },

  async getRecording(id) {
    const res = await fetch(`${API_BASE}/recordings/${id}`);
    if (!res.ok) throw await api._err(res);
    return res.json();
  },

  /* ── Prompts ─────────────────────────────────────── */
  async listPrompts(params = {}) {
    const qs = new URLSearchParams();
    if (params.active !== undefined) qs.set('active', params.active);
    const res = await fetch(`${API_BASE}/prompts?${qs}`);
    if (!res.ok) throw await api._err(res);
    return res.json();
  },

  async getCoverage() {
    const res = await fetch(`${API_BASE}/prompts/coverage`);
    if (!res.ok) throw await api._err(res);
    return res.json();
  },

  /* ── Helpers ─────────────────────────────────────── */
  async _err(res) {
    try {
      const data = await res.json();
      return new Error(data.error || `HTTP ${res.status}`);
    } catch {
      return new Error(`HTTP ${res.status}`);
    }
  },
};
