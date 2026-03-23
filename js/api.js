// AKB Salon — 前端 API 服務層 v2
// 後端可用時使用 REST + WebSocket；後端不可用時自動降級 localStorage

const API_BASE = 'http://localhost:3001/api';
const WS_URL   = 'ws://localhost:3001';

class SalonAPI {
  constructor() {
    this.isOnline    = false;
    this.listeners   = new Map();
    this.ws          = null;
    this._wsRetryMs  = 5000;
    setTimeout(() => this._wsConnect(), 800);
  }

  // ── WebSocket ─────────────────────────────────────
  _wsConnect() {
    try {
      this.ws = new WebSocket(WS_URL);
      this.ws.onopen    = () => { this.isOnline = true;  console.log('[API] WS connected'); };
      this.ws.onclose   = () => { this.isOnline = false; setTimeout(() => this._wsConnect(), this._wsRetryMs); };
      this.ws.onerror   = () => { this.isOnline = false; };
      this.ws.onmessage = (e) => {
        try { this._dispatch(JSON.parse(e.data)); } catch(_) {}
      };
    } catch(_) { this.isOnline = false; }
  }

  _dispatch({ type, data }) {
    (this.listeners.get(type) || []).forEach(cb => cb(data));
    (this.listeners.get('*')   || []).forEach(cb => cb({ type, data }));
  }

  on(type, cb) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(cb);
    return () => this.off(type, cb);
  }
  off(type, cb) {
    const arr = this.listeners.get(type) || [];
    const i = arr.indexOf(cb);
    if (i > -1) arr.splice(i, 1);
  }

  // ── HTTP 核心（3 秒超時，失敗拋錯） ───────────────
  async req(path, opts = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    try {
      const res = await fetch(API_BASE + path, {
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        ...opts
      });
      clearTimeout(t);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      this.isOnline = true;
      return res.json();
    } catch (err) {
      clearTimeout(t);
      this.isOnline = false;
      throw err;
    }
  }

  get(path)            { return this.req(path); }
  post(path, data)     { return this.req(path, { method: 'POST',   body: JSON.stringify(data) }); }
  patch(path, data)    { return this.req(path, { method: 'PATCH',  body: JSON.stringify(data) }); }
  del(path)            { return this.req(path, { method: 'DELETE' }); }

  // ── 健康檢查 ───────────────────────────────────────
  health() { return this.get('/health'); }

  // ── 預約 ──────────────────────────────────────────
  getBookings(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get('/bookings' + (qs ? '?' + qs : ''));
  }
  getBooking(id)          { return this.get(`/bookings/${id}`); }
  createBooking(data)     { return this.post('/bookings', data); }
  updateBooking(id, data) { return this.patch(`/bookings/${id}`, data); }
  deleteBooking(id)       { return this.del(`/bookings/${id}`); }

  // ── 設計師 ────────────────────────────────────────
  getDesigners(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get('/designers' + (qs ? '?' + qs : ''));
  }
  getDesigner(id)          { return this.get(`/designers/${id}`); }
  createDesigner(data)     { return this.post('/designers', data); }
  updateDesigner(id, data) { return this.patch(`/designers/${id}`, data); }
  deleteDesigner(id)       { return this.del(`/designers/${id}`); }

  // ── 服務項目 ──────────────────────────────────────
  getServices()              { return this.get('/services'); }
  createService(data)        { return this.post('/services', data); }
  updateService(id, data)    { return this.patch(`/services/${id}`, data); }
  deleteService(id)          { return this.del(`/services/${id}`); }

  // ── 客戶 ──────────────────────────────────────────
  getCustomers() { return this.get('/customers'); }

  // ── 統計 ──────────────────────────────────────────
  getStats() { return this.get('/stats'); }

  // ── 認證 ──────────────────────────────────────────
  login(username, password) {
    return this.post('/auth/login', { username, password });
  }
  changePassword(username, currentPassword, newPassword) {
    return this.patch('/auth/password', { username, currentPassword, newPassword });
  }

  // ── 客戶帳號 ──────────────────────────────────────
  saveClientAccount(phone, data) { return this.post(`/accounts/${phone}`, data); }
}

// 全域單例
const salonAPI = new SalonAPI();

// ── localStorage 降級工具函數 ────────────────────────
const LS = {
  BOOKINGS:  'akb_bookings_data',
  BOOKINGS2: 'akb_client_bookings',
  DESIGNERS: 'akb_designers',
  SERVICES:  'akb_services',
  ACCOUNTS:  'akb_auth_config',

  get(key)        { try { return JSON.parse(localStorage.getItem(key)); } catch(_) { return null; } },
  set(key, val)   { localStorage.setItem(key, JSON.stringify(val)); },
  getBookings()   { return this.get(this.BOOKINGS) || this.get(this.BOOKINGS2) || []; },
  setBookings(v)  { this.set(this.BOOKINGS, v); this.set(this.BOOKINGS2, v); },
  getDesigners()  { return this.get(this.DESIGNERS); },
  getServices()   { return this.get(this.SERVICES); },
};
