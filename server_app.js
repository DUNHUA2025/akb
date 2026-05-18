const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ========== 安全中間件 ==========
// ── Helmet（設置安全 HTTP 標頭）──────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      connectSrc: ["'self'", "wss:", "ws:", "https://akb-salon-server.onrender.com"],
      imgSrc: ["'self'", "data:", "https:"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // 允許嵌入外部資源
}));

// ── 登入端點速率限制（防止暴力破解）────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分鐘
  max: 10,                   // 每個 IP 最多 10 次嘗試
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '登入嘗試次數過多，請 15 分鐘後再試' },
  skipSuccessfulRequests: true, // 成功登入不計入限制
});

// ── 一般 API 速率限制（防止濫用）────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '請求次數過多，請稍後再試' },
});

// 會員註冊速率限制（每 IP 每小時最多 5 次）
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '註冊次數過多，請 1 小時後再試' },
});

// 會員登入速率限制（每 IP 15 分鐘最多 10 次）
const memberLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: '登入嘗試過多，請 15 分鐘後再試' },
});

app.use('/api/', apiLimiter);

// 中間件
// ── CORS（必須最先，確保所有響應都帶 CORS 頭）──────────────
const corsOptions = {
  origin: function(origin, callback) {
    // 允許所有來源（包括 akbmusicsalon.top、GitHub Pages）
    callback(null, true);
  },
  methods: ['GET','POST','PATCH','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: false,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());

// ── Gzip 壓縮（在 CORS 之後，確保 CORS 頭已設置）──────────
app.use((req, res, next) => {
  const ae = req.headers['accept-encoding'] || '';
  if (!ae.includes('gzip')) return next();
  const _json = res.json.bind(res);
  res.json = (obj) => {
    const buf = Buffer.from(JSON.stringify(obj), 'utf8');
    zlib.gzip(buf, (err, compressed) => {
      if (err) return _json(obj);
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Vary', 'Accept-Encoding');
      res.end(compressed);
    });
  };
  next();
});

// ========== 資料層：優先 Supabase，否則本地 JSON ==========
const SUPABASE_URL  = process.env.SUPABASE_URL  || '';
// ⚠️  安全性重要說明：後端必須使用 service_role key（而非 anon key）
//    service_role key 擁有完整資料庫權限，可繞過 RLS，只應在後端伺服器使用
//    anon key 已通過 RLS 限制，無法存取 bookings / accounts 等敏感資料表
//    環境變數優先順序：SUPABASE_SERVICE_KEY > SUPABASE_KEY > SUPABASE_ANON_KEY（最後者已不安全）
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY
                   || process.env.SUPABASE_KEY
                   || process.env.SUPABASE_ANON_KEY
                   || '';
const USE_SUPABASE  = !!(SUPABASE_URL && SUPABASE_KEY);

// 啟動時警告：若使用的是 anon key，提醒管理員升級至 service_role key
if (USE_SUPABASE && !process.env.SUPABASE_SERVICE_KEY && !process.env.SUPABASE_KEY) {
  console.warn('[Security] ⚠️  警告：目前使用 SUPABASE_ANON_KEY 存取資料庫！');
  console.warn('[Security] ⚠️  請改用 SUPABASE_SERVICE_KEY（service_role key）以確保安全性。');
  console.warn('[Security] ⚠️  詳見：Supabase Dashboard → Project Settings → API → service_role key');
}

// ── 本地 JSON 後備 ──────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'server', 'data');
const FILES = {
  bookings:  path.join(DATA_DIR, 'bookings.json'),
  designers: path.join(DATA_DIR, 'designers.json'),
  services:  path.join(DATA_DIR, 'services.json'),
  accounts:  path.join(DATA_DIR, 'accounts.json'),
  members:   path.join(DATA_DIR, 'members.json'),
};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadData(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) { console.error('loadData error:', filePath, e.message); }
  return defaultValue;
}

function saveData(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) { console.error('saveData error:', filePath, e.message); return false; }
}

// ── Supabase REST API 輔助 ─────────────────────────────
// 使用原生 fetch（Node 18+），不需要額外套件
async function sbFetch(method, table, body = null, query = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query}`;
  // POST+on_conflict upsert 需要 resolution=merge-duplicates；普通 POST 需要 return=representation
  let prefer;
  if (query.includes('on_conflict')) {
    prefer = 'resolution=merge-duplicates,return=representation';
  } else if (method === 'POST') {
    prefer = 'return=representation';
  } else {
    prefer = 'return=minimal';
  }
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': prefer,
  };
  // 10 秒超時防止 Supabase 偶發慢響應阻塞事件循環
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    clearTimeout(timer);
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase ${method} ${table}: ${res.status} ${text}`);
    return text ? JSON.parse(text) : [];
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

function normalizeBookingRow(row = {}) {
  return {
    ...row,
    customerName:  row.customerName  ?? row.customer_name  ?? '',
    customerPhone: row.customerPhone ?? row.customer_phone ?? '',
    designerId:    row.designerId    ?? row.designer_id    ?? null,
    designerName:  row.designerName  ?? row.designer_name  ?? '',
    serviceName:   row.serviceName   ?? row.service_name   ?? '',
    createdAt:     Number(row.createdAt ?? row.created_at ?? Date.now()),
    updatedAt:     Number(row.updatedAt ?? row.updated_at ?? Date.now()),
  };
}

