const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 中間件
app.use(cors({
  origin: function(origin, callback) {
    // 允許無 origin（curl / 伺服端）、指定域名、本機開發
    const allowed = [
      'https://akbmusicsalon.top',
      'https://www.akbmusicsalon.top',
      'http://localhost:3000',
      'http://localhost:8080',
      'http://127.0.0.1:8080',
      'http://127.0.0.1:3000',
    ];
    if (!origin || allowed.includes(origin) || /\.github\.io$/.test(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // 開發期間放行所有來源，上線後可改為 callback(new Error('Not allowed'))
    }
  },
  methods: ['GET','POST','PATCH','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: false,
}));
app.options('*', cors()); // 預先回應 preflight
app.use(express.json());

// ========== 資料層 ==========
const DATA_DIR = path.join(__dirname, 'data');
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

// ========== 預設資料 ==========
const DEFAULT_DESIGNERS = [
  { id:1, name:'Aika',  role:'首席設計師', level:'A', specialty:['挑染','剪髮'], bio:'擅長各種染髮技術，尤其是挑染與漸層。', avatar:'A', rating:4.9, reviews:128, works:350, available:true,  status:'active' },
  { id:2, name:'Ken',   role:'資深設計師', level:'B', specialty:['燙髮','護髮'], bio:'燙髮專家，各種捲度任您選擇。',         avatar:'K', rating:4.8, reviews:95,  works:280, available:true,  status:'active' },
  { id:3, name:'Bella', role:'設計師',     level:'C', specialty:['護髮','染髮'], bio:'護髮療程專業，讓頭髮重拾光澤。',       avatar:'B', rating:4.7, reviews:67,  works:190, available:true,  status:'active' },
  { id:4, name:'Sam',   role:'助理設計師', level:'D', specialty:['剪髮'],        bio:'剪髮造型新銳，充滿創意。',             avatar:'S', rating:4.6, reviews:42,  works:110, available:false, status:'leave'   },
  { id:5, name:'Luna',  role:'設計師',     level:'C', specialty:['染髮','剪髮'], bio:'色彩搭配達人，精準掌握您的理想色調。', avatar:'L', rating:4.8, reviews:88,  works:230, available:true,  status:'active'  },
];

const DEFAULT_SERVICES = [
  { id:1, name:'剪髮造型', category:'基礎', duration:60,  price:600,  description:'專業剪髮造型，修飾臉型輪廓。' },
  { id:2, name:'燙髮',     category:'進階', duration:150, price:2800, description:'多種燙髮技術，創造理想捲度。' },
  { id:3, name:'染髮',     category:'進階', duration:120, price:2200, description:'時尚髮色，多色可選，持久顯色。' },
  { id:4, name:'挑染',     category:'進階', duration:150, price:3200, description:'手工挑染，打造自然漸層感。' },
  { id:5, name:'護髮療程', category:'護理', duration:60,  price:1200, description:'深層護髮，修復受損髮質。' },
  { id:6, name:'頭皮護理', category:'護理', duration:45,  price:900,  description:'頭皮深層清潔，改善髮根健康。' },
];

// 預設帳號（密碼加簡單前綴）
const DEFAULT_ACCOUNTS = {
  admin:    { role: 'admin',    passwordHash: 'plain:akb2024',   name: '店長' },
  aika:     { role: 'designer', passwordHash: 'plain:aika123',   name: 'Aika',  designerId: 1 },
  ken:      { role: 'designer', passwordHash: 'plain:ken123',    name: 'Ken',   designerId: 2 },
  bella:    { role: 'designer', passwordHash: 'plain:bella123',  name: 'Bella', designerId: 3 },
  sam:      { role: 'designer', passwordHash: 'plain:sam123',    name: 'Sam',   designerId: 4 },
  luna:     { role: 'designer', passwordHash: 'plain:luna123',   name: 'Luna',  designerId: 5 },
};

// 記憶體資料
let bookings  = loadData(FILES.bookings,  []);
let designers = loadData(FILES.designers, DEFAULT_DESIGNERS);
let services  = loadData(FILES.services,  DEFAULT_SERVICES);
let accounts  = loadData(FILES.accounts,  DEFAULT_ACCOUNTS);

// 首次執行確保預設資料存檔
if (!fs.existsSync(FILES.designers)) saveData(FILES.designers, designers);
if (!fs.existsSync(FILES.services))  saveData(FILES.services,  services);
if (!fs.existsSync(FILES.accounts))  saveData(FILES.accounts,  accounts);

// ========== WebSocket 廣播 ==========
const clients = new Set();

wss.on('connection', (ws) => {
  console.log('[WS] Client connected, total:', clients.size + 1);
  clients.add(ws);

  // 連線後立即推送一次當前資料快照
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

// ========== 工具函數 ==========
function genId(prefix) {
  return prefix + Date.now().toString().slice(-8) + Math.floor(Math.random() * 100);
}

// ========== API 路由 ==========

// 健康檢查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', bookings: bookings.length, designers: designers.length, clients: clients.size, timestamp: new Date().toISOString() });
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

app.post('/api/bookings', (req, res) => {
  // 基本驗證
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
  saveData(FILES.bookings, bookings);
  broadcast('NEW_BOOKING', booking);

  res.status(201).json(booking);
});

app.patch('/api/bookings/:id', (req, res) => {
  const idx = bookings.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '找不到預約' });

  bookings[idx] = { ...bookings[idx], ...req.body, updatedAt: Date.now() };
  saveData(FILES.bookings, bookings);
  broadcast('UPDATE_BOOKING', bookings[idx]);

  res.json(bookings[idx]);
});

app.delete('/api/bookings/:id', (req, res) => {
  const idx = bookings.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '找不到預約' });

  const deleted = bookings.splice(idx, 1)[0];
  saveData(FILES.bookings, bookings);
  broadcast('DELETE_BOOKING', { id: req.params.id });

  res.json(deleted);
});

