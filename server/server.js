const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 中間件
app.use(cors());
app.use(express.json());

// 資料儲存檔案路徑
const DATA_DIR = path.join(__dirname, 'data');
const BOOKINGS_FILE = path.join(DATA_DIR, 'bookings.json');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const CUSTOMERS_FILE = path.join(DATA_DIR, 'customers.json');

// 確保資料目錄存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 讀取資料檔案
function loadData(filePath, defaultValue = []) {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error(`Error loading ${filePath}:`, error);
  }
  return defaultValue;
}

// 儲存資料檔案
function saveData(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error(`Error saving ${filePath}:`, error);
    return false;
  }
}

// 記憶體中的資料
let bookings = loadData(BOOKINGS_FILE, []);
let accounts = loadData(ACCOUNTS_FILE, {});
let customers = loadData(CUSTOMERS_FILE, []);

// WebSocket 連線管理
const clients = new Set();

wss.on('connection', (ws) => {
  console.log('New WebSocket client connected');
  clients.add(ws);

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    clients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// 廣播訊息給所有連線的客戶端
function broadcast(type, data) {
  const message = JSON.stringify({ type, data, timestamp: Date.now() });
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// ========== REST API ==========

// 健康檢查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ========== 預約 API ==========

// 獲取所有預約
app.get('/api/bookings', (req, res) => {
  res.json(bookings);
});

// 創建新預約
app.post('/api/bookings', (req, res) => {
  const booking = {
    id: 'BK' + Date.now().toString().slice(-6),
    ...req.body,
    status: 'pending',
    createdAt: Date.now()
  };
  
  bookings.push(booking);
  saveData(BOOKINGS_FILE, bookings);
  
  // 廣播新預約給所有連線的客戶端
  broadcast('NEW_BOOKING', booking);
  
  res.status(201).json(booking);
});

// 更新預約狀態
app.patch('/api/bookings/:id', (req, res) => {
  const { id } = req.params;
  const index = bookings.findIndex(b => b.id === id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Booking not found' });
  }
  
  bookings[index] = { ...bookings[index], ...req.body, updatedAt: Date.now() };
  saveData(BOOKINGS_FILE, bookings);
  
  // 廣播更新給所有連線的客戶端
  broadcast('UPDATE_BOOKING', bookings[index]);
  
  res.json(bookings[index]);
});

// 刪除預約
app.delete('/api/bookings/:id', (req, res) => {
  const { id } = req.params;
  const index = bookings.findIndex(b => b.id === id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Booking not found' });
  }
  
  const deleted = bookings.splice(index, 1)[0];
  saveData(BOOKINGS_FILE, bookings);
  
  broadcast('DELETE_BOOKING', { id });
  
  res.json(deleted);
});

// ========== 客戶帳號 API ==========

// 獲取所有帳號
app.get('/api/accounts', (req, res) => {
  res.json(accounts);
});

// 創建/更新客戶帳號
app.post('/api/accounts/:phone', (req, res) => {
  const { phone } = req.params;
  accounts[phone] = {
    ...req.body,
    updatedAt: Date.now()
  };
  saveData(ACCOUNTS_FILE, accounts);
  
  broadcast('UPDATE_ACCOUNT', { phone, ...accounts[phone] });
  
  res.json(accounts[phone]);
});

// ========== 客戶資料 API ==========

// 獲取客戶列表（從預約資料統計）
app.get('/api/customers', (req, res) => {
  // 按手機號碼分組統計
  const customerMap = {};
  
  bookings.forEach(b => {
    const phone = b.customerPhone || '';
    const name = b.customerName || '未知客戶';
    const key = phone || name;
    
    if (!customerMap[key]) {
      customerMap[key] = {
        id: key,
        name: name,
        phone: phone,
        visits: 0,
        totalSpent: 0
      };
    }
    
    if (b.status === 'confirmed' || b.status === 'done') {
      customerMap[key].visits++;
      customerMap[key].totalSpent += parseInt(b.price) || 0;
    }
  });
  
  const customersList = Object.values(customerMap);
  res.json(customersList);
});

// 啟動伺服器
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`AKB Salon Server running on port ${PORT}`);
  console.log(`WebSocket server ready for real-time sync`);
});