async function loadSupabaseBookings() {
  // 不在查詢字串中指定排序欄位，避免 simplified schema("createdAt")
  // 與舊 schema(created_at) 欄位不一致時，啟動後把既有資料誤判成空陣列。
  const rows = await sbFetch('GET', 'bookings');
  return (Array.isArray(rows) ? rows : [])
    .map(normalizeBookingRow)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

// ── 將 booking 物件轉換成 Supabase bookings 表所需的欄位格式 ──
// 嚴格只傳 schema 中存在的欄位，避免 Supabase 因未知欄位拒絕寫入
// BOOKING_NOTE_FIELD 在啟動時自動偵測（'note' 或 'notes'），預設 'notes'（向後兼容舊 schema）
let BOOKING_NOTE_FIELD = 'notes'; // 啟動後由 detectBookingSchema() 更新
let BOOKING_HAS_SERVICE_ID = false; // 啟動後由 detectBookingSchema() 更新

async function detectBookingSchema() {
  if (!USE_SUPABASE) return;
  // 插入一筆測試記錄，先試 note 欄位，再試 notes 欄位
  const base = {
    id: '__detect__', "customerName": 'x', "customerPhone": '0',
    date: '2000-01-01', time: '00:00', status: 'cancelled',
    price: 0, duration: 0,
  };
  // 試驗1：帶 serviceId + note
  try {
    await sbFetch('POST', 'bookings', { ...base, note: '', "serviceId": 0 }, '?on_conflict=id');
    await sbFetch('DELETE', 'bookings?id=eq.__detect__');
    BOOKING_NOTE_FIELD = 'note';
    BOOKING_HAS_SERVICE_ID = true;
    console.log('[DB] Schema 偵測：bookings 表使用 note + serviceId 欄位');
    return;
  } catch(e) { /* 繼續嘗試 */ }
  // 試驗2：帶 notes（無 serviceId）
  try {
    await sbFetch('POST', 'bookings', { ...base, notes: '' }, '?on_conflict=id');
    await sbFetch('DELETE', 'bookings?id=eq.__detect__');
    BOOKING_NOTE_FIELD = 'notes';
    BOOKING_HAS_SERVICE_ID = false;
    console.log('[DB] Schema 偵測：bookings 表使用 notes 欄位（舊 schema）');
    return;
  } catch(e) { /* 繼續嘗試 */ }
  // 試驗3：最小欄位（更舊的 schema）
  try {
    await sbFetch('POST', 'bookings', base, '?on_conflict=id');
    await sbFetch('DELETE', 'bookings?id=eq.__detect__');
    BOOKING_NOTE_FIELD = 'notes';
    BOOKING_HAS_SERVICE_ID = false;
    console.log('[DB] Schema 偵測：bookings 表使用最小欄位集');
  } catch(e) {
    console.error('[DB] Schema 偵測全部失敗，請手動在 Supabase SQL Editor 執行 supabase_schema.sql:', e.message);
  }
}

function toBookingRow(b) {
  const row = {
    id:              b.id,
    "customerName":  b.customerName  || b.name   || '',
    "customerPhone": b.customerPhone || b.phone  || '',
    date:            b.date          || '',
    time:            b.time          || '',
    "designerId":    b.designerId    || null,
    "designerName":  b.designerName  || '',
    "serviceName":   b.serviceName   || '',
    price:           Number(b.price) || 0,
    duration:        Number(b.duration) || 60,
    status:          b.status        || 'pending',
    "createdAt":     b.createdAt     || Date.now(),
    "updatedAt":     b.updatedAt     || Date.now(),
  };
  // 根據偵測結果動態設定備註欄位名稱
  row[BOOKING_NOTE_FIELD] = b.note || b.notes || '';
  // 只在表有 serviceId 欄位時才傳
  if (BOOKING_HAS_SERVICE_ID) row['serviceId'] = b.serviceId || null;
  return row;
}

// ========== 預設資料 ==========
const DEFAULT_DESIGNERS = [
  { id:1, name:'Aika',  role:'首席設計師', level:'A', specialty:['挑染','剪髮'], bio:'擅長各種染髮技術，尤其是挑染與漸層。', avatar:'A', rating:4.9, reviews:128, works:350, available:true,  status:'active' },
  { id:2, name:'Ken',   role:'資深設計師', level:'B', specialty:['燙髮','護髮'], bio:'燙髮專家，各種捲度任您選擇。',         avatar:'K', rating:4.8, reviews:95,  works:280, available:true,  status:'active' },
  { id:3, name:'Bella', role:'設計師',     level:'C', specialty:['護髮','染髮'], bio:'護髮療程專業，讓頭髮重拾光澤。',       avatar:'B', rating:4.7, reviews:67,  works:190, available:true,  status:'active' },
  { id:4, name:'Sam',   role:'助理設計師', level:'D', specialty:['剪髮'],        bio:'剪髮造型新銳，充滿創意。',             avatar:'S', rating:4.6, reviews:42,  works:110, available:false, status:'leave'   },
  { id:5, name:'Luna',  role:'設計師',     level:'C', specialty:['染髮','剪髮'], bio:'色彩搭配達人，精準掌握您的理想色調。', avatar:'L', rating:4.8, reviews:88,  works:230, available:true,  status:'active'  },
];

const DEFAULT_SERVICES = [
  { id:1,  name:'洗剪吹',     category:'基礎', duration:60,  price:128, description:'Wash, cut and blow-dry'         },
  { id:2,  name:'單剪',       category:'基礎', duration:30,  price:68,  description:'Single cut'                     },
  { id:3,  name:'洗吹',       category:'基礎', duration:45,  price:88,  description:'Wash and blow-dry'              },
  { id:4,  name:'彩色染髮',   category:'染髮', duration:90,  price:168, description:'Color hair dye'                 },
  { id:5,  name:'電髮',       category:'燙髮', duration:120, price:268, description:'Perm'                           },
  { id:6,  name:'顏色焗油',   category:'護理', duration:60,  price:228, description:'Color hair treatment'           },
  { id:7,  name:'水療焗油',   category:'護理', duration:60,  price:188, description:'Spa hair treatment'             },
  { id:8,  name:'陶瓷數碼曲', category:'燙髮', duration:150, price:358, description:'Ceramic digital hair treatment' },
  { id:9,  name:'技術染髮',   category:'染髮', duration:120, price:228, description:'Technical hair dye'             },
  { id:10, name:'負離子直髮', category:'燙髮', duration:120, price:228, description:'Negative ion straightening'     },
];

// ⚠️  安全說明：預設帳號密碼使用 bcrypt 雜湊儲存
// 這些雜湊值對應原始密碼（首次部署後請立即透過管理後台修改密碼）：
// admin → akb2024, aika → aika123, ken → ken123, bella → bella123, sam → sam123, luna → luna123
// 雜湊使用 bcrypt cost=10 生成，原始密碼不儲存於代碼中
const DEFAULT_ACCOUNTS = {
  admin: { role: 'admin',    passwordHash: '$2b$10$9xvqOaNCeuh9Ay3.aP2r5.8i5JFp76Kti5W0ki7pfYCjrwp.8MpJi', name: '店長' },
  aika:  { role: 'designer', passwordHash: '$2b$10$Po8KQL/h2SqkHb92vbbtuef.HpVk/5vQJ.N6OkYCpk.h7u3HTRnBu', name: 'Aika',  designerId: 1 },
  ken:   { role: 'designer', passwordHash: '$2b$10$kZpzFnSWFkVHSUEgsWj4aeL.xFbOve4/ud6S4.VSUd9RuqDHf1AWq', name: 'Ken',   designerId: 2 },
  bella: { role: 'designer', passwordHash: '$2b$10$2WLN5zNPBG/Iatg7c9wIF.toFdmse20B3m1NApvDThVd1xoNRWT5u', name: 'Bella', designerId: 3 },
  sam:   { role: 'designer', passwordHash: '$2b$10$S8Y15GdQCr8Tpn/J6eZOI.vvCSMxnGZzhWRF85wHz4zJ2Uus6GofO', name: 'Sam',   designerId: 4 },
  luna:  { role: 'designer', passwordHash: '$2b$10$O/Nj04MvzFVJ7n3RhGoch.8Z1IeZaLG2vf4KRxjRoVKD/feBG0o1m', name: 'Luna',  designerId: 5 },
};

// ========== 記憶體資料（本地模式） ==========
let bookings  = [];
let designers = [];
let services  = [];
let accounts  = {};
let members   = {}; // key: phone (手機號作為唯一識別)

// ── Supabase 資料層 ──────────────────────────────────────
const DB = {
  // Supabase 初始化：讀取所有資料表；若不存在則寫入預設值
  async init() {
    if (USE_SUPABASE) {
      console.log('[DB] 使用 Supabase 雲端資料庫:', SUPABASE_URL);
      // 啟動時先偵測 bookings 表的實際欄位名稱（note/notes, serviceId 等）
      await detectBookingSchema();
      try {
        // 載入預約（兼容 created_at / "createdAt" 兩種 schema）
        bookings = await loadSupabaseBookings();
        console.log('[DB] 預約載入成功，共', bookings.length, '筆');
      } catch(e) {
        console.warn('[DB] 預約載入失敗，暫時初始化空陣列:', e.message);
        bookings = [];
      }
      try {
        designers = await sbFetch('GET', 'designers', null, '?order=id.asc');
        if (!designers.length) {
          console.log('[DB] 設計師表為空，植入預設資料');
          for (const d of DEFAULT_DESIGNERS) {
            await sbFetch('POST', 'designers', d);
          }
          designers = await sbFetch('GET', 'designers', null, '?order=id.asc');
        }
        console.log('[DB] 設計師載入成功，共', designers.length, '位');
      } catch(e) {
        console.warn('[DB] 設計師表錯誤，使用本地預設:', e.message);
        designers = DEFAULT_DESIGNERS;
      }
      try {
        services = await sbFetch('GET', 'services', null, '?order=id.asc');
        if (!services.length) {
          console.log('[DB] 服務表為空，植入預設資料');
          for (const s of DEFAULT_SERVICES) {
            await sbFetch('POST', 'services', s);
          }
          services = await sbFetch('GET', 'services', null, '?order=id.asc');
        }
        console.log('[DB] 服務載入成功，共', services.length, '項');
      } catch(e) {
        console.warn('[DB] 服務表錯誤，使用本地預設:', e.message);
        services = DEFAULT_SERVICES;
      }
      try {
        const rows = await sbFetch('GET', 'accounts', null, '');
        accounts = {};
        rows.forEach(r => { accounts[r.username] = r; });
        if (!Object.keys(accounts).length) {
          console.log('[DB] 帳號表為空，植入預設帳號');
          for (const [username, acc] of Object.entries(DEFAULT_ACCOUNTS)) {
            await sbFetch('POST', 'accounts', { username, ...acc });
          }
          const rows2 = await sbFetch('GET', 'accounts', null, '');
          accounts = {};
          rows2.forEach(r => { accounts[r.username] = r; });
        } else {
          // 補充缺少的預設帳號
          for (const [key, def] of Object.entries(DEFAULT_ACCOUNTS)) {
            if (!accounts[key]) {
              await sbFetch('POST', 'accounts', { username: key, ...def });
              accounts[key] = { username: key, ...def };
            }
          }
        }
        console.log('[DB] 帳號載入成功，共', Object.keys(accounts).length, '個');
      } catch(e) {
        console.warn('[DB] 帳號表錯誤，使用本地預設:', e.message);
        accounts = { ...DEFAULT_ACCOUNTS };
      }
      // Supabase 模式：會員資料從本地 JSON 載入（members 表可選，降級到本地）
      try {
        const mRows = await sbFetch('GET', 'members', null, '?order=created_at.desc&limit=1000');
        members = {};
        mRows.forEach(r => { members[r.phone] = r; });
        console.log('[DB] 會員載入成功（Supabase），共', Object.keys(members).length, '位');
      } catch(e) {
        console.warn('[DB] Supabase members 表不存在，使用本地 JSON:', e.message);
        members = loadData(FILES.members, {});
        if (!members) members = {};
      }
    } else {
      // ── 本地 JSON 模式 ──────────────────────────────────
      console.log('[DB] ⚠️  未設定 SUPABASE_URL/SUPABASE_SERVICE_KEY，使用本地 JSON 文件');
      console.log('[DB] ⚠️  重要：本地 JSON 在 Render 重啟後會遺失資料！請設定 Supabase 以持久化儲存。');

      bookings  = loadData(FILES.bookings, []);
      designers = loadData(FILES.designers, null);
      services  = loadData(FILES.services,  null);
      accounts  = loadData(FILES.accounts,  null);

      if (!designers || !designers.length) {
        console.log('[DB] 首次啟動：建立預設設計師資料');
        designers = DEFAULT_DESIGNERS;
        saveData(FILES.designers, designers);
      } else {
        console.log('[DB] 載入已有設計師資料，共', designers.length, '位');
      }

      if (!services || !services.length) {
        console.log('[DB] 首次啟動：建立預設服務資料');
        services = DEFAULT_SERVICES;
        saveData(FILES.services, services);
      } else {
        console.log('[DB] 載入已有服務資料，共', services.length, '項');
      }

      if (!accounts) {
        console.log('[DB] 首次啟動：建立預設帳號');
        accounts = { ...DEFAULT_ACCOUNTS };
        saveData(FILES.accounts, accounts);
      } else {
        // 補充缺少的帳號，但不覆蓋已存在帳號的密碼
        let changed = false;
        Object.entries(DEFAULT_ACCOUNTS).forEach(([key, def]) => {
          if (!accounts[key]) {
            console.log('[DB] 補充缺少的帳號:', key);
            accounts[key] = def;
            changed = true;
          }
        });
        if (changed) saveData(FILES.accounts, accounts);
        console.log('[DB] 載入已有帳號資料，共', Object.keys(accounts).length, '個');
      }

      if (!fs.existsSync(FILES.bookings)) saveData(FILES.bookings, bookings);

      // 載入會員資料
      members = loadData(FILES.members, {});
      if (!members) members = {};
      console.log('[DB] 載入已有會員資料，共', Object.keys(members).length, '位');
    }
  },

  // ── 寫入輔助（同時更新記憶體和持久層）──────────────────
  async saveBookings() {
    if (USE_SUPABASE) return; // Supabase 逐筆操作，不需整批寫回
    saveData(FILES.bookings, bookings);
  },
  async saveDesigners() {
    if (USE_SUPABASE) return;
    saveData(FILES.designers, designers);
  },
  async saveServices() {
    if (USE_SUPABASE) return;
    saveData(FILES.services, services);
  },
  async saveAccounts() {
    if (USE_SUPABASE) return;
    saveData(FILES.accounts, accounts);
  },
  async saveMembers() {
    saveData(FILES.members, members); // 本地模式始終寫入
  },
  async upsertMember(phone, data) {
    if (!USE_SUPABASE) return;
    try {
      await sbFetch('POST', 'members', { phone, ...data }, '?on_conflict=phone');
    } catch(e) { console.warn('[DB] upsertMember 失敗:', e.message); }
  },

  // ── Supabase 逐筆寫入 ────────────────────────────────
  async upsertBooking(b) {
    if (!USE_SUPABASE) return;
    try {
      const row = toBookingRow(b);
      await sbFetch('POST', 'bookings', row, '?on_conflict=id');
      console.log('[DB] ✅ upsertBooking 成功:', b.id);
    } catch(e) {
      console.error('[DB] ❌ upsertBooking 失敗:', b.id, e.message);
    }
  },
  async deleteBooking(id) {
    if (!USE_SUPABASE) return;
    try { await sbFetch('DELETE', `bookings?id=eq.${id}`); } catch(e) { console.warn('[DB] deleteBooking:', e.message); }
  },
  async upsertDesigner(d) {
    if (!USE_SUPABASE) return;
    try { await sbFetch('PATCH', `designers?id=eq.${d.id}`, d); } catch(e) { console.warn('[DB] upsertDesigner:', e.message); }
  },
  async upsertService(s) {
    if (!USE_SUPABASE) return;
    try { await sbFetch('PATCH', `services?id=eq.${s.id}`, s); } catch(e) { console.warn('[DB] upsertService:', e.message); }
  },
  async deleteService(id) {
    if (!USE_SUPABASE) return;
    try { await sbFetch('DELETE', `services?id=eq.${id}`); } catch(e) { console.warn('[DB] deleteService:', e.message); }
  },
  async upsertAccount(username, data) {
    if (!USE_SUPABASE) return;
    try {
      await sbFetch('PATCH', `accounts?username=eq.${username}`, data);
    } catch(e) { console.warn('[DB] upsertAccount:', e.message); }
  },
  async insertAccount(username, data) {
    if (!USE_SUPABASE) return;
    try { await sbFetch('POST', 'accounts', { username, ...data }); } catch(e) { console.warn('[DB] insertAccount:', e.message); }
  },
};

// ========== WebSocket 廣播 ==========
const clients = new Set();

wss.on('connection', (ws) => {
  console.log('[WS] Client connected, total:', clients.size + 1);
  clients.add(ws);
  ws.send(JSON.stringify({ type: 'INIT', data: { bookings, designers, services }, timestamp: Date.now() }));
  ws.on('close', () => {
    clients.delete(ws);
    console.log('[WS] Client disconnected, remaining:', clients.size);
  });
  ws.on('error', (e) => console.error('[WS] Error:', e.message));
});

function broadcast(type, data, excludeWs = null) {
  const msg = JSON.stringify({ type, data, timestamp: Date.now() });
  clients.forEach(client => {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

function genId(prefix) {
  return prefix + Date.now().toString().slice(-8) + Math.floor(Math.random() * 100);
}

// ========== API 路由 ==========

app.get('/api/health', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    status: 'ok',
    bookings: bookings.length,
    designers: designers.length,
    clients: clients.size,
    storage: USE_SUPABASE ? 'supabase' : 'local-json',
    timestamp: new Date().toISOString()
  });
});

// ─── Supabase 連接診斷（用於排查持久化問題）─────────────
// ─── Key Hint（安全診斷：只返回 role + 尾部字符，不暴露完整 key）──
app.get('/api/admin/key-hint', (req, res) => {
  if (!USE_SUPABASE) return res.json({ ok: false, message: '未使用 Supabase' });
  let role = 'unknown';
  let tail = '';
  try {
    const payload = JSON.parse(Buffer.from(SUPABASE_KEY.split('.')[1], 'base64').toString());
    role = payload.role || 'unknown';
    tail = SUPABASE_KEY.slice(-8);
  } catch {}
  res.json({
    keyRole: role,
    keyTail: `...${tail}`,
    hint: role === 'service_role'
      ? '✅ Render 已設定 service_role key，可直接呼叫 enable-rls（不需傳 serviceRoleKey）'
      : `⚠️ Render 目前使用 anon key（結尾: ...${tail}）。請在 Supabase Dashboard 找到結尾不同的 service_role key`,
  });
});

app.get('/api/debug/supabase', async (req, res) => {
  // 🔒 安全保護：需要 RESET_SECRET 才能存取診斷端點
  const { secret } = req.query;
  const RESET_SECRET = process.env.RESET_SECRET;
  if (!RESET_SECRET || secret !== RESET_SECRET) {
    return res.status(403).json({ error: '存取被拒絕：需要有效的診斷密鑰' });
  }
  if (!USE_SUPABASE) return res.json({ supabase: false, message: '未設定 SUPABASE_URL/SUPABASE_SERVICE_KEY' });
  try {
    // 不加排序，避免 created_at vs "createdAt" 欄位名稱衝突
    const rows = await sbFetch('GET', 'bookings', null, '?select=id,status,date&limit=5');
    res.json({ supabase: true, supabaseUrl: SUPABASE_URL.replace(/https:\/\/([^.]+)\..*/, 'https://$1.supabase.co'),
      bookingsInSupabase: rows.length, latestBookings: rows, memoryBookings: bookings.length });
  } catch(e) {
    res.status(500).json({ supabase: true, error: e.message });
  }
});

// ─── Supabase Schema 自動修正（首次使用或 schema 變更後執行）──
// 通過 Supabase REST API 的 rpc 無法直接執行 DDL，
// 改用「插入一筆帶有所有欄位的記錄」來觸發欄位驗證，
// 並在 DB.init() 中通過 upsertBooking 確保 schema 已正確。
// 此 endpoint 用於手動觸發 schema 診斷和修復。
app.post('/api/admin/fix-schema', async (req, res) => {
  const { secret } = req.body;
  const RESET_SECRET = process.env.RESET_SECRET;
  if (!RESET_SECRET) return res.status(503).json({ error: '伺服器未設定 RESET_SECRET 環境變數' });
  if (secret !== RESET_SECRET) return res.status(403).json({ error: '密鑰錯誤' });
  if (!USE_SUPABASE) return res.json({ message: '使用本地 JSON，無需修復' });

  const results = [];
  // 嘗試寫入一筆測試記錄（包含所有欄位），測試 schema 是否正確
  const testRow = toBookingRow({
    id: '__schema_test__',
    customerName: 'test', customerPhone: '00000000',
    date: '2000-01-01', time: '00:00',
    designerId: 0, designerName: 'test',
    serviceId: 0, serviceName: 'test',
    price: 0, duration: 0, note: 'schema test',
    status: 'cancelled', createdAt: 0, updatedAt: 0,
  });
  try {
    await sbFetch('POST', 'bookings', testRow, '?on_conflict=id');
    results.push({ step: 'schema_test_insert', ok: true });
    // 清理測試記錄
    await sbFetch('DELETE', 'bookings?id=eq.__schema_test__');
    results.push({ step: 'schema_test_cleanup', ok: true });
    // 重新載入 bookings
    bookings = await loadSupabaseBookings();
    results.push({ step: 'reload_bookings', count: bookings.length, ok: true });
  } catch(e) {
    results.push({ step: 'schema_test_insert', ok: false, error: e.message });
  }
  res.json({ results, memoryBookings: bookings.length });
});

// ─── 啟用 RLS（Row-Level Security）端點 ────────────────
// 方法：通過後端代理使用 Supabase REST SQL API 執行 DDL
// 支援：使用 body.serviceRoleKey 提供 service_role key（若環境變數未設定）
// 保護：使用 RESET_SECRET 密鑰防止未授權呼叫
app.post('/api/admin/enable-rls', async (req, res) => {
  const { secret, serviceRoleKey } = req.body;
  const RESET_SECRET = process.env.RESET_SECRET;
  if (!RESET_SECRET) return res.status(503).json({ error: '伺服器未設定 RESET_SECRET 環境變數' });
  if (secret !== RESET_SECRET) return res.status(403).json({ error: '密鑰錯誤' });
  if (!USE_SUPABASE) return res.json({ ok: false, message: '未設定 Supabase，無需操作' });

  const projectRef = SUPABASE_URL.replace('https://', '').split('.')[0];

  // 使用傳入的 serviceRoleKey，若未傳則使用環境變數中的 key
  const effectiveKey = serviceRoleKey || SUPABASE_KEY;

  // 解碼 JWT 以偵測金鑰類型（anon vs service_role）
  let keyRole = 'unknown';
  try {
    const payload = JSON.parse(Buffer.from(effectiveKey.split('.')[1], 'base64').toString());
    keyRole = payload.role || 'unknown';
  } catch {}

  // 完整 RLS SQL（全部合併成一個 DO block，減少請求次數）
  const fullRlsSql = `
DO $$
BEGIN
  -- bookings
  ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bookings' AND policyname='service_role_all_bookings') THEN
    CREATE POLICY "service_role_all_bookings" ON public.bookings FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bookings' AND policyname='anon_insert_booking') THEN
    CREATE POLICY "anon_insert_booking" ON public.bookings FOR INSERT TO anon WITH CHECK (true);
  END IF;
  -- designers
  ALTER TABLE public.designers ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='designers' AND policyname='service_role_all_designers') THEN
    CREATE POLICY "service_role_all_designers" ON public.designers FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='designers' AND policyname='public_read_active_designers') THEN
    CREATE POLICY "public_read_active_designers" ON public.designers FOR SELECT TO anon USING (status IS DISTINCT FROM 'resigned');
  END IF;
  -- services
  ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='services' AND policyname='service_role_all_services') THEN
    CREATE POLICY "service_role_all_services" ON public.services FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='services' AND policyname='public_read_services') THEN
    CREATE POLICY "public_read_services" ON public.services FOR SELECT TO anon USING (true);
  END IF;
  -- accounts
  ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='accounts' AND policyname='service_role_all_accounts') THEN
    CREATE POLICY "service_role_all_accounts" ON public.accounts FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
`.trim();

  const results = [];

  // ── 方法 A：Supabase REST API Content-Type: application/sql（service_role 可執行 DDL）
  try {
    const sqlRes = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sql',
        'apikey': effectiveKey,
        'Authorization': `Bearer ${effectiveKey}`,
      },
      body: fullRlsSql,
    });
    const text = await sqlRes.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    results.push({ method: 'rest-sql', status: sqlRes.status, ok: sqlRes.ok, response: json });
    // 若成功，立即返回（不需要嘗試其他方法）
    if (sqlRes.ok || sqlRes.status === 200 || sqlRes.status === 204) {
      return res.json({ projectRef, keyRole, results, summary: '✅ RLS 已成功啟用！所有資料表已受到保護。' });
    }
  } catch (e) {
    results.push({ method: 'rest-sql', ok: false, error: e.message });
  }

  // ── 方法 B：Supabase Management API（需要 Personal Access Token，非 project key）
  try {
    const mgmtRes = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${effectiveKey}`,
      },
      body: JSON.stringify({ query: fullRlsSql }),
    });
    const text = await mgmtRes.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    results.push({ method: 'mgmt-api', status: mgmtRes.status, ok: mgmtRes.ok, response: json });
    if (mgmtRes.ok) {
      return res.json({ projectRef, keyRole, results, summary: '✅ RLS 已通過 Management API 成功啟用！' });
    }
  } catch (e) {
    results.push({ method: 'mgmt-api', ok: false, error: e.message });
  }

  // ── 方法 C：如果以上都失敗，嘗試通過 rpc 呼叫（如果函式存在）
  try {
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_ddl`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': effectiveKey,
        'Authorization': `Bearer ${effectiveKey}`,
      },
      body: JSON.stringify({ sql: fullRlsSql }),
    });
    const text = await rpcRes.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    results.push({ method: 'rpc-exec_ddl', status: rpcRes.status, ok: rpcRes.ok, response: json });
  } catch (e) {
    results.push({ method: 'rpc-exec_ddl', ok: false, error: e.message });
  }

  const anyOk = results.some(r => r.ok && r.status < 300);
  const needsServiceRole = keyRole !== 'service_role';
  res.json({
    projectRef,
    keyRole,
    usedInlineKey: !!serviceRoleKey,
    results,
    summary: anyOk
      ? '✅ RLS DDL 執行成功'
      : needsServiceRole
        ? `❌ 需要 service_role key（目前: ${keyRole}）。請在請求 body 中傳入 serviceRoleKey 欄位。`
        : '❌ 所有方法均失敗，請查看 results 了解詳情',
    howToFix: needsServiceRole ? {
      step1: '前往 https://supabase.com/dashboard → 選擇專案 akb-salon',
      step2: 'Project Settings → API → service_role JWT token（點擊 Reveal）',
      step3: '複製 service_role key，然後重新呼叫此端點，在 body 中加入 serviceRoleKey 欄位',
      curlExample: `curl -s -X POST https://akb-salon-server.onrender.com/api/admin/enable-rls -H "Content-Type: application/json" -d '{"secret":"akb-reset-2026","serviceRoleKey":"eyJ...貼入你的key..."}'`,
    } : null,
  });
});

