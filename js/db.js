// ============================================================
// AKB Salon — 統一實時數據庫層 (Supabase)
// 替換 localStorage 分散存儲，實現三端實時同步
// ============================================================

// ── Supabase 配置 ────────────────────────────────────────────
const SUPABASE_URL = 'https://jxoiwlutzrtaawifdsib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4b2l3bHV0enJ0YWF3aWZkc2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI3MjkwMjMsImV4cCI6MjA1ODMwNTAyM30.EaHCHGLBsJh3S5dxnNQ9BqmTrHCHCYaOH00RA5eLMBM';

// ── Supabase 客戶端（單例）────────────────────────────────────
let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  if (typeof window !== 'undefined' && window.supabase) {
    _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 10 } }
    });
    return _supabase;
  }
  return null; // 沒有 Supabase CDN 時返回 null，降級使用 localStorage
}

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

// ── 欄位正規化（snake_case ↔ camelCase）─────────────────────
function normalizeBooking(b) {
  if (!b) return null;
  return {
    id:            b.id,
    serviceId:     b.service_id     ?? b.serviceId     ?? null,
    serviceName:   b.service_name   ?? b.serviceName   ?? '',
    designerId:    b.designer_id    ?? b.designerId    ?? null,
    designerName:  b.designer_name  ?? b.designerName  ?? '',
    date:          b.date           ?? '',
    time:          b.time           ?? '',
    customerName:  b.customer_name  ?? b.customerName  ?? '',
    customerPhone: b.customer_phone ?? b.customerPhone ?? '',
    customerEmail: b.customer_email ?? b.customerEmail ?? '',
    note:          b.note           ?? '',
    status:        b.status         ?? 'pending',
    price:         Number(b.price)  || 0,
    duration:      Number(b.duration) || 60,
    createdAt:     b.created_at     ?? b.createdAt     ?? new Date().toISOString(),
  };
}

function normalizeDesigner(d) {
  if (!d) return null;
  // specialty 可能是 JSON 字串或陣列
  let specialty = d.specialty || [];
  if (typeof specialty === 'string') {
    try { specialty = JSON.parse(specialty); } catch { specialty = specialty.split(',').map(s => s.trim()).filter(Boolean); }
  }
  return {
    id:        d.id,
    name:      d.name      ?? '',
    role:      d.role      ?? '設計師',
    level:     d.level     ?? 'C',
    specialty: Array.isArray(specialty) ? specialty : [],
    bio:       d.bio       ?? '',
    avatar:    d.avatar    ?? (d.name ? d.name[0].toUpperCase() : '?'),
    rating:    Number(d.rating)  || 5.0,
    reviews:   Number(d.reviews) || 0,
    works:     Number(d.works)   || 0,
    available: d.available !== false,
    status:    d.status    ?? 'active',
  };
}

// ── localStorage 降級快取 ────────────────────────────────────
const CACHE = {
  get(k)    { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k)    { try { localStorage.removeItem(k); } catch {} },
  // 鍵名常數
  BOOKINGS:  'akb_bookings_data',
  BOOKINGS2: 'akb_client_bookings',
  DESIGNERS: 'akb_designers_data',
  SERVICES:  'akb_services_data',
  CUSTOMERS: 'akb_customers_data',
  ACCOUNTS:  'akb_client_accounts',
};

// ── 事件總線（跨頁面實時更新通知）──────────────────────────
const EventBus = {
  _h: {},
  on(ev, fn)   { (this._h[ev] = this._h[ev] || []).push(fn); },
  off(ev, fn)  { this._h[ev] = (this._h[ev] || []).filter(h => h !== fn); },
  emit(ev, d)  { (this._h[ev] || []).forEach(fn => { try { fn(d); } catch(e) { console.error('[EventBus]', e); } }); },
};

