// ============================================================
// AKB Salon — 統一數據庫層
// 後端：Node/Express REST API + WebSocket 實時推送
// 回退：localStorage（後端不可用時）
// ============================================================

// ── 後端伺服器地址（部署時修改此處）────────────────────────
// 本地開發: 'http://localhost:3001'
// 生產環境: 換成你的 Railway / Render / VPS 地址
const API_BASE = (() => {
  // 若 window.AKB_API_URL 有設定（可在各 HTML 頁面頂部覆蓋），優先使用
  if (typeof window !== 'undefined' && window.AKB_API_URL) return window.AKB_API_URL;
  // 其次嘗試同域 /api（適合 nginx 反代場景）
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    // GitHub Pages 靜態站：嘗試環境變數配置的後端
    return window.AKB_API_URL || null;
  }
  return 'http://localhost:3001';
})();

const WS_BASE = (() => {
  if (typeof window !== 'undefined' && window.AKB_WS_URL) return window.AKB_WS_URL;
  if (API_BASE && API_BASE.startsWith('http')) {
    return API_BASE.replace(/^http/, 'ws');
  }
  return null;
})();

// ── 預設資料 ─────────────────────────────────────────────────
const DEFAULT_DESIGNERS = [
  { id: 1, name: 'Aika',  role: '首席設計師', level: 'A', specialty: ['染髮','挑染','音樂造型'],  bio: '擅長韓系潮流色彩，10年經驗', avatar: 'A', rating: 4.9, reviews: 142, works: 320, available: true,  status: 'active' },
  { id: 2, name: 'Ken',   role: '資深設計師', level: 'B', specialty: ['燙髮','護髮','男士剪髮'],  bio: '韓式小臉燙&歐美捲專家，留學首爾5年', avatar: 'K', rating: 4.8, reviews: 98,  works: 215, available: true,  status: 'active' },
  { id: 3, name: 'Bella', role: '設計師',     level: 'C', specialty: ['剪髮','頭皮SPA','護髮'],   bio: '輕柔手法，細心聆聽每位客人需求', avatar: 'B', rating: 4.7, reviews: 63,  works: 140, available: true,  status: 'active' },
  { id: 4, name: 'Jay',   role: '資深設計師', level: 'B', specialty: ['染髮','新娘造型','特殊'],  bio: '婚禮造型達人，已完成超過200組新娘', avatar: 'J', rating: 4.9, reviews: 117, works: 278, available: false, status: 'active' },
  { id: 5, name: 'Mia',   role: '設計師',     level: 'C', specialty: ['剪髮','燙髮','頭皮SPA'],   bio: '活潑開朗，擅長溝通，讓你放鬆享受', avatar: 'M', rating: 4.6, reviews: 45,  works: 98,  available: true,  status: 'active' },
];

const DEFAULT_SERVICES = [
  { id: 1,  name: '洗剪吹',     category: '基礎', price: 128, duration: 60,  description: '洗髮 + 剪髮 + 吹造型' },
  { id: 2,  name: '單剪',       category: '基礎', price: 68,  duration: 30,  description: '純剪髮造型' },
  { id: 3,  name: '洗吹',       category: '基礎', price: 88,  duration: 45,  description: '洗髮 + 吹造型' },
  { id: 4,  name: '彩色染髮',   category: '染髮', price: 168, duration: 90,  description: '時尚彩色染髮' },
  { id: 5,  name: '電髮',       category: '燙髮', price: 268, duration: 120, description: '多種燙髮技術，打造理想捲度' },
  { id: 6,  name: '顏色焗油',   category: '護理', price: 228, duration: 60,  description: '色彩焗油護理' },
  { id: 7,  name: '水療焗油',   category: '護理', price: 188, duration: 60,  description: '深層水療護髮' },
  { id: 8,  name: '陶瓷數碼曲', category: '燙髮', price: 358, duration: 150, description: '陶瓷數碼燙髮技術' },
  { id: 9,  name: '技術染髮',   category: '染髮', price: 228, duration: 120, description: '專業技術染色' },
  { id: 10, name: '負離子直髮', category: '燙髮', price: 228, duration: 120, description: '離子燙直髮' },
];