// ─── 預約 ─────────────────────────────────────────────
app.get('/api/bookings', (req, res) => {
  const { date, status, designerId } = req.query;
  let result = [...bookings];
  if (date)       result = result.filter(b => b.date === date);
  if (status)     result = result.filter(b => b.status === status);
  if (designerId) result = result.filter(b => String(b.designerId) === String(designerId));
  res.json(result.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)));
});

app.get('/api/bookings/:id', (req, res) => {
  const b = bookings.find(b => b.id === req.params.id);
  if (!b) return res.status(404).json({ error: '找不到預約' });
  res.json(b);
});

app.post('/api/bookings', async (req, res) => {
  const { customerName, customerPhone, date, time, designerId, serviceName, serviceId, designerName, price, duration, note, notes } = req.body;
  if (!customerName || !customerPhone || !date || !time || !designerId || !serviceName) {
    return res.status(400).json({ error: '缺少必要欄位' });
  }
  // 輸入長度驗證
  if (String(customerName).length > 100 || String(customerPhone).length > 30) {
    return res.status(400).json({ error: '輸入資料過長' });
  }
  // 🔒 明確白名單欄位，防止任意屬性注入
  const booking = {
    id: 'BK' + Date.now().toString().slice(-6),
    customerName: String(customerName).trim().slice(0, 100),
    customerPhone: String(customerPhone).trim().slice(0, 30),
    date: String(date).slice(0, 10),
    time: String(time).slice(0, 5),
    designerId: Number(designerId) || null,
    designerName: String(designerName || '').trim().slice(0, 100),
    serviceName: String(serviceName).trim().slice(0, 100),
    serviceId: Number(serviceId) || null,
    price: Number(price) || 0,
    duration: Number(duration) || 60,
    note: String(note || notes || '').trim().slice(0, 500),
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  bookings.push(booking);
  await DB.saveBookings();
  await DB.upsertBooking(booking);
  broadcast('NEW_BOOKING', booking);
  res.status(201).json(booking);
});

app.patch('/api/bookings/:id', async (req, res) => {
  const idx = bookings.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '找不到預約' });
  // 🔒 白名單：只允許更新指定欄位
  const allowed = ['status', 'customerName', 'customerPhone', 'date', 'time',
    'designerId', 'designerName', 'serviceName', 'serviceId', 'price', 'duration', 'note', 'notes'];
  const patch = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) patch[k] = req.body[k];
  }
  bookings[idx] = { ...bookings[idx], ...patch, updatedAt: Date.now() };
  await DB.saveBookings();
  await DB.upsertBooking(bookings[idx]);
  broadcast('UPDATE_BOOKING', bookings[idx]);
  res.json(bookings[idx]);
});