// ─── 設計師 ───────────────────────────────────────────

app.get('/api/designers', (req, res) => {
  const { available, status } = req.query;
  let result = [...designers];
  if (available !== undefined) result = result.filter(d => d.available === (available === 'true'));
  if (status)                  result = result.filter(d => d.status === status);
  res.json(result);
});

app.get('/api/designers/:id', (req, res) => {
  const d = designers.find(d => d.id === Number(req.params.id));
  if (!d) return res.status(404).json({ error: '找不到設計師' });
  res.json(d);
});

app.post('/api/designers', (req, res) => {
  if (!req.body.name) return res.status(400).json({ error: '設計師名稱必填' });

  const newDesigner = {
    id: Math.max(...designers.map(d => d.id), 0) + 1,
    rating: 5.0,
    reviews: 0,
    works: 0,
    available: true,
    status: 'active',
    ...req.body,
    createdAt: Date.now()
  };

  designers.push(newDesigner);
  saveData(FILES.designers, designers);
  broadcast('NEW_DESIGNER', newDesigner);

  res.status(201).json(newDesigner);
});

app.patch('/api/designers/:id', (req, res) => {
  const idx = designers.findIndex(d => d.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: '找不到設計師' });

  designers[idx] = { ...designers[idx], ...req.body, updatedAt: Date.now() };
  saveData(FILES.designers, designers);
  broadcast('UPDATE_DESIGNER', designers[idx]);

  res.json(designers[idx]);
});

app.delete('/api/designers/:id', (req, res) => {
  const idx = designers.findIndex(d => d.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: '找不到設計師' });

  designers[idx] = { ...designers[idx], status: 'resigned', available: false, updatedAt: Date.now() };
  saveData(FILES.designers, designers);
  broadcast('UPDATE_DESIGNER', designers[idx]);

  res.json(designers[idx]);
});

// ─── 服務項目 ─────────────────────────────────────────

app.get('/api/services', (req, res) => res.json(services));

app.post('/api/services', (req, res) => {
  if (!req.body.name) return res.status(400).json({ error: '服務名稱必填' });

  const newSvc = {
    id: Math.max(...services.map(s => s.id), 0) + 1,
    category: '基礎',
    duration: 60,
    description: '',
    ...req.body,
    createdAt: Date.now()
  };

  services.push(newSvc);
  saveData(FILES.services, services);
  broadcast('UPDATE_SERVICES', services);

  res.status(201).json(newSvc);
});

app.patch('/api/services/:id', (req, res) => {
  const idx = services.findIndex(s => s.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: '找不到服務' });

  services[idx] = { ...services[idx], ...req.body, updatedAt: Date.now() };
  saveData(FILES.services, services);
  broadcast('UPDATE_SERVICES', services);

  res.json(services[idx]);
});