// ── localStorage 快取 ───────────────────────────────────────
const CACHE = {
  BOOKINGS:  'akb_bookings_data',
  BOOKINGS2: 'salonBookings',
  DESIGNERS: 'akb_designers_data',
  SERVICES:  'akb_services_data',
  ACCOUNTS:  'akb_accounts',
  get(key)       { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, val)  { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} },
  remove(key)    { try { localStorage.removeItem(key); } catch {} },
};

// ── EventBus（頁面內事件匯流排）────────────────────────────
const EventBus = {
  _handlers: {},
  on(evt, fn)   { (this._handlers[evt] = this._handlers[evt] || []).push(fn); },
  off(evt, fn)  { this._handlers[evt] = (this._handlers[evt] || []).filter(h => h !== fn); },
  emit(evt, d)  { (this._handlers[evt] || []).forEach(fn => { try { fn(d); } catch(e) { console.warn('EventBus error:', e); } }); },
};

// ── WebSocket 管理 ──────────────────────────────────────────
const WS = {
  _ws:           null,
  _reconnectTimer: null,
  _listeners:    [],          // { eventType, table, callback }
  _connected:    false,
  _reconnectDelay: 3000,
  _reconnectAttempts: 0,

  connect() {
    if (!WS_BASE) {
      console.info('[DB] 未設定後端地址，跳過 WebSocket 連線（使用 localStorage 模式）');
      return;
    }
    if (this._ws && (this._ws.readyState === WebSocket.CONNECTING || this._ws.readyState === WebSocket.OPEN)) return;

    try {
      this._ws = new WebSocket(WS_BASE);

      this._ws.onopen = () => {
        this._connected = true;
        this._reconnectAttempts = 0; // 重置重試計數
        this._reconnectDelay = 3000;
        console.info('[DB] WebSocket 已連線');
        clearTimeout(this._reconnectTimer);
        EventBus.emit('ws_connected', {});
      };

      this._ws.onmessage = ({ data }) => {
        try {
          const msg = JSON.parse(data);
          this._dispatch(msg);
        } catch(e) { console.warn('[DB] WS 解析失敗:', e); }
      };

      this._ws.onerror = (e) => {
        console.warn('[DB] WebSocket 錯誤');
      };

      this._ws.onclose = () => {
        this._connected = false;
        // 指數退避：3s → 6s → 12s → 24s → 最大 60s
        this._reconnectAttempts++;
        this._reconnectDelay = Math.min(3000 * Math.pow(2, this._reconnectAttempts - 1), 60000);
        console.info('[DB] WebSocket 已斷線，將在', this._reconnectDelay / 1000, '秒後重連... (第', this._reconnectAttempts, '次)');
        EventBus.emit('ws_disconnected', {});
        this._reconnectTimer = setTimeout(() => this.connect(), this._reconnectDelay);
      };
    } catch(e) {
      console.warn('[DB] WebSocket 初始化失敗:', e.message);
    }
  },

  _dispatch(msg) {
    // msg.type: INIT | NEW_BOOKING | UPDATE_BOOKING | DELETE_BOOKING | NEW_DESIGNER | UPDATE_DESIGNER | UPDATE_SERVICES
    const type = msg.type;
    const data = msg.data;

    if (type === 'INIT') {
      // 伺服器推送完整快照，更新快取
      if (data.bookings)  { CACHE.set(CACHE.BOOKINGS, data.bookings); CACHE.set(CACHE.BOOKINGS2, data.bookings); }
      if (data.designers) { CACHE.set(CACHE.DESIGNERS, data.designers); }
      if (data.services)  { CACHE.set(CACHE.SERVICES,  data.services); }
      EventBus.emit('INIT', data);
      return;
    }

    // 局部更新快取
    if (type === 'NEW_BOOKING') {
      const list = CACHE.get(CACHE.BOOKINGS) || [];
      list.unshift(data);
      CACHE.set(CACHE.BOOKINGS, list); CACHE.set(CACHE.BOOKINGS2, list);
      EventBus.emit('NEW_BOOKING', data);
    } else if (type === 'UPDATE_BOOKING') {
      _patchCacheBooking(data);
      EventBus.emit('UPDATE_BOOKING', data);
    } else if (type === 'DELETE_BOOKING') {
      _deleteCacheBooking(data.id);
      EventBus.emit('DELETE_BOOKING', data);
    } else if (type === 'NEW_DESIGNER' || type === 'UPDATE_DESIGNER') {
      _patchCacheDesigner(data);
      EventBus.emit(type, data);
    } else if (type === 'UPDATE_SERVICES') {
      CACHE.set(CACHE.SERVICES, Array.isArray(data) ? data : []);
      EventBus.emit('UPDATE_SERVICES', data);
    } else if (type === 'UPDATE_ACCOUNT') {
      EventBus.emit('UPDATE_ACCOUNT', data);
    }

    // 通知所有對應的訂閱回調
    this._listeners.forEach(l => {
      if (!l.eventType || l.eventType === type || l.eventType === '*') {
        try { l.callback({ eventType: type, data }); } catch(e) {}
      }
    });
  },

  subscribe(eventType, callback) {
    const listener = { eventType, callback };
    this._listeners.push(listener);
    return () => { this._listeners = this._listeners.filter(l => l !== listener); };
  },

  isConnected() { return this._connected; },
};