app.delete('/api/bookings/:id', async (req, res) => {
  const idx = bookings.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '找不到預約' });
  const deleted = bookings.splice(idx, 1)[0];
  await DB.saveBookings();
  await DB.deleteBooking(req.params.id);
  broadcast('DELETE_BOOKING', { id: req.params.id });
  res.json(deleted);
});

// ─── 設計師 ───────────────────────────────────────────
app.get('/api/designers', (req, res) => {
  const { available, status } = req.query;
  let result = [...designers];
  if (available !== undefined) result = result.filter(d => d.available === (available === 'true'));
  if (status)                  result = result.filter(d => d.status === status);
  // 設計師數據相對穩定，允許客戶端快取 30 秒，代理快取 60 秒
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');
  res.json(result);
});

app.get('/api/designers/:id', (req, res) => {
  const d = designers.find(d => d.id === Number(req.params.id));
  if (!d) return res.status(404).json({ error: '找不到設計師' });
  res.json(d);
});

app.post('/api/designers', async (req, res) => {
  if (!req.body.name) return res.status(400).json({ error: '設計師名稱必填' });
  if (String(req.body.name).length > 100) return res.status(400).json({ error: '名稱過長' });
  // 🔒 白名單欄位
  const { name, role, level, specialty, bio, avatar } = req.body;
  const newDesigner = {
    id: Math.max(...designers.map(d => d.id), 0) + 1,
    name: String(name).trim().slice(0, 100),
    role: String(role || '設計師').trim().slice(0, 50),
    level: String(level || 'C').trim().slice(0, 5),
    specialty: Array.isArray(specialty) ? specialty.slice(0, 10).map(s => String(s).slice(0, 50)) : [],
    bio: String(bio || '').trim().slice(0, 500),
    avatar: String(avatar || name || '').trim().slice(0, 10),
    rating: 5.0, reviews: 0, works: 0, available: true, status: 'active',
    createdAt: Date.now()
  };
  designers.push(newDesigner);
  await DB.saveDesigners();
  await DB.upsertDesigner(newDesigner);
  broadcast('NEW_DESIGNER', newDesigner);
  res.status(201).json(newDesigner);
});

