const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

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
const SUPABASE_KEY  = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '';
const USE_SUPABASE  = !!(SUPABASE_URL && SUPABASE_KEY);

// ── 本地 JSON 後備 ──────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'server', 'data');
const FILES = {
  bookings:  path.join(DATA_DIR, 'bookings.json'),
  designers: path.join(DATA_DIR, 'designers.json'),
  services:  path.join(DATA_DIR, 'services.json'),
  accounts:  path.join(DATA_DIR, 'accounts.json'),
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
  // POST 需要回傳新記錄；PATCH/DELETE 用 minimal 節省帶寬
  const prefer = (method === 'POST') ? 'return=representation' : 'return=minimal';
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

const DEFAULT_ACCOUNTS = {
  admin: { role: 'admin',    passwordHash: 'plain:akb2024',   name: '店長' },
  aika:  { role: 'designer', passwordHash: 'plain:aika123',   name: 'Aika',  designerId: 1 },
  ken:   { role: 'designer', passwordHash: 'plain:ken123',    name: 'Ken',   designerId: 2 },
  bella: { role: 'designer', passwordHash: 'plain:bella123',  name: 'Bella', designerId: 3 },
  sam:   { role: 'designer', passwordHash: 'plain:sam123',    name: 'Sam',   designerId: 4 },
  luna:  { role: 'designer', passwordHash: 'plain:luna123',   name: 'Luna',  designerId: 5 },
};

// ========== 記憶體資料（本地模式） ==========
let bookings  = [];
let designers = [];
let services  = [];
let accounts  = {};

// ── Supabase 資料層 ──────────────────────────────────────
const DB = {
  // Supabase 初始化：讀取所有資料表；若不存在則寫入預設值
  async init() {
    if (USE_SUPABASE) {
      console.log('[DB] 使用 Supabase 雲端資料庫:', SUPABASE_URL);
      try {
        // 載入預約
        bookings = await sbFetch('GET', 'bookings', null, '?order=created_at.desc');
        console.log('[DB] 預約載入成功，共', bookings.length, '筆');
      } catch(e) {
        console.warn('[DB] 預約表不存在或無資料，初始化空陣列:', e.message);
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
    } else {
      // ── 本地 JSON 模式 ──────────────────────────────────
      console.log('[DB] ⚠️  未設定 SUPABASE_URL/SUPABASE_ANON_KEY，使用本地 JSON 文件');
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

  // ── Supabase 逐筆寫入 ────────────────────────────────
  async upsertBooking(b) {
    if (!USE_SUPABASE) return;
    try { await sbFetch('POST', 'bookings', b, '?on_conflict=id'); } catch(e) { console.warn('[DB] upsertBooking:', e.message); }
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
  const { customerName, customerPhone, date, time, designerId, serviceName } = req.body;
  if (!customerName || !customerPhone || !date || !time || !designerId || !serviceName) {
    return res.status(400).json({ error: '缺少必要欄位' });
  }
  const booking = {
    id: 'BK' + Date.now().toString().slice(-6),
    ...req.body,
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
  bookings[idx] = { ...bookings[idx], ...req.body, updatedAt: Date.now() };
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
  const newDesigner = {
    id: Math.max(...designers.map(d => d.id), 0) + 1,
    rating: 5.0, reviews: 0, works: 0, available: true, status: 'active',
    ...req.body, createdAt: Date.now()
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
  designers[idx] = { ...designers[idx], ...req.body, updatedAt: Date.now() };
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
  const newSvc = {
    id: Math.max(...services.map(s => s.id), 0) + 1,
    category: '基礎', duration: 60, description: '',
    ...req.body, createdAt: Date.now()
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
  services[idx] = { ...services[idx], ...req.body, updatedAt: Date.now() };
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
    const key = (b.customerPhone || '').replace(/\D/g, '') || b.customerName || '';
    if (!key) return;
    if (!customerMap[key]) {
      customerMap[key] = { id: key, name: b.customerName||'未知', phone: b.customerPhone||'',
        visits: 0, totalSpent: 0, lastVisit: '', firstVisit: b.date||'' };
    }
    if (b.status === 'confirmed' || b.status === 'done') {
      customerMap[key].visits++;
      customerMap[key].totalSpent += Number(b.price) || 0;
      if (!customerMap[key].lastVisit || b.date > customerMap[key].lastVisit) customerMap[key].lastVisit = b.date;
      if (b.date < customerMap[key].firstVisit) customerMap[key].firstVisit = b.date;
    }
  });
  res.json(Object.values(customerMap).sort((a, b) => b.totalSpent - a.totalSpent));
});

// ─── 帳號 & 認證 ──────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '帳號密碼必填' });
  const account = accounts[username.toLowerCase()];
  if (!account) return res.status(401).json({ error: '帳號不存在' });
  const storedPwd = (account.passwordHash || account.password_hash || '').startsWith('plain:')
    ? (account.passwordHash || account.password_hash).slice(6)
    : (account.passwordHash || account.password_hash || '');
  if (storedPwd !== password) return res.status(401).json({ error: '密碼錯誤' });
  res.json({ success: true, role: account.role, name: account.name, designerId: account.designerId || null });
});

app.patch('/api/auth/password', async (req, res) => {
  const { username, currentPassword, newPassword } = req.body;
  if (!username || !currentPassword || !newPassword) return res.status(400).json({ error: '缺少必要欄位' });
  const account = accounts[username.toLowerCase()];
  if (!account) return res.status(404).json({ error: '帳號不存在' });
  const hash = account.passwordHash || account.password_hash || '';
  const storedPwd = hash.startsWith('plain:') ? hash.slice(6) : hash;
  if (storedPwd !== currentPassword) return res.status(401).json({ error: '目前密碼錯誤' });
  if (newPassword.length < 6) return res.status(400).json({ error: '新密碼至少6位' });

  account.passwordHash = 'plain:' + newPassword;
  account.updatedAt = Date.now();
  await DB.saveAccounts();
  await DB.upsertAccount(username.toLowerCase(), { passwordHash: 'plain:' + newPassword, updatedAt: account.updatedAt });
  broadcast('UPDATE_ACCOUNT', { username: username.toLowerCase(), role: account.role, name: account.name });
  res.json({ success: true });
});

// 緊急密碼重設（需要 RESET_SECRET 環境變數，預設為 akb-reset-2026）
app.post('/api/auth/reset', async (req, res) => {
  const { secret, username, newPassword } = req.body;
  const RESET_SECRET = process.env.RESET_SECRET || 'akb-reset-2026';
  if (secret !== RESET_SECRET) return res.status(403).json({ error: '密鑰錯誤' });
  if (!username || !newPassword) return res.status(400).json({ error: '缺少欄位' });
  if (newPassword.length < 6) return res.status(400).json({ error: '密碼至少6位' });
  if (!accounts[username.toLowerCase()]) return res.status(404).json({ error: '帳號不存在' });
  accounts[username.toLowerCase()].passwordHash = 'plain:' + newPassword;
  accounts[username.toLowerCase()].updatedAt = Date.now();
  await DB.saveAccounts();
  await DB.upsertAccount(username.toLowerCase(), { passwordHash: 'plain:' + newPassword, updatedAt: accounts[username.toLowerCase()].updatedAt });
  broadcast('UPDATE_ACCOUNT', { username: username.toLowerCase() });
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
  accounts[phone] = { ...accounts[phone], ...req.body, updatedAt: Date.now() };
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

// ─── 啟動（先初始化資料庫再監聽）─────────────────────
const PORT = process.env.PORT || 3001;

DB.init().then(() => {
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