// ── 快取輔助函數 ────────────────────────────────────────────
function _patchCacheBooking(b) {
  for (const key of [CACHE.BOOKINGS, CACHE.BOOKINGS2]) {
    const list = CACHE.get(key) || [];
    const idx  = list.findIndex(x => String(x.id) === String(b.id));
    if (idx > -1) list[idx] = b; else list.unshift(b);
    CACHE.set(key, list);
  }
}

function _deleteCacheBooking(id) {
  for (const key of [CACHE.BOOKINGS, CACHE.BOOKINGS2]) {
    const list = (CACHE.get(key) || []).filter(x => String(x.id) !== String(id));
    CACHE.set(key, list);
  }
}

function _patchCacheDesigner(d) {
  const list = CACHE.get(CACHE.DESIGNERS) || DEFAULT_DESIGNERS;
  const idx  = list.findIndex(x => x.id === d.id);
  if (idx > -1) list[idx] = d; else list.push(d);
  CACHE.set(CACHE.DESIGNERS, list);
}

// ── HTTP 請求輔助 ────────────────────────────────────────────
// 快取 TTL（毫秒）：設計師和服務項目在短時間內重複請求時直接用快取
const CACHE_TTL = {
  designers: 30 * 1000,  // 30 秒
  services:  60 * 1000,  // 60 秒
};
const _cacheMeta = {};

async function apiRequest(method, path, body) {
  if (!API_BASE) throw new Error('未設定後端地址');
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip' },
  };
  if (body) opts.body = JSON.stringify(body);
  // 15 秒超時（兼容 Render 免費層冷啟動）
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  opts.signal = ctrl.signal;
  try {
    const res = await fetch(`${API_BASE}${path}`, opts);
    clearTimeout(timer);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  } catch(e) {
    clearTimeout(timer);
    throw e;
  }
}