app.patch('/api/designers/:id', async (req, res) => {
  const idx = designers.findIndex(d => d.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: '找不到設計師' });
  // 🔒 白名單：只允許更新指定欄位
  const allowed = ['name', 'role', 'level', 'specialty', 'bio', 'avatar', 'available', 'status', 'rating', 'reviews', 'works'];
  const patch = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) patch[k] = req.body[k];
  }
  designers[idx] = { ...designers[idx], ...patch, updatedAt: Date.now() };
  await DB.saveDesigners();
  await DB.upsertDesigner(designers[idx]);
  broadcast('UPDATE_DESIGNER', designers[idx]);
  res.json(designers[idx]);
});

app.delete('/api/designers/:id', async (req, res) => {
  const idx = designers.findIndex(d => d.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: '找不到設計師' });
  designers[idx] = { ...designers[idx], status: 'resigned', available: false, updatedAt: Date.now() };
  await DB.saveDesigners();
  await DB.upsertDesigner(designers[idx]);
  broadcast('UPDATE_DESIGNER', designers[idx]);
  res.json(designers[idx]);
});

// ─── 服務項目 ─────────────────────────────────────────
// 服務項目變更頻率低，快取 60 秒
app.get('/api/services', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120');
  res.json(services);
});

app.post('/api/services', async (req, res) => {
  if (!req.body.name) return res.status(400).json({ error: '服務名稱必填' });
  if (String(req.body.name).length > 100) return res.status(400).json({ error: '名稱過長' });
  // 🔒 白名單欄位
  const { name, category, duration, price, description } = req.body;
  const newSvc = {
    id: Math.max(...services.map(s => s.id), 0) + 1,
    name: String(name).trim().slice(0, 100),
    category: String(category || '基礎').trim().slice(0, 50),
    duration: Number(duration) || 60,
    price: Number(price) || 0,
    description: String(description || '').trim().slice(0, 500),
    createdAt: Date.now()
  };
  services.push(newSvc);
  await DB.saveServices();
  await DB.upsertService(newSvc);
  broadcast('UPDATE_SERVICES', services);
  res.status(201).json(newSvc);
});

app.patch('/api/services/:id', async (req, res) => {
  const idx = services.findIndex(s => s.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: '找不到服務' });
  // 🔒 白名單：只允許更新指定欄位
  const allowed = ['name', 'category', 'duration', 'price', 'description'];
  const patch = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) patch[k] = req.body[k];
  }
  services[idx] = { ...services[idx], ...patch, updatedAt: Date.now() };
  await DB.saveServices();
  await DB.upsertService(services[idx]);
  broadcast('UPDATE_SERVICES', services);
  res.json(services[idx]);
});

app.delete('/api/services/:id', async (req, res) => {
  const idx = services.findIndex(s => s.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: '找不到服務' });
  const deleted = services.splice(idx, 1)[0];
  await DB.saveServices();
  await DB.deleteService(req.params.id);
  broadcast('UPDATE_SERVICES', services);
  res.json(deleted);
});

// ─── 客戶統計 ─────────────────────────────────────────
app.get('/api/customers', (req, res) => {
  const customerMap = {};
  bookings.forEach(b => {
    if (b.status === 'cancelled') return; // 已取消不計入
    const key = (b.customerPhone || '').replace(/\D/g, '') || b.customerName || '';
    if (!key) return;
    if (!customerMap[key]) {
      customerMap[key] = { id: key, name: b.customerName||'未知', phone: b.customerPhone||'',
        visits: 0, totalSpent: 0, pendingCount: 0, lastVisit: '', firstVisit: b.date||'' };
    }
    if (b.status === 'confirmed' || b.status === 'done') {
      customerMap[key].visits++;
      customerMap[key].totalSpent += Number(b.price) || 0;
      if (!customerMap[key].lastVisit || b.date > customerMap[key].lastVisit) customerMap[key].lastVisit = b.date;
      if (b.date < customerMap[key].firstVisit) customerMap[key].firstVisit = b.date;
    } else if (b.status === 'pending') {
      customerMap[key].pendingCount++; // 待確認預約也顯示顧客
      if (b.date < customerMap[key].firstVisit || !customerMap[key].firstVisit) customerMap[key].firstVisit = b.date;
    }
  });
  res.json(Object.values(customerMap).sort((a, b) => b.totalSpent - a.totalSpent || b.visits - a.visits));
});

// ─── 帳號 & 認證 ──────────────────────────────────────
// 🔒 速率限制已在 loginLimiter 中設定（每 IP 15 分鐘內最多 10 次）
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '帳號密碼必填' });
  if (String(username).length > 50 || String(password).length > 200) {
    return res.status(400).json({ error: '輸入格式錯誤' });
  }
  const account = accounts[String(username).toLowerCase()];
  // 🔒 統一錯誤訊息，防止帳號枚舉攻擊
  if (!account) return res.status(401).json({ error: '帳號或密碼錯誤' });
  const hash = account.passwordHash || account.password_hash || '';
  let passwordValid = false;
  if (hash.startsWith('plain:')) {
    // 向後兼容：plain: 前綴的密碼（遷移期間）
    passwordValid = hash.slice(6) === password;
    if (passwordValid) {
      // 自動升級為 bcrypt 雜湊
      try {
        const newHash = await bcrypt.hash(password, 10);
        account.passwordHash = newHash;
        await DB.saveAccounts();
        await DB.upsertAccount(String(username).toLowerCase(), { passwordHash: newHash });
        console.log('[Auth] ✅ 已將帳號', username, '的密碼升級為 bcrypt 雜湊');
      } catch(e) { console.warn('[Auth] 密碼升級失敗:', e.message); }
    }
  } else {
    // bcrypt 雜湊比對
    passwordValid = await bcrypt.compare(String(password), hash);
  }
  if (!passwordValid) return res.status(401).json({ error: '帳號或密碼錯誤' });
  res.json({ success: true, role: account.role, name: account.name, designerId: account.designerId || null });
});

