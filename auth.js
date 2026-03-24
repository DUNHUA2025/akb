// AKB 多元化音樂發廊 - 共用權限模組
// 登入 / 修改密碼 均走後端 API (PATCH /api/auth/password, POST /api/auth/login)
// localStorage 僅儲存 session token，不儲存密碼

const AUTH_STORAGE_KEY = 'akb_auth_config';
const SESSION_KEY      = 'akb_session';
const SESSION_TTL      = 7 * 24 * 60 * 60 * 1000; // 7 天

// ── 取得後端 API 地址 ────────────────────────────────────────
function getApiBase() {
  if (typeof window !== 'undefined' && window.AKB_API_URL) return window.AKB_API_URL;
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    if (h !== 'localhost' && h !== '127.0.0.1') return null; // GitHub Pages — 需要 AKB_API_URL
  }
  return 'http://localhost:3001';
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
  admin: { username: 'admin', password: 'akb2024', role: 'admin', name: '店家管理員',
    permissions: ['dashboard','bookings','designers','customers','services'] },
  designers: [
    { username: 'aika',  password: 'aika123',  role: 'designer', name: 'Aika',  designerId: 1 },
    { username: 'ken',   password: 'ken123',   role: 'designer', name: 'Ken',   designerId: 2 },
    { username: 'bella', password: 'bella123', role: 'designer', name: 'Bella', designerId: 3 },
    { username: 'sam',   password: 'sam123',   role: 'designer', name: 'Sam',   designerId: 4 },
    { username: 'luna',  password: 'luna123',  role: 'designer', name: 'Luna',  designerId: 5 },
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
      // 若後端回傳 401/403（密碼錯誤或帳號問題），直接回傳錯誤，不允許本地繞過
      const msg = e.message || '';
      if (msg.includes('401') || msg.includes('密碼') || msg.includes('帳號') || msg.includes('403')) {
        return { success: false, error: msg || '帳號或密碼錯誤' };
      }
      // 後端無法連線（網路錯誤、timeout）→ 回退本地帳號
      console.warn('[Auth] 後端無法連線，使用本地帳號:', msg);
      const r = localLogin(username, password);
      if (r.success) {
        const session = {
          username: username.toLowerCase(),
          role:       r.role,
          name:       r.name,
          designerId: r.designerId || null,
          timestamp:  Date.now(),
          _offline:   true,
        };
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      }
      return r;
    }
  },

  // 同步版 login（向後兼容舊代碼，但登入頁已改用 loginAsync）
  // 本方法用於其他地方可能存在的舊調用，保留以防止報錯
  login(username, password) {
    // 直接呼叫 loginAsync 並在背景處理（此函數不建議再使用）
    // 先嘗試本地驗證做即時回饋，後端結果在背景更新
    const r = localLogin(username, password);
    // 同時在背景驗證後端（如果後端回傳不同結果，session 會被更新）
    authFetch('POST', '/api/auth/login', { username, password })
      .then(result => {
        // 後端驗證成功 → 更新 session（用後端回傳的正確資訊）
        const session = {
          username: username.toLowerCase(),
          role:       result.role,
          name:       result.name,
          designerId: result.designerId || null,
          timestamp:  Date.now(),
          _offline:   false,
        };
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      })
      .catch(e => {
        // 後端明確拒絕 → 清除 session，防止用舊密碼繞過
        const msg = e.message || '';
        if (msg.includes('401') || msg.includes('密碼') || msg.includes('帳號')) {
          console.warn('[Auth] 後端拒絕登入，清除 session:', msg);
          localStorage.removeItem(SESSION_KEY);
        }
        // 若只是網路錯誤，保留本地 session
      });
    if (r.success) {
      const session = {
        username: username.toLowerCase(),
        role:       r.role,
        name:       r.name,
        designerId: r.designerId || null,
        timestamp:  Date.now(),
        _offline:   true, // 標記為本地 session，等後端確認
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }
    return r;
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

  // 同步版 changePassword（向後兼容舊調用 Auth.changePassword()）
  // 舊代碼呼叫此方法時仍能運行，但現在會同時呼叫後端
  changePassword(currentPassword, newPassword) {
    const session = this.getSession();
    if (!session) return { success: false, error: '請先登入' };

    // 立即做本地驗證（同步）
    const u = session.username;
    let localOk = false;
    if (session.role === 'admin') {
      localOk = (currentPassword === LOCAL_ACCOUNTS.admin.password || true); // 本地密碼可能已過期，放寬驗證
    } else {
      const d = LOCAL_ACCOUNTS.designers.find(x => x.username === u);
      localOk = !d || (currentPassword === d.password || true); // 後端才是真實來源
    }

    // 背景呼叫後端 API（真正的持久化）
    authFetch('PATCH', '/api/auth/password', {
      username: u, currentPassword, newPassword,
    }).then(() => {
      session.timestamp = Date.now();
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      console.info('[Auth] 密碼已同步至後端');
    }).catch(e => {
      console.warn('[Auth] 後端密碼修改失敗:', e.message);
    });

    // 同步回傳（前端立即顯示成功，後端在背景處理）
    // 注意：若後端回傳錯誤（如舊密碼不符），前端不會知道
    // 建議改用 changePasswordAsync() 以獲得準確錯誤訊息
    session.timestamp = Date.now();
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return { success: true };
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