// ── 主資料庫物件 ─────────────────────────────────────────────
const DB = {

  // ─── 初始化 & 種子 ───────────────────────────────────────
  async init() {
    const sb = getSupabase();
    if (!sb) { console.warn('[DB] Supabase 未載入，使用 localStorage 模式'); return; }
    try {
      // 植入預設設計師（若表為空）
      const { count: dc } = await sb.from('designers').select('id', { count: 'exact', head: true });
      if (dc === 0) {
        await sb.from('designers').insert(DEFAULT_DESIGNERS.map(d => ({
          id: d.id, name: d.name, role: d.role, level: d.level,
          specialty: JSON.stringify(d.specialty), bio: d.bio, avatar: d.avatar,
          rating: d.rating, reviews: d.reviews, works: d.works,
          available: d.available, status: d.status
        })));
        console.log('[DB] 已植入預設設計師');
      }
      // 植入預設服務（若表為空）
      const { count: sc } = await sb.from('services').select('id', { count: 'exact', head: true });
      if (sc === 0) {
        await sb.from('services').insert(DEFAULT_SERVICES);
        console.log('[DB] 已植入預設服務');
      }
    } catch(e) { console.warn('[DB] init 失敗:', e.message); }
  },

  // ─── 預約管理 ────────────────────────────────────────────

  async getBookings() {
    const sb = getSupabase();
    if (sb) {
      try {
        const { data, error } = await sb.from('bookings').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        const list = data.map(normalizeBooking);
        CACHE.set(CACHE.BOOKINGS,  list);
        CACHE.set(CACHE.BOOKINGS2, list);
        return list;
      } catch(e) { console.warn('[DB] getBookings 降級:', e.message); }
    }
    // 降級：localStorage
    return CACHE.get(CACHE.BOOKINGS) || CACHE.get(CACHE.BOOKINGS2) || [];
  },

  async createBooking(booking) {
    const record = {
      service_id:    booking.serviceId   || null,
      service_name:  booking.serviceName || '',
      designer_id:   booking.designerId  || null,
      designer_name: booking.designerName|| '',
      date:          booking.date        || '',
      time:          booking.time        || '',
      customer_name: booking.name        || booking.customerName  || '',
      customer_phone:booking.phone       || booking.customerPhone || '',
      customer_email:booking.email       || booking.customerEmail || '',
      note:          booking.note        || '',
      status:        'pending',
      price:         Number(booking.price)    || 0,
      duration:      Number(booking.duration) || 60,
    };
    const sb = getSupabase();
    if (sb) {
      try {
        const { data, error } = await sb.from('bookings').insert([record]).select().single();
        if (error) throw error;
        const nb = normalizeBooking(data);
        // 更新快取
        const list = CACHE.get(CACHE.BOOKINGS) || [];
        list.unshift(nb);
        CACHE.set(CACHE.BOOKINGS,  list);
        CACHE.set(CACHE.BOOKINGS2, list);
        EventBus.emit('booking_created', nb);
        return nb;
      } catch(e) { console.warn('[DB] createBooking 降級:', e.message); }
    }
    // 降級：localStorage
    const nb = normalizeBooking({ ...record, id: 'local_' + Date.now(), created_at: new Date().toISOString() });
    const list = CACHE.get(CACHE.BOOKINGS) || [];
    list.unshift(nb);
    CACHE.set(CACHE.BOOKINGS,  list);
    CACHE.set(CACHE.BOOKINGS2, list);
    EventBus.emit('booking_created', nb);
    return nb;
  },

  async updateBookingStatus(id, status) {
    const sb = getSupabase();
    if (sb) {
      try {
        const { data, error } = await sb.from('bookings')
          .update({ status, updated_at: new Date().toISOString() })
          .eq('id', id).select().single();
        if (error) throw error;
        const nb = normalizeBooking(data);
        this._updateCacheBooking(nb);
        EventBus.emit('booking_updated', nb);
        return nb;
      } catch(e) { console.warn('[DB] updateBookingStatus 降級:', e.message); }
    }
    // 降級
    return this._localUpdateBookingStatus(id, status);
  },

  async cancelBooking(id) {
    return this.updateBookingStatus(id, 'cancelled');
  },

  _updateCacheBooking(nb) {
    for (const key of [CACHE.BOOKINGS, CACHE.BOOKINGS2]) {
      const list = CACHE.get(key) || [];
      const idx = list.findIndex(b => b.id == nb.id);
      if (idx > -1) list[idx] = nb; else list.unshift(nb);
      CACHE.set(key, list);
    }
  },

  _localUpdateBookingStatus(id, status) {
    let result = null;
    for (const key of [CACHE.BOOKINGS, CACHE.BOOKINGS2]) {
      const list = CACHE.get(key) || [];
      const idx = list.findIndex(b => b.id == id);
      if (idx > -1) { list[idx] = { ...list[idx], status }; CACHE.set(key, list); result = list[idx]; }
    }
    if (result) EventBus.emit('booking_updated', result);
    return result;
  },

  // ─── 設計師管理 ──────────────────────────────────────────

  async getDesigners() {
    const sb = getSupabase();
    if (sb) {
      try {
        const { data, error } = await sb.from('designers').select('*').neq('status', 'resigned').order('id');
        if (error) throw error;
        const list = data.map(normalizeDesigner);
        CACHE.set(CACHE.DESIGNERS, list);
        return list;
      } catch(e) { console.warn('[DB] getDesigners 降級:', e.message); }
    }
    return CACHE.get(CACHE.DESIGNERS) || DEFAULT_DESIGNERS.map(normalizeDesigner);
  },

  async updateDesigner(id, updates) {
    // specialty 陣列需轉 JSON 存 Supabase
    const dbUpdates = { ...updates, updated_at: new Date().toISOString() };
    if (Array.isArray(dbUpdates.specialty)) {
      dbUpdates.specialty = JSON.stringify(dbUpdates.specialty);
    }
    const sb = getSupabase();
    if (sb) {
      try {
        const { data, error } = await sb.from('designers').update(dbUpdates).eq('id', id).select().single();
        if (error) throw error;
        const nd = normalizeDesigner(data);
        this._updateCacheDesigner(nd);
        EventBus.emit('designer_updated', nd);
        return nd;
      } catch(e) { console.warn('[DB] updateDesigner 降級:', e.message); }
    }
    // 降級
    const list = CACHE.get(CACHE.DESIGNERS) || DEFAULT_DESIGNERS.map(normalizeDesigner);
    const idx = list.findIndex(d => d.id == id);
    const nd = normalizeDesigner({ ...(list[idx] || {}), ...updates, id });
    if (idx > -1) list[idx] = nd; else list.push(nd);
    CACHE.set(CACHE.DESIGNERS, list);
    EventBus.emit('designer_updated', nd);
    return nd;
  },

  async createDesigner(designer) {
    const record = {
      name:      designer.name,
      role:      designer.role      || '設計師',
      level:     designer.level     || 'C',
      specialty: JSON.stringify(Array.isArray(designer.specialty) ? designer.specialty : []),
      bio:       designer.bio       || '',
      avatar:    designer.avatar    || (designer.name ? designer.name[0].toUpperCase() : 'D'),
      rating:    designer.rating    || 5.0,
      reviews:   designer.reviews   || 0,
      works:     designer.works     || 0,
      available: designer.available !== false,
      status:    designer.status    || 'active',
    };
    const sb = getSupabase();
    if (sb) {
      try {
        const { data, error } = await sb.from('designers').insert([record]).select().single();
        if (error) throw error;
        const nd = normalizeDesigner(data);
        const list = CACHE.get(CACHE.DESIGNERS) || [];
        list.push(nd);
        CACHE.set(CACHE.DESIGNERS, list);
        EventBus.emit('designer_created', nd);
        return nd;
      } catch(e) { console.warn('[DB] createDesigner 降級:', e.message); }
    }
    // 降級
    const list = CACHE.get(CACHE.DESIGNERS) || DEFAULT_DESIGNERS.map(normalizeDesigner);
    const nd = normalizeDesigner({ ...record, id: Math.max(...list.map(d => d.id), 0) + 1, specialty: designer.specialty || [] });
    list.push(nd);
    CACHE.set(CACHE.DESIGNERS, list);
    EventBus.emit('designer_created', nd);
    return nd;
  },

  _updateCacheDesigner(nd) {
    const list = CACHE.get(CACHE.DESIGNERS) || [];
    const idx = list.findIndex(d => d.id == nd.id);
    if (idx > -1) list[idx] = nd; else list.push(nd);
    CACHE.set(CACHE.DESIGNERS, list);
  },

  // ─── 服務項目管理 ────────────────────────────────────────

  async getServices() {
    const sb = getSupabase();
    if (sb) {
      try {
        const { data, error } = await sb.from('services').select('*').order('id');
        if (error) throw error;
        CACHE.set(CACHE.SERVICES, data);
        return data;
      } catch(e) { console.warn('[DB] getServices 降級:', e.message); }
    }
    return CACHE.get(CACHE.SERVICES) || DEFAULT_SERVICES;
  },

  async createService(service) {
    const sb = getSupabase();
    if (sb) {
      try {
        const { data, error } = await sb.from('services').insert([service]).select().single();
        if (error) throw error;
        const list = CACHE.get(CACHE.SERVICES) || DEFAULT_SERVICES;
        list.push(data);
        CACHE.set(CACHE.SERVICES, list);
        return data;
      } catch(e) { console.warn('[DB] createService 降級:', e.message); }
    }
    const list = CACHE.get(CACHE.SERVICES) || DEFAULT_SERVICES;
    const ns = { ...service, id: Math.max(...list.map(s => s.id), 0) + 1 };
    list.push(ns);
    CACHE.set(CACHE.SERVICES, list);
    return ns;
  },

  async updateService(id, updates) {
    const sb = getSupabase();
    if (sb) {
      try {
        const { data, error } = await sb.from('services').update(updates).eq('id', id).select().single();
        if (error) throw error;
        const list = CACHE.get(CACHE.SERVICES) || DEFAULT_SERVICES;
        const idx = list.findIndex(s => s.id == id);
        if (idx > -1) list[idx] = data;
        CACHE.set(CACHE.SERVICES, list);
        return data;
      } catch(e) { console.warn('[DB] updateService 降級:', e.message); }
    }
    const list = CACHE.get(CACHE.SERVICES) || DEFAULT_SERVICES;
    const idx = list.findIndex(s => s.id == id);
    if (idx > -1) { list[idx] = { ...list[idx], ...updates }; CACHE.set(CACHE.SERVICES, list); return list[idx]; }
    return null;
  },

  async deleteService(id) {
    const sb = getSupabase();
    if (sb) {
      try {
        const { error } = await sb.from('services').delete().eq('id', id);
        if (error) throw error;
        const list = (CACHE.get(CACHE.SERVICES) || DEFAULT_SERVICES).filter(s => s.id != id);
        CACHE.set(CACHE.SERVICES, list);
        return true;
      } catch(e) { console.warn('[DB] deleteService 降級:', e.message); }
    }
    CACHE.set(CACHE.SERVICES, (CACHE.get(CACHE.SERVICES) || DEFAULT_SERVICES).filter(s => s.id != id));
    return true;
  },

  // ─── 顧客帳號管理 ────────────────────────────────────────

  async getClientAccount(phone) {
    const sb = getSupabase();
    if (sb) {
      try {
        const { data } = await sb.from('customers').select('name,phone,password_hash').eq('phone', phone).maybeSingle();
        if (data) return { name: data.name, phone: data.phone, password: data.password_hash };
      } catch(e) { console.warn('[DB] getClientAccount 降級:', e.message); }
    }
    const accounts = CACHE.get(CACHE.ACCOUNTS) || {};
    return accounts[phone] || null;
  },

  async saveClientAccount(phone, accountData) {
    const sb = getSupabase();
    if (sb) {
      try {
        const payload = {
          phone,
          name:          accountData.name     || '',
          password_hash: accountData.password || '',
          last_visit:    new Date().toISOString(),
        };
        const { data: existing } = await sb.from('customers').select('id').eq('phone', phone).maybeSingle();
        if (existing) {
          await sb.from('customers').update(payload).eq('phone', phone);
        } else {
          payload.first_visit = new Date().toISOString();
          await sb.from('customers').insert([payload]);
        }
        return true;
      } catch(e) { console.warn('[DB] saveClientAccount 降級:', e.message); }
    }
    const accounts = CACHE.get(CACHE.ACCOUNTS) || {};
    accounts[phone] = { ...accountData, updatedAt: Date.now() };
    CACHE.set(CACHE.ACCOUNTS, accounts);
    return true;
  },

  async getCustomers() {
    const sb = getSupabase();
    if (sb) {
      try {
        const { data, error } = await sb.from('customers').select('*').order('last_visit', { ascending: false });
        if (error) throw error;
        CACHE.set(CACHE.CUSTOMERS, data);
        return data;
      } catch(e) { console.warn('[DB] getCustomers 降級:', e.message); }
    }
    return CACHE.get(CACHE.CUSTOMERS) || [];
  },

  // ─── 統計 ────────────────────────────────────────────────

  async getStats() {
    const sb = getSupabase();
    const today = new Date().toISOString().split('T')[0];
    const monthPrefix = today.slice(0, 7);
    if (sb) {
      try {
        const [
          { count: todayCount },
          { count: pendingCount },
          { data: monthRevData },
          { count: customerCount }
        ] = await Promise.all([
          sb.from('bookings').select('id', { count: 'exact', head: true }).eq('date', today).neq('status', 'cancelled'),
          sb.from('bookings').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
          sb.from('bookings').select('price').like('date', monthPrefix + '%').in('status', ['confirmed','done']),
          sb.from('customers').select('id', { count: 'exact', head: true }),
        ]);
        const revenue = (monthRevData || []).reduce((s, b) => s + (Number(b.price) || 0), 0);
        return { today: todayCount || 0, pending: pendingCount || 0, revenue, totalCustomers: customerCount || 0 };
      } catch(e) { console.warn('[DB] getStats 降級:', e.message); }
    }
    // 降級
    const bookings = CACHE.get(CACHE.BOOKINGS) || [];
    return {
      today:          bookings.filter(b => b.date === today && b.status !== 'cancelled').length,
      pending:        bookings.filter(b => b.status === 'pending').length,
      revenue:        bookings.filter(b => b.date.startsWith(monthPrefix) && (b.status==='confirmed'||b.status==='done')).reduce((s,b) => s+(Number(b.price)||0), 0),
      totalCustomers: 0,
    };
  },

  // ─── 實時訂閱 ────────────────────────────────────────────

  /**
   * 訂閱預約表變更（INSERT / UPDATE / DELETE）
   * @param {function} onChange - 回呼，參數 { eventType, new: normalized, old }
   * @returns {function} unsubscribe 函數
   */
  subscribeBookings(onChange) {
    const sb = getSupabase();
    if (!sb) return () => {};
    try {
      const channel = sb.channel('akb-bookings-' + Date.now())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, payload => {
          const nb = payload.new ? normalizeBooking(payload.new) : null;
          if (nb) this._updateCacheBooking(nb);
          EventBus.emit('booking_realtime', { eventType: payload.eventType, booking: nb, old: payload.old });
          onChange && onChange({ eventType: payload.eventType, booking: nb, old: payload.old });
        })
        .subscribe(status => console.log('[DB] 預約訂閱:', status));
      return () => sb.removeChannel(channel);
    } catch(e) { console.warn('[DB] subscribeBookings 失敗:', e.message); return () => {}; }
  },

  /**
   * 訂閱設計師表變更
   * @param {function} onChange
   * @returns {function} unsubscribe 函數
   */
  subscribeDesigners(onChange) {
    const sb = getSupabase();
    if (!sb) return () => {};
    try {
      const channel = sb.channel('akb-designers-' + Date.now())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'designers' }, payload => {
          const nd = payload.new ? normalizeDesigner(payload.new) : null;
          if (nd) this._updateCacheDesigner(nd);
          EventBus.emit('designer_realtime', { eventType: payload.eventType, designer: nd });
          onChange && onChange({ eventType: payload.eventType, designer: nd });
        })
        .subscribe(status => console.log('[DB] 設計師訂閱:', status));
      return () => sb.removeChannel(channel);
    } catch(e) { console.warn('[DB] subscribeDesigners 失敗:', e.message); return () => {}; }
  },
};

// ── 全域掛載 ─────────────────────────────────────────────────
window.DB        = DB;
window.EventBus  = EventBus;
window.DBCache   = CACHE;
window.DBDefaults = { designers: DEFAULT_DESIGNERS, services: DEFAULT_SERVICES };

// 自動初始化種子資料
DB.init().catch(() => {});

console.log('[DB] AKB Salon 實時數據庫層已載入 ✓');