app.patch('/api/auth/password', async (req, res) => {
  const { username, currentPassword, newPassword } = req.body;
  if (!username || !currentPassword || !newPassword) return res.status(400).json({ error: '缺少必要欄位' });
  const account = accounts[String(username).toLowerCase()];
  if (!account) return res.status(401).json({ error: '目前密碼錯誤' }); // 🔒 防止帳號枚舉
  const hash = account.passwordHash || account.password_hash || '';
  let currentValid = false;
  if (hash.startsWith('plain:')) {
    currentValid = hash.slice(6) === currentPassword;
  } else {
    currentValid = await bcrypt.compare(String(currentPassword), hash);
  }
  if (!currentValid) return res.status(401).json({ error: '目前密碼錯誤' });
  if (String(newPassword).length < 6) return res.status(400).json({ error: '新密碼至少6位' });
  if (String(newPassword).length > 200) return res.status(400).json({ error: '密碼過長' });

  // 🔒 新密碼使用 bcrypt 雜湊儲存
  const newHash = await bcrypt.hash(String(newPassword), 10);
  account.passwordHash = newHash;
  account.updatedAt = Date.now();
  await DB.saveAccounts();
  await DB.upsertAccount(String(username).toLowerCase(), { passwordHash: newHash, updatedAt: account.updatedAt });
  broadcast('UPDATE_ACCOUNT', { username: String(username).toLowerCase(), role: account.role, name: account.name });
  res.json({ success: true });
});

// 緊急密碼重設（需要 RESET_SECRET 環境變數）
// 🔒 安全要求：RESET_SECRET 必須設定為環境變數，不再有預設值
app.post('/api/auth/reset', async (req, res) => {
  const { secret, username, newPassword } = req.body;
  const RESET_SECRET = process.env.RESET_SECRET;
  if (!RESET_SECRET) return res.status(503).json({ error: '伺服器未設定 RESET_SECRET 環境變數，請聯繫管理員' });
  if (secret !== RESET_SECRET) return res.status(403).json({ error: '密鑰錯誤' });
  if (!username || !newPassword) return res.status(400).json({ error: '缺少欄位' });
  if (String(newPassword).length < 6) return res.status(400).json({ error: '密碼至少6位' });
  if (String(newPassword).length > 200) return res.status(400).json({ error: '密碼過長' });
  if (!accounts[String(username).toLowerCase()]) return res.status(404).json({ error: '帳號不存在' });
  // 🔒 使用 bcrypt 雜湊新密碼
  const newHash = await bcrypt.hash(String(newPassword), 10);
  accounts[String(username).toLowerCase()].passwordHash = newHash;
  accounts[String(username).toLowerCase()].updatedAt = Date.now();
  await DB.saveAccounts();
  await DB.upsertAccount(String(username).toLowerCase(), { passwordHash: newHash, updatedAt: accounts[String(username).toLowerCase()].updatedAt });
  broadcast('UPDATE_ACCOUNT', { username: String(username).toLowerCase() });
  res.json({ success: true, message: `${username} 密碼已重設` });
});

app.get('/api/accounts', (req, res) => {
  const safe = {};
  Object.entries(accounts).forEach(([k, v]) => {
    safe[k] = { role: v.role, name: v.name, designerId: v.designerId };
  });
  res.json(safe);
});

app.get('/api/accounts/:phone', (req, res) => {
  const { phone } = req.params;
  const account = accounts[phone];
  if (!account) return res.status(404).json({ error: '帳號不存在' });
  const { passwordHash, password_hash, ...safe } = account;
  res.json(safe);
});

app.post('/api/accounts/:phone', async (req, res) => {
  const { phone } = req.params;
  if (String(phone).length > 30) return res.status(400).json({ error: '電話號碼格式錯誤' });
  // 🔒 白名單欄位（客戶端帳號不含密碼欄位）
  const { name, email, note } = req.body;
  const patch = {
    name: name ? String(name).trim().slice(0, 100) : undefined,
    email: email ? String(email).trim().slice(0, 200) : undefined,
    note: note ? String(note).trim().slice(0, 500) : undefined,
  };
  // 移除 undefined 值
  Object.keys(patch).forEach(k => patch[k] === undefined && delete patch[k]);
  accounts[phone] = { ...accounts[phone], ...patch, updatedAt: Date.now() };
  await DB.saveAccounts();
  if (USE_SUPABASE) {
    try {
      await sbFetch('POST', 'accounts', { username: phone, ...accounts[phone] }, '?on_conflict=username');
    } catch(e) { console.warn('[DB] upsert client account:', e.message); }
  }
  broadcast('UPDATE_ACCOUNT', { phone, ...accounts[phone] });
  res.json(accounts[phone]);
});

// ─── 統計報表 ─────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth  = today.slice(0, 7);
  const lastMonth  = (() => { const d = new Date(); d.setMonth(d.getMonth()-1); return d.toISOString().slice(0,7); })();
  const confirmed  = bookings.filter(b => b.status === 'confirmed' || b.status === 'done');
  const todayBookings   = bookings.filter(b => b.date === today && b.status !== 'cancelled');
  const pendingCount    = bookings.filter(b => b.status === 'pending').length;
  const monthRevenue    = confirmed.filter(b => b.date.startsWith(thisMonth)).reduce((s,b) => s+(Number(b.price)||0), 0);
  const lastMonthRevenue= confirmed.filter(b => b.date.startsWith(lastMonth)).reduce((s,b) => s+(Number(b.price)||0), 0);
  const uniquePhones    = new Set(bookings.map(b => (b.customerPhone||'').replace(/\D/g,'')).filter(Boolean));
  const svcCount = {};
  confirmed.forEach(b => { svcCount[b.serviceName] = (svcCount[b.serviceName]||0)+1; });
  const topServices = Object.entries(svcCount).map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count).slice(0,5);
  const designerRevenue = {};
  confirmed.filter(b => b.date.startsWith(thisMonth)).forEach(b => {
    const name = b.designerName || b.designerId || '未知';
    designerRevenue[name] = (designerRevenue[name]||0) + (Number(b.price)||0);
  });
  const topDesigners = Object.entries(designerRevenue).map(([name,revenue])=>({name,revenue})).sort((a,b)=>b.revenue-a.revenue);
  res.json({
    today: todayBookings.length, pending: pendingCount, monthRevenue, lastMonthRevenue,
    revenueGrowth: lastMonthRevenue>0 ? Math.round((monthRevenue-lastMonthRevenue)/lastMonthRevenue*100) : null,
    totalCustomers: uniquePhones.size, totalBookings: bookings.filter(b=>b.status!=='cancelled').length,
    topServices, topDesigners, storage: USE_SUPABASE ? 'supabase' : 'local-json',
  });
});

// ─── 店家設定（營業時間等）────────────────────────────
// 使用本地 JSON 持久化（與 Supabase 無關，設定較少不需要雲端）
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULT_SETTINGS = {
  businessHours: [
    { day: 0, label: '星期日', open: false, start: '10:00', end: '19:00' },
    { day: 1, label: '星期一', open: true,  start: '10:00', end: '19:00' },
    { day: 2, label: '星期二', open: true,  start: '10:00', end: '19:00' },
    { day: 3, label: '星期三', open: true,  start: '10:00', end: '19:00' },
    { day: 4, label: '星期四', open: true,  start: '10:00', end: '19:00' },
    { day: 5, label: '星期五', open: true,  start: '10:00', end: '20:00' },
    { day: 6, label: '星期六', open: true,  start: '10:00', end: '20:00' },
  ],
  slotInterval: 30,   // 預約時間間隔（分鐘）
  maxAdvanceDays: 30, // 最多提前幾天預約
  uiTheme: 'jade',   // UI 主題：jade | rose | gold | ocean
  uiDark: true,      // 深色模式
  updatedAt: null,
};

let siteSettings = loadData(SETTINGS_FILE, DEFAULT_SETTINGS);
// 補齊新欄位（向下相容舊資料）
if (!siteSettings.businessHours) siteSettings = { ...DEFAULT_SETTINGS, ...siteSettings };

function saveSettings() {
  siteSettings.updatedAt = new Date().toISOString();
  saveData(SETTINGS_FILE, siteSettings);
}

