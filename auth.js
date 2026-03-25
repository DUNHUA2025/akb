// AKB 多元化音樂發廊 - 共用權限模組
// 登入 / 修改密碼 均走後端 API (PATCH /api/auth/password, POST /api/auth/login)
// localStorage 僅儲存 session token，不儲存密碼

const AUTH_STORAGE_KEY = 'akb_auth_config';
const SESSION_KEY      = 'akb_session';
const SESSION_TTL      = 7 * 24 * 60 * 60 * 1000; // 7 天

// ── 取得後端 API 地址 ────────────────────────────────────────
const RENDER_API = 'https://akb-salon-server.onrender.com';

function getApiBase() {
  if (typeof window !== 'undefined' && window.AKB_API_URL) return window.AKB_API_URL;
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:3001';
    // GitHub Pages 或其他部署：使用 Render 後端
    return RENDER_API;
  }
  return RENDER_API;
}

// ── HTTP 輔助 ────────────────────────────────────────────────
async function authFetch(method, path, body) {
  const base = getApiBase();
  if (!base) throw new Error('未設定後端地址');
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── 後備：本地帳號（僅在後端不可用時使用）──────────────────
const LOCAL_ACCOUNTS = {
  admin: { username: 'admin', password: 'Hk888888', role: 'admin', name: '店長',
    permissions: ['dashboard','bookings','designers','customers','services'] },
  designers: [
    { username: 'aika',  password: 'Aa888888',  role: 'designer', name: 'A Li 亞力', designerId: 1 },
    { username: 'ken',   password: 'ken123',    role: 'designer', name: 'QiQi',      designerId: 2 },
    { username: 'bella', password: 'bella123',  role: 'designer', name: 'Bella',     designerId: 3 },
    { username: 'jay',   password: 'jay123',    role: 'designer', name: 'Jay',       designerId: 4 },
    { username: 'mia',   password: 'mia123',    role: 'designer', name: 'Mia',       designerId: 5 },
  ]
};

function localLogin(username, password) {
  const u = username.toLowerCase();
  if (u === LOCAL_ACCOUNTS.admin.username && password === LOCAL_ACCOUNTS.admin.password) {
    return { success: true, role: 'admin', name: LOCAL_ACCOUNTS.admin.name };
  }
  const d = LOCAL_ACCOUNTS.designers.find(x => x.username === u && x.password === password);
  if (d) return { success: true, role: 'designer', name: d.name, designerId: d.designerId };
  return { success: false, error: '帳號或密碼錯誤' };
}

// ── Auth 物件 ────────────────────────────────────────────────
const Auth = {

  // 檢查是否已登入
  isLoggedIn() {
    const s = this.getSession();
    return !!s;
  },

  // 取得當前 session
  getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (Date.now() - data.timestamp > SESSION_TTL) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      return data;
    } catch { return null; }
  },

  // ── 登入（後端優先，回退本地）─────────────────────────────
  // 重要：只有在後端「無法連線」時才回退本地；若後端明確拒絕（401/密碼錯誤），不回退
  async loginAsync(username, password) {
    try {
      const result = await authFetch('POST', '/api/auth/login', { username, password });
      // 成功 → 建立 session
      const session = {
        username: username.toLowerCase(),
        role:       result.role,
        name:       result.name,
        designerId: result.designerId || null,
        timestamp:  Date.now(),
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      return { success: true, role: result.role, designerId: result.designerId };
    } catch (e) {
      const msg = e.message || '';
      // 若後端明確拒絕（401/403/密碼錯誤），直接回傳錯誤，不允許任何繞過
      if (msg.includes('401') || msg.includes('密碼') || msg.includes('帳號') || msg.includes('403')) {
        return { success: false, error: msg || '帳號或密碼錯誤' };
      }
      // 後端無法連線（網路錯誤、冷啟動 timeout）→ 不允許本地繞過，提示用戶稍後重試
      // 重要：本地帳號密碼是寫死的初始值，修改過密碼的帳號無法在離線模式正確驗證
      console.warn('[Auth] 後端無法連線:', msg);
      return { success: false, error: '服務器啟動中，請稍等 30 秒後重試' };
    }
  },

  // 同步版 login（向後兼容舊代碼，但登入頁已改用 loginAsync）
  // 本方法已停用本地後備：本地帳號密碼是寫死的初始值，修改密碼後會驗證失敗
  login(username, password) {
    // 委派給 loginAsync，同步回傳暫定失敗，背景更新 session
    this.loginAsync(username, password).then(r => {
      // 結果由 loginAsync 處理（session 已在內部設定）
      console.info('[Auth] login 背景完成:', r.success);
    });
    // 同步版不再支援本地後備，回傳 pending 狀態
    return { success: false, error: '請使用非同步登入' };
  },

  // 登出
  logout() {
    localStorage.removeItem(SESSION_KEY);
  },

  // 檢查權限
  hasPermission(requiredRole) {
    const s = this.getSession();
    if (!s) return false;
    if (requiredRole === 'admin')    return s.role === 'admin';
    if (requiredRole === 'designer') return s.role === 'designer' || s.role === 'admin';
    return true;
  },

  // 保護頁面
  protect(role, redirectUrl = '../index.html') {
    if (!this.isLoggedIn() || !this.hasPermission(role)) {
      window.location.href = redirectUrl;
      return false;
    }
    return true;
  },

  // ── 修改密碼（後端優先，同步到所有設備）──────────────────
  async changePasswordAsync(currentPassword, newPassword) {
    const session = this.getSession();
    if (!session) return { success: false, error: '請先登入' };

    try {
      // 呼叫後端 API — 密碼改動會持久化到 server/data/accounts.json
      await authFetch('PATCH', '/api/auth/password', {
        username:        session.username,
        currentPassword,
        newPassword,
      });
      // 刷新 session 時間戳
      session.timestamp = Date.now();
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message || '密碼修改失敗' };
    }
  },

  // 同步版 changePassword（向後兼容舊調用，已改為直接委派 async 版本）
  // 注意：此版本不再偽造成功，舊調用應改用 changePasswordAsync()
  changePassword(currentPassword, newPassword) {
    // 委派給非同步版，回傳 Promise（調用方若不處理 Promise 結果，行為同舊版）
    return this.changePasswordAsync(currentPassword, newPassword);
  },

  // 驗證密碼強度
  validatePassword(password) {
    if (!password || password.length < 6) {
      return { valid: false, error: '密碼長度至少6位' };
    }
    return { valid: true };
  },
};

// 匯出供其他模組使用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Auth };
}