// ── 主 DB 物件 ───────────────────────────────────────────────
const DB = {

  // ── 初始化（建立 WS 連線 + 定期心跳防止 Render sleep）─────
  init() {
    WS.connect();
    // 每 4 分鐘 ping 後端，防止 Render 免費層進入 sleep（免費層閒置 5 分鐘後會休眠）
    if (API_BASE) {
      setInterval(async () => {
        try {
          await fetch(`${API_BASE}/api/health`);
        } catch(e) { /* silent */ }
      }, 4 * 60 * 1000); // 4 minutes
    }
  },

  // ── 預約管理 ──────────────────────────────────────────────

  async getBookings(params = {}) {
    try {
      const qs = Object.keys(params).length
        ? '?' + new URLSearchParams(params).toString()
        : '';
      const data = await apiRequest('GET', '/api/bookings' + qs);
      // 只有拉全量時才更新快取
      if (!qs) {
        CACHE.set(CACHE.BOOKINGS,  data);
        CACHE.set(CACHE.BOOKINGS2, data);
      }
      return data;
    } catch(e) {
      console.warn('[DB] getBookings 降級:', e.message);
      const cached = CACHE.get(CACHE.BOOKINGS) || CACHE.get(CACHE.BOOKINGS2) || [];
      // 若有篩選條件，在客戶端過濾
      if (params.date) return cached.filter(b => b.date === params.date);
      return cached;
    }
  },

  async createBooking(booking) {
    const record = {
      serviceId:      booking.serviceId    || null,
      serviceName:    booking.serviceName  || '',
      designerId:     booking.designerId   || null,
      designerName:   booking.designerName || '',
      date:           booking.date         || '',
      time:           booking.time         || '',
      customerName:   booking.name         || booking.customerName  || '',
      customerPhone:  booking.phone        || booking.customerPhone || '',
      customerEmail:  booking.email        || booking.customerEmail || '',
      note:           booking.note         || '',
      price:          Number(booking.price)    || 0,
      duration:       Number(booking.duration) || 60,
      isRandom:       booking.isRandom     || false,
    };
    try {
      const nb = await apiRequest('POST', '/api/bookings', record);
      const list = CACHE.get(CACHE.BOOKINGS) || [];
      list.unshift(nb);
      CACHE.set(CACHE.BOOKINGS,  list);
      CACHE.set(CACHE.BOOKINGS2, list);
      EventBus.emit('booking_created', nb);
      return nb;
    } catch(e) {
      console.warn('[DB] createBooking 降級:', e.message);
      // 本地回退
      const nb = { ...record, id: 'local_' + Date.now(), status: 'pending', createdAt: Date.now() };
      const list = CACHE.get(CACHE.BOOKINGS) || [];
      list.unshift(nb);
      CACHE.set(CACHE.BOOKINGS,  list);
      CACHE.set(CACHE.BOOKINGS2, list);
      EventBus.emit('booking_created', nb);
      return nb;
    }
  },

  async updateBookingStatus(id, status) {
    try {
      const nb = await apiRequest('PATCH', `/api/bookings/${id}`, { status });
      _patchCacheBooking(nb);
      EventBus.emit('booking_updated', nb);
      return nb;
    } catch(e) {
      console.warn('[DB] updateBookingStatus 降級:', e.message);
      return this._localUpdateStatus(id, status);
    }
  },

  async cancelBooking(id) {
    return this.updateBookingStatus(id, 'cancelled');
  },

  async deleteBooking(id) {
    try {
      await apiRequest('DELETE', `/api/bookings/${id}`);
    } catch(e) {
      console.warn('[DB] deleteBooking API failed:', e.message);
      // Even if API fails, clean local cache
    }
    // Always remove from local cache
    for (const key of [CACHE.BOOKINGS, CACHE.BOOKINGS2]) {
      const list = (CACHE.get(key) || []).filter(b => String(b.id) !== String(id));
      CACHE.set(key, list);
    }
    EventBus.emit('booking_deleted', { id });
  },

  _localUpdateStatus(id, status) {
    for (const key of [CACHE.BOOKINGS, CACHE.BOOKINGS2]) {
      const list = CACHE.get(key) || [];
      const idx  = list.findIndex(b => String(b.id) === String(id));
      if (idx > -1) {
        list[idx] = { ...list[idx], status, updatedAt: Date.now() };
        CACHE.set(key, list);
        EventBus.emit('booking_updated', list[idx]);
        return list[idx];
      }
    }
    return null;
  },

  // ── 設計師管理 ────────────────────────────────────────────

  async getDesigners() {
    // TTL 快取：30 秒內重複請求直接用記憶體，不打後端
    const now = Date.now();
    if (_cacheMeta.designers && now - _cacheMeta.designers < CACHE_TTL.designers) {
      const cached = CACHE.get(CACHE.DESIGNERS);
      if (cached && cached.length) return cached;
    }
    try {
      const data = await apiRequest('GET', '/api/designers');
      CACHE.set(CACHE.DESIGNERS, data);
      _cacheMeta.designers = Date.now();
      return data;
    } catch(e) {
      console.warn('[DB] getDesigners 降級:', e.message);
      return CACHE.get(CACHE.DESIGNERS) || DEFAULT_DESIGNERS;
    }
  },

  async updateDesigner(id, updates) {
    try {
      const nd = await apiRequest('PATCH', `/api/designers/${id}`, updates);
      _patchCacheDesigner(nd);
      EventBus.emit('designer_updated', nd);
      return nd;
    } catch(e) {
      console.warn('[DB] updateDesigner 降級:', e.message);
      const list = CACHE.get(CACHE.DESIGNERS) || DEFAULT_DESIGNERS;
      const idx  = list.findIndex(d => d.id === id);
      if (idx > -1) { list[idx] = { ...list[idx], ...updates }; CACHE.set(CACHE.DESIGNERS, list); }
      return list[idx] || null;
    }
  },

  async createDesigner(data) {
    try {
      const nd = await apiRequest('POST', '/api/designers', data);
      _patchCacheDesigner(nd);
      return nd;
    } catch(e) {
      console.warn('[DB] createDesigner 降級:', e.message);
      const list = CACHE.get(CACHE.DESIGNERS) || DEFAULT_DESIGNERS;
      const nd   = { ...data, id: Math.max(...list.map(d => d.id), 0) + 1, status: 'active', available: true };
      list.push(nd);
      CACHE.set(CACHE.DESIGNERS, list);
      return nd;
    }
  },

  // ── 服務管理 ──────────────────────────────────────────────

  async getServices() {
    // TTL 快取：60 秒內重複請求直接用記憶體
    const now = Date.now();
    if (_cacheMeta.services && now - _cacheMeta.services < CACHE_TTL.services) {
      const cached = CACHE.get(CACHE.SERVICES);
      if (cached && cached.length) return cached;
    }
    try {
      const data = await apiRequest('GET', '/api/services');
      CACHE.set(CACHE.SERVICES, data);
      _cacheMeta.services = Date.now();
      return data;
    } catch(e) {
      console.warn('[DB] getServices 降級:', e.message);
      return CACHE.get(CACHE.SERVICES) || DEFAULT_SERVICES;
    }
  },

  async createService(data) {
    try {
      const ns = await apiRequest('POST', '/api/services', data);
      const list = CACHE.get(CACHE.SERVICES) || DEFAULT_SERVICES;
      list.push(ns);
      CACHE.set(CACHE.SERVICES, list);
      return ns;
    } catch(e) {
      console.warn('[DB] createService 降級:', e.message);
      const list = CACHE.get(CACHE.SERVICES) || DEFAULT_SERVICES;
      const ns   = { ...data, id: Math.max(...list.map(s => s.id), 0) + 1 };
      list.push(ns);
      CACHE.set(CACHE.SERVICES, list);
      return ns;
    }
  },

  async updateService(id, updates) {
    try {
      const ns = await apiRequest('PATCH', `/api/services/${id}`, updates);
      const list = CACHE.get(CACHE.SERVICES) || DEFAULT_SERVICES;
      const idx  = list.findIndex(s => s.id === id);
      if (idx > -1) { list[idx] = ns; CACHE.set(CACHE.SERVICES, list); }
      return ns;
    } catch(e) {
      console.warn('[DB] updateService 降級:', e.message);
      const list = CACHE.get(CACHE.SERVICES) || DEFAULT_SERVICES;
      const idx  = list.findIndex(s => s.id === id);
      if (idx > -1) { list[idx] = { ...list[idx], ...updates }; CACHE.set(CACHE.SERVICES, list); }
      return list[idx] || null;
    }
  },

  async deleteService(id) {
    try {
      await apiRequest('DELETE', `/api/services/${id}`);
      const list = (CACHE.get(CACHE.SERVICES) || []).filter(s => s.id !== id);
      CACHE.set(CACHE.SERVICES, list);
    } catch(e) {
      console.warn('[DB] deleteService 降級:', e.message);
      const list = (CACHE.get(CACHE.SERVICES) || []).filter(s => s.id !== id);
      CACHE.set(CACHE.SERVICES, list);
    }
  },

  // ── 客戶管理 ──────────────────────────────────────────────

  async getCustomers() {
    try {
      return await apiRequest('GET', '/api/customers');
    } catch(e) {
      console.warn('[DB] getCustomers 降級:', e.message);
      // 從本地 bookings 推導
      const bookings = CACHE.get(CACHE.BOOKINGS) || [];
      const map = {};
      bookings.forEach(b => {
        const key = (b.customerPhone || '').replace(/\D/g, '') || b.customerName || '';
        if (!key) return;
        if (!map[key]) map[key] = { id: key, name: b.customerName || '', phone: b.customerPhone || '', visits: 0, totalSpent: 0 };
        if (b.status === 'confirmed' || b.status === 'done') {
          map[key].visits++;
          map[key].totalSpent += Number(b.price) || 0;
        }
      });
      return Object.values(map);
    }
  },

  async getClientAccount(phone) {
    if (!phone) return null;
    try {
      // 優先從後端取得（跨設備同步）
      const data = await apiRequest('GET', `/api/accounts/${phone}`);
      if (data) {
        // 同步到本地快取
        const accounts = CACHE.get(CACHE.ACCOUNTS) || {};
        accounts[phone] = data;
        CACHE.set(CACHE.ACCOUNTS, accounts);
        return data;
      }
    } catch(e) {
      // 後端不可用時回退本地
    }
    try {
      const accounts = CACHE.get(CACHE.ACCOUNTS) || {};
      return accounts[phone] || null;
    } catch(e) { return null; }
  },

  async saveClientAccount(phone, data) {
    try {
      await apiRequest('POST', `/api/accounts/${phone}`, data);
    } catch(e) {
      console.warn('[DB] saveClientAccount 降級:', e.message);
    }
    // 不論成功失敗，同步本地
    const accounts = CACHE.get(CACHE.ACCOUNTS) || {};
    accounts[phone] = { ...(accounts[phone] || {}), ...data };
    CACHE.set(CACHE.ACCOUNTS, accounts);
  },

  // ── 統計 ──────────────────────────────────────────────────

  async getStats() {
    try {
      return await apiRequest('GET', '/api/stats');
    } catch(e) {
      console.warn('[DB] getStats 降級:', e.message);
      const bookings = CACHE.get(CACHE.BOOKINGS) || [];
      const today    = new Date().toISOString().slice(0, 10);
      return {
        today:         bookings.filter(b => b.date === today && b.status !== 'cancelled').length,
        pending:       bookings.filter(b => b.status === 'pending').length,
        monthRevenue:  0,
        totalCustomers: new Set(bookings.map(b => b.customerPhone).filter(Boolean)).size,
        totalBookings: bookings.filter(b => b.status !== 'cancelled').length,
        topServices:   [],
        topDesigners:  [],
      };
    }
  },

  // ── 實時訂閱 ──────────────────────────────────────────────

  /**
   * 訂閱預約變更
   * onChange({ eventType: 'NEW_BOOKING'|'UPDATE_BOOKING'|'DELETE_BOOKING', booking })
   * 返回取消訂閱函數
   */
  subscribeBookings(onChange) {
    const types = ['NEW_BOOKING', 'UPDATE_BOOKING', 'DELETE_BOOKING'];

    // 若 WebSocket 已連，等 INIT 後的推送會自動觸發；也訂閱 EventBus 本地事件
    const handlers = types.map(type => {
      const fn = (data) => onChange({ eventType: type, booking: data });
      EventBus.on(type, fn);
      return { type, fn };
    });

    // 同時訂閱 WS 原始事件（確保即使 EventBus 未觸發也能收到）
    const unsub = WS.subscribe('*', ({ eventType, data }) => {
      if (types.includes(eventType)) {
        onChange({ eventType, booking: data });
      }
    });

    return () => {
      handlers.forEach(({ type, fn }) => EventBus.off(type, fn));
      unsub();
    };
  },

  /**
   * 訂閱設計師變更
   * onChange({ eventType: 'NEW_DESIGNER'|'UPDATE_DESIGNER', designer })
   * 返回取消訂閱函數
   */
  subscribeDesigners(onChange) {
    const types = ['NEW_DESIGNER', 'UPDATE_DESIGNER'];

    const handlers = types.map(type => {
      const fn = (data) => onChange({ eventType: type, designer: data });
      EventBus.on(type, fn);
      return { type, fn };
    });

    const unsub = WS.subscribe('*', ({ eventType, data }) => {
      if (types.includes(eventType)) {
        onChange({ eventType, designer: data });
      }
    });

    return () => {
      handlers.forEach(({ type, fn }) => EventBus.off(type, fn));
      unsub();
    };
  },

  // ── 後端狀態 ─────────────────────────────────────────────

  isBackendConnected() { return WS.isConnected(); },

  async checkBackend() {
    try {
      const data = await apiRequest('GET', '/api/health');
      return { ok: true, ...data };
    } catch(e) {
      return { ok: false, error: e.message };
    }
  },
};

// ── 全局掛載 ─────────────────────────────────────────────────
window.DB        = DB;
window.EventBus  = EventBus;
window.WS        = WS;
window.CACHE     = CACHE;
window.DEFAULT_DESIGNERS = DEFAULT_DESIGNERS;
window.DEFAULT_SERVICES  = DEFAULT_SERVICES;

// 自動初始化（建立 WebSocket）
DB.init();

console.info('[DB] AKB Salon 數據庫層已載入 ✓', API_BASE ? `後端: ${API_BASE}` : '（純離線模式）');