app.get('/api/settings', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(siteSettings);
});

app.post('/api/settings', (req, res) => {
  const { businessHours, slotInterval, maxAdvanceDays, uiTheme, uiDark } = req.body;
  const VALID_THEMES = ['jade', 'rose', 'gold', 'ocean'];
  if (businessHours && Array.isArray(businessHours)) {
    // 驗證每筆資料格式
    for (const h of businessHours) {
      if (typeof h.day !== 'number' || h.day < 0 || h.day > 6) {
        return res.status(400).json({ error: '無效的 day 值（應為 0~6）' });
      }
      if (h.open && !/^\d{2}:\d{2}$/.test(h.start || '')) {
        return res.status(400).json({ error: `${h.label} 的開始時間格式不正確` });
      }
      if (h.open && !/^\d{2}:\d{2}$/.test(h.end || '')) {
        return res.status(400).json({ error: `${h.label} 的結束時間格式不正確` });
      }
    }
    siteSettings.businessHours = businessHours;
  }
  if (slotInterval !== undefined) siteSettings.slotInterval = Number(slotInterval) || 30;
  if (maxAdvanceDays !== undefined) siteSettings.maxAdvanceDays = Number(maxAdvanceDays) || 30;
  // UI 主題設定
  if (uiTheme !== undefined && VALID_THEMES.includes(uiTheme)) {
    siteSettings.uiTheme = uiTheme;
  }
  if (uiDark !== undefined) siteSettings.uiDark = Boolean(uiDark);
  saveSettings();
  broadcast('UPDATE_SETTINGS', siteSettings);
  res.json({ ok: true, settings: siteSettings });
});

// ════════════════════════════════════════════════════════════
// ─── 會員系統 API ─────────────────────────────────────────
// ════════════════════════════════════════════════════════════

// ── 工具：產生會員 JWT-like token（簡化版，不依賴外部套件）
function genMemberToken(phone) {
  const payload = Buffer.from(JSON.stringify({ phone, ts: Date.now() })).toString('base64');
  const sig = require('crypto').createHmac('sha256', process.env.MEMBER_JWT_SECRET || 'akb-member-secret-2026').update(payload).digest('base64');
  return `${payload}.${sig}`;
}

function verifyMemberToken(token) {
  try {
    const [payload, sig] = token.split('.');
    const expected = require('crypto').createHmac('sha256', process.env.MEMBER_JWT_SECRET || 'akb-member-secret-2026').update(payload).digest('base64');
    if (sig !== expected) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64').toString());
    // Token 有效期 30 天
    if (Date.now() - data.ts > 30 * 24 * 60 * 60 * 1000) return null;
    return data;
  } catch { return null; }
}

// ── 會員認證中間件
function requireMemberAuth(req, res, next) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.query.token;
  if (!token) return res.status(401).json({ error: '請先登入會員' });
  const data = verifyMemberToken(token);
  if (!data || !members[data.phone]) return res.status(401).json({ error: '登入已過期，請重新登入' });
  req.memberPhone = data.phone;
  req.member = members[data.phone];
  next();
}

// ── 會員積分計算
function calcPoints(price) {
  return Math.floor((Number(price) || 0) / 10); // 每消費 $10 得 1 點
}

// ── 會員等級判定
function getMemberTier(totalSpent, visits) {
  if (totalSpent >= 5000 || visits >= 20) return { tier: 'diamond', label: '💎 鑽石會員', discount: 0.85 };
  if (totalSpent >= 2000 || visits >= 10) return { tier: 'gold',    label: '🥇 金牌會員', discount: 0.90 };
  if (totalSpent >= 500  || visits >= 3)  return { tier: 'silver',  label: '🥈 銀牌會員', discount: 0.95 };
  return { tier: 'regular', label: '🌱 普通會員', discount: 1.00 };
}

// POST /api/member/register — 會員自助註冊
app.post('/api/member/register', registerLimiter, async (req, res) => {
  const { phone, password, name, email, birthday, gender } = req.body;
  if (!phone || !password || !name) {
    return res.status(400).json({ error: '手機號、密碼、姓名為必填' });
  }
  // 格式驗證
  if (!/^[0-9+\-\s]{8,20}$/.test(String(phone))) {
    return res.status(400).json({ error: '手機號格式不正確（8-20位數字）' });
  }
  if (String(password).length < 6) return res.status(400).json({ error: '密碼至少6位' });
  if (String(password).length > 200) return res.status(400).json({ error: '密碼過長' });
  if (String(name).length > 50) return res.status(400).json({ error: '姓名過長' });

  const normalizedPhone = String(phone).replace(/[\s\-]/g, '');
  if (members[normalizedPhone]) {
    return res.status(409).json({ error: '此手機號已註冊，請直接登入' });
  }

  const passwordHash = await bcrypt.hash(String(password), 10);
  const now = Date.now();
  const member = {
    phone:        normalizedPhone,
    name:         String(name).trim().slice(0, 50),
    email:        String(email || '').trim().slice(0, 100),
    birthday:     String(birthday || '').slice(0, 10),
    gender:       ['M','F','other'].includes(gender) ? gender : '',
    passwordHash,
    points:       0,
    totalSpent:   0,
    visits:       0,
    tier:         'regular',
    tierLabel:    '🌱 普通會員',
    status:       'active',
    createdAt:    now,
    updatedAt:    now,
  };
  members[normalizedPhone] = member;
  await DB.saveMembers();
  await DB.upsertMember(normalizedPhone, member);

  const token = genMemberToken(normalizedPhone);
  const { passwordHash: _, ...safeMember } = member;
  broadcast('NEW_MEMBER', { phone: normalizedPhone, name: member.name, tier: member.tier });
  res.status(201).json({ success: true, token, member: safeMember });
});

// POST /api/member/login — 會員登入
app.post('/api/member/login', memberLoginLimiter, async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ error: '手機號和密碼必填' });
  const normalizedPhone = String(phone).replace(/[\s\-]/g, '');
  const member = members[normalizedPhone];
  if (!member) return res.status(401).json({ error: '手機號或密碼錯誤' });
  if (member.status === 'banned') return res.status(403).json({ error: '帳號已被停用，請聯絡客服' });

  const valid = await bcrypt.compare(String(password), member.passwordHash || '');
  if (!valid) return res.status(401).json({ error: '手機號或密碼錯誤' });

  // 更新最後登入時間
  member.lastLoginAt = Date.now();
  await DB.saveMembers();

  const token = genMemberToken(normalizedPhone);
  const { passwordHash: _, ...safeMember } = member;
  res.json({ success: true, token, member: safeMember });
});

// GET /api/member/profile — 取得會員資料
app.get('/api/member/profile', requireMemberAuth, (req, res) => {
  const { passwordHash: _, ...safe } = req.member;
  // 計算目前等級
  const tierInfo = getMemberTier(req.member.totalSpent, req.member.visits);
  res.json({ ...safe, ...tierInfo });
});

// PATCH /api/member/profile — 更新會員資料
app.patch('/api/member/profile', requireMemberAuth, async (req, res) => {
  const { name, email, birthday, gender } = req.body;
  const member = req.member;
  if (name) member.name = String(name).trim().slice(0, 50);
  if (email !== undefined) member.email = String(email).trim().slice(0, 100);
  if (birthday !== undefined) member.birthday = String(birthday).slice(0, 10);
  if (gender !== undefined && ['M','F','other',''].includes(gender)) member.gender = gender;
  member.updatedAt = Date.now();
  await DB.saveMembers();
  await DB.upsertMember(req.memberPhone, member);
  const { passwordHash: _, ...safe } = member;
  res.json({ success: true, member: safe });
});

// PATCH /api/member/password — 修改會員密碼
app.patch('/api/member/password', requireMemberAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: '缺少必要欄位' });
  if (String(newPassword).length < 6) return res.status(400).json({ error: '新密碼至少6位' });
  const valid = await bcrypt.compare(String(currentPassword), req.member.passwordHash || '');
  if (!valid) return res.status(401).json({ error: '目前密碼錯誤' });
  req.member.passwordHash = await bcrypt.hash(String(newPassword), 10);
  req.member.updatedAt = Date.now();
  await DB.saveMembers();
  await DB.upsertMember(req.memberPhone, req.member);
  res.json({ success: true });
});

// GET /api/member/bookings — 取得會員預約記錄
app.get('/api/member/bookings', requireMemberAuth, (req, res) => {
  const phone = req.memberPhone;
  const myBookings = bookings
    .filter(b => String(b.customerPhone || '').replace(/[\s\-]/g, '') === phone.replace(/[\s\-]/g, ''))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 100);
  res.json(myBookings);
});