app.delete('/api/services/:id', (req, res) => {
  const idx = services.findIndex(s => s.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: '找不到服務' });

  const deleted = services.splice(idx, 1)[0];
  saveData(FILES.services, services);
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
      customerMap[key] = {
        id: key,
        name:  b.customerName  || '未知',
        phone: b.customerPhone || '',
        visits: 0,
        totalSpent: 0,
        lastVisit: '',
        firstVisit: b.date || ''
      };
    }

    if (b.status === 'confirmed' || b.status === 'done') {
      customerMap[key].visits++;
      customerMap[key].totalSpent += Number(b.price) || 0;
      if (!customerMap[key].lastVisit || b.date > customerMap[key].lastVisit) {
        customerMap[key].lastVisit = b.date;
      }
      if (b.date < customerMap[key].firstVisit) {
        customerMap[key].firstVisit = b.date;
      }
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

  // 目前用 plain: 前綴，可之後替換為 bcrypt
  const storedPwd = account.passwordHash.startsWith('plain:')
    ? account.passwordHash.slice(6)
    : account.passwordHash;

  if (storedPwd !== password) return res.status(401).json({ error: '密碼錯誤' });

  res.json({
    success: true,
    role:       account.role,
    name:       account.name,
    designerId: account.designerId || null
  });
});

app.patch('/api/auth/password', (req, res) => {
  const { username, currentPassword, newPassword } = req.body;
  if (!username || !currentPassword || !newPassword) {
    return res.status(400).json({ error: '缺少必要欄位' });
  }

  const account = accounts[username.toLowerCase()];
  if (!account) return res.status(404).json({ error: '帳號不存在' });

  const storedPwd = account.passwordHash.startsWith('plain:')
    ? account.passwordHash.slice(6)
    : account.passwordHash;

  if (storedPwd !== currentPassword) return res.status(401).json({ error: '目前密碼錯誤' });
  if (newPassword.length < 6) return res.status(400).json({ error: '新密碼至少6位' });

  account.passwordHash = 'plain:' + newPassword;
  account.updatedAt = Date.now();
  saveData(FILES.accounts, accounts);

  res.json({ success: true });
});

app.get('/api/accounts', (req, res) => {
  // 不回傳密碼
  const safe = {};
  Object.entries(accounts).forEach(([k, v]) => {
    safe[k] = { role: v.role, name: v.name, designerId: v.designerId };
  });
  res.json(safe);
});

// 客戶帳號（手機為 key）
app.post('/api/accounts/:phone', (req, res) => {
  const { phone } = req.params;
  accounts[phone] = { ...req.body, updatedAt: Date.now() };
  saveData(FILES.accounts, accounts);
  broadcast('UPDATE_ACCOUNT', { phone, ...accounts[phone] });
  res.json(accounts[phone]);
});

// ─── 統計報表 ─────────────────────────────────────────

app.get('/api/stats', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  const lastMonth = (() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 7);
  })();

  const confirmed = bookings.filter(b => b.status === 'confirmed' || b.status === 'done');

  const todayBookings  = bookings.filter(b => b.date === today && b.status !== 'cancelled');
  const pendingCount   = bookings.filter(b => b.status === 'pending').length;
  const monthRevenue   = confirmed.filter(b => b.date.startsWith(thisMonth)).reduce((s, b) => s + (Number(b.price) || 0), 0);
  const lastMonthRevenue = confirmed.filter(b => b.date.startsWith(lastMonth)).reduce((s, b) => s + (Number(b.price) || 0), 0);

  // 客戶數（不重複手機）
  const uniquePhones = new Set(bookings.map(b => (b.customerPhone || '').replace(/\D/g, '')).filter(Boolean));
  const totalCustomers = uniquePhones.size;

  // 服務熱度排名
  const svcCount = {};
  confirmed.forEach(b => {
    svcCount[b.serviceName] = (svcCount[b.serviceName] || 0) + 1;
  });
  const topServices = Object.entries(svcCount)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // 設計師業績
  const designerRevenue = {};
  confirmed.filter(b => b.date.startsWith(thisMonth)).forEach(b => {
    const name = b.designerName || b.designerId || '未知';
    designerRevenue[name] = (designerRevenue[name] || 0) + (Number(b.price) || 0);
  });
  const topDesigners = Object.entries(designerRevenue)
    .map(([name, revenue]) => ({ name, revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  res.json({
    today:        todayBookings.length,
    pending:      pendingCount,
    monthRevenue,
    lastMonthRevenue,
    revenueGrowth: lastMonthRevenue > 0 ? Math.round((monthRevenue - lastMonthRevenue) / lastMonthRevenue * 100) : null,
    totalCustomers,
    totalBookings: bookings.filter(b => b.status !== 'cancelled').length,
    topServices,
    topDesigners,
  });
});

// ─── 啟動 ─────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🪭  AKB Salon Server  →  http://localhost:${PORT}`);
  console.log(`📡  WebSocket ready for real-time sync`);
  console.log(`📦  Data directory: ${DATA_DIR}\n`);
});