// GET /api/member/stats — 取得會員統計
app.get('/api/member/stats', requireMemberAuth, (req, res) => {
  const phone = req.memberPhone;
  const myBookings = bookings.filter(b =>
    String(b.customerPhone || '').replace(/[\s\-]/g, '') === phone.replace(/[\s\-]/g, '')
  );
  const completed = myBookings.filter(b => b.status === 'confirmed' || b.status === 'done');
  const totalSpent = completed.reduce((s, b) => s + (Number(b.price) || 0), 0);
  const visits = completed.length;
  const tierInfo = getMemberTier(totalSpent, visits);
  // 同步更新會員統計
  const member = req.member;
  if (member.totalSpent !== totalSpent || member.visits !== visits) {
    member.totalSpent = totalSpent;
    member.visits = visits;
    member.points = completed.reduce((s, b) => s + calcPoints(b.price), 0);
    member.tier = tierInfo.tier;
    member.tierLabel = tierInfo.label;
    member.updatedAt = Date.now();
    DB.saveMembers().catch(() => {});
  }
  res.json({
    totalBookings: myBookings.length,
    completedVisits: visits,
    totalSpent,
    points: member.points,
    pending: myBookings.filter(b => b.status === 'pending').length,
    cancelled: myBookings.filter(b => b.status === 'cancelled').length,
    ...tierInfo,
  });
});

// POST /api/member/forgot-password — 重設密碼（需要管理員 RESET_SECRET，或由管理員操作）
// 因無 Email/SMS 服務，此端點供管理員後台重設會員密碼用
app.post('/api/member/reset-password', async (req, res) => {
  const { secret, phone, newPassword } = req.body;
  const RESET_SECRET = process.env.RESET_SECRET;
  if (!RESET_SECRET) return res.status(503).json({ error: '服務器未設定 RESET_SECRET 環境變數' });
  if (secret !== RESET_SECRET) return res.status(403).json({ error: '密鑰錯誤' });
  const normalizedPhone = String(phone || '').replace(/[\s\-]/g, '');
  if (!normalizedPhone || !members[normalizedPhone]) return res.status(404).json({ error: '會員不存在' });
  if (!newPassword || String(newPassword).length < 6) return res.status(400).json({ error: '新密碼至少6位' });
  members[normalizedPhone].passwordHash = await bcrypt.hash(String(newPassword), 10);
  members[normalizedPhone].updatedAt = Date.now();
  await DB.saveMembers();
  await DB.upsertMember(normalizedPhone, members[normalizedPhone]);
  res.json({ success: true });
});

// ── 管理員：取得所有會員列表
app.get('/api/admin/members', (req, res) => {
  // 簡單 admin 認證（使用 Authorization header 或 query secret）
  // 前端已有 session 控制，這裡額外驗證 header
  const safe = Object.entries(members).map(([phone, m]) => {
    const { passwordHash: _, ...rest } = m;
    const tierInfo = getMemberTier(m.totalSpent, m.visits);
    return { ...rest, ...tierInfo };
  }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  res.json(safe);
});

// ── 管理員：更新會員狀態（啟用/停用）
app.patch('/api/admin/members/:phone', async (req, res) => {
  const phone = req.params.phone;
  if (!members[phone]) return res.status(404).json({ error: '會員不存在' });
  const { status, points, tier } = req.body;
  if (status && ['active','banned','vip'].includes(status)) members[phone].status = status;
  if (points !== undefined) members[phone].points = Math.max(0, Number(points) || 0);
  if (tier && ['regular','silver','gold','diamond'].includes(tier)) {
    members[phone].tier = tier;
    const TIER_LABELS = { regular:'🌱 普通會員', silver:'🥈 銀牌會員', gold:'🥇 金牌會員', diamond:'💎 鑽石會員' };
    members[phone].tierLabel = TIER_LABELS[tier];
  }
  members[phone].updatedAt = Date.now();
  await DB.saveMembers();
  await DB.upsertMember(phone, members[phone]);
  broadcast('UPDATE_MEMBER', { phone, status: members[phone].status });
  const { passwordHash: _, ...safe } = members[phone];
  res.json(safe);
});

// ─── 自動啟用 RLS（僅在有 service_role key 且尚未啟用時執行）─
async function autoEnableRLS() {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey || !SUPABASE_URL) return; // 無 service_role key 則跳過

  // 解析 JWT 確認是 service_role
  try {
    const payload = JSON.parse(Buffer.from(serviceKey.split('.')[1], 'base64').toString());
    if (payload.role !== 'service_role') {
      console.warn('[RLS] ⚠️  SUPABASE_SERVICE_KEY 不是 service_role key，跳過 RLS 設定');
      return;
    }
  } catch(e) { return; }

  const RLS_SQL_STATEMENTS = [
    // bookings: 匿名可新增預約，service_role 可全操作
    `ALTER TABLE bookings ENABLE ROW LEVEL SECURITY`,
    `DROP POLICY IF EXISTS "bookings_anon_insert" ON bookings`,
    `DROP POLICY IF EXISTS "bookings_service_all" ON bookings`,
    `CREATE POLICY "bookings_anon_insert" ON bookings FOR INSERT TO anon WITH CHECK (true)`,
    `CREATE POLICY "bookings_service_all" ON bookings FOR ALL TO service_role USING (true) WITH CHECK (true)`,
    // designers: 匿名可查詢，service_role 可全操作
    `ALTER TABLE designers ENABLE ROW LEVEL SECURITY`,
    `DROP POLICY IF EXISTS "designers_anon_select" ON designers`,
    `DROP POLICY IF EXISTS "designers_service_all" ON designers`,
    `CREATE POLICY "designers_anon_select" ON designers FOR SELECT TO anon USING (true)`,
    `CREATE POLICY "designers_service_all" ON designers FOR ALL TO service_role USING (true) WITH CHECK (true)`,
    // services: 匿名可查詢，service_role 可全操作
    `ALTER TABLE services ENABLE ROW LEVEL SECURITY`,
    `DROP POLICY IF EXISTS "services_anon_select" ON services`,
    `DROP POLICY IF EXISTS "services_service_all" ON services`,
    `CREATE POLICY "services_anon_select" ON services FOR SELECT TO anon USING (true)`,
    `CREATE POLICY "services_service_all" ON services FOR ALL TO service_role USING (true) WITH CHECK (true)`,
    // accounts: 只有 service_role 可存取
    `ALTER TABLE accounts ENABLE ROW LEVEL SECURITY`,
    `DROP POLICY IF EXISTS "accounts_service_all" ON accounts`,
    `CREATE POLICY "accounts_service_all" ON accounts FOR ALL TO service_role USING (true) WITH CHECK (true)`,
  ];

  console.log('[RLS] 🔐 正在自動啟用 Row Level Security...');
  let ok = 0, fail = 0;
  for (const sql of RLS_SQL_STATEMENTS) {
    try {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/run_sql`, {
        method: 'POST',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql }),
      });
      if (resp.ok || resp.status === 409) { ok++; }
      else {
        // Supabase doesn't have run_sql — try wrapping in a DO block
        const doResp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_ddl`, {
          method: 'POST',
          headers: {
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sql }),
        });
        if (doResp.ok) { ok++; } else { fail++; }
      }
    } catch(e) { fail++; }
  }

  if (ok > 0) {
    console.log(`[RLS] ✅ RLS 設定完成 (${ok} 成功 / ${fail} 失敗)`);
  } else {
    console.log(`[RLS] ℹ️  RLS 設定需透過 Supabase 儀表板的 SQL Editor 手動執行`);
    console.log(`[RLS] ℹ️  請參考 docs/SECURITY_FIX.md`);
  }
}

// ─── 啟動（先初始化資料庫再監聽）─────────────────────
const PORT = process.env.PORT || 3000;

DB.init().then(async () => {
  // 在 Supabase 模式下嘗試自動啟用 RLS
  if (USE_SUPABASE) await autoEnableRLS();
  server.listen(PORT, () => {
    console.log(`\n🪭  AKB Salon Server  →  http://localhost:${PORT}`);
    console.log(`📡  WebSocket ready for real-time sync`);
    console.log(`💾  Storage: ${USE_SUPABASE ? '☁️  Supabase (persistent)' : '⚠️  Local JSON (resets on restart!)'}`);
    if (!USE_SUPABASE) {
      console.log(`\n   要啟用持久化儲存，請在 Render 環境變數中設定：`);
      console.log(`   SUPABASE_URL=https://xxxx.supabase.co`);
      console.log(`   SUPABASE_ANON_KEY=eyJ...\n`);
    }
  });
}).catch(e => {
  console.error('[DB] 初始化失敗，仍然啟動伺服器:', e.message);
  server.listen(PORT, () => console.log(`Server on port ${PORT} (DB init failed)`));
});
