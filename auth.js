// AKB 多元化音樂發廊 - 共用權限模組
// 提供登入驗證、角色權限檢查、會話管理

const AUTH_STORAGE_KEY = 'akb_auth_config';

// 預設帳號配置
const DEFAULT_AUTH_CONFIG = {
  // 管理員帳號
  admin: {
    username: 'admin',
    password: 'akb2026',
    role: 'admin',
    name: '店家管理員',
    permissions: ['dashboard', 'bookings', 'designers', 'customers', 'services']
  },
  // 設計師帳號
  designers: [
    { username: 'aika', password: 'akb2026', role: 'designer', name: 'Aika', designerId: 1 },
    { username: 'ken', password: 'akb2026', role: 'designer', name: 'Ken', designerId: 2 },
    { username: 'bella', password: 'akb2026', role: 'designer', name: 'Bella', designerId: 3 },
    { username: 'jay', password: 'akb2026', role: 'designer', name: 'Jay', designerId: 4 },
    { username: 'mia', password: 'akb2026', role: 'designer', name: 'Mia', designerId: 5 }
  ]
};

// 從 localStorage 載入帳號配置，若無則使用預設值
function loadAuthConfig() {
  const saved = localStorage.getItem(AUTH_STORAGE_KEY);
  if (saved) {
    return JSON.parse(saved);
  }
  // 首次使用，儲存預設值
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(DEFAULT_AUTH_CONFIG));
  return DEFAULT_AUTH_CONFIG;
}

// 儲存帳號配置到 localStorage
function saveAuthConfig(config) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(config));
}

// 初始化帳號配置
const AUTH_CONFIG = loadAuthConfig();

const Auth = {
  // 檢查是否已登入
  isLoggedIn() {
    const session = localStorage.getItem('akb_session');
    if (!session) return false;
    try {
      const data = JSON.parse(session);
      // 檢查是否過期（24小時）
      if (Date.now() - data.timestamp > 24 * 60 * 60 * 1000) {
        localStorage.removeItem('akb_session');
        return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  },

  // 取得當前會話資訊
  getSession() {
    const session = localStorage.getItem('akb_session');
    if (!session) return null;
    try {
      const data = JSON.parse(session);
      if (Date.now() - data.timestamp > 24 * 60 * 60 * 1000) {
        localStorage.removeItem('akb_session');
        return null;
      }
      return data;
    } catch (e) {
      return null;
    }
  },

  // 登入
  login(username, password) {
    // 檢查管理員
    if (username === AUTH_CONFIG.admin.username && password === AUTH_CONFIG.admin.password) {
      const session = {
        ...AUTH_CONFIG.admin,
        timestamp: Date.now()
      };
      localStorage.setItem('akb_session', JSON.stringify(session));
      return { success: true, role: 'admin' };
    }
    // 檢查設計師
    const designer = AUTH_CONFIG.designers.find(d => d.username === username && d.password === password);
    if (designer) {
      const session = {
        ...designer,
        timestamp: Date.now()
      };
      localStorage.setItem('akb_session', JSON.stringify(session));
      return { success: true, role: 'designer', designerId: designer.designerId };
    }
    return { success: false, error: '帳號或密碼錯誤' };
  },

  // 登出
  logout() {
    localStorage.removeItem('akb_session');
  },

  // 檢查權限
  hasPermission(requiredRole) {
    const session = this.getSession();
    if (!session) return false;
    if (requiredRole === 'admin') {
      return session.role === 'admin';
    }
    if (requiredRole === 'designer') {
      return session.role === 'designer' || session.role === 'admin';
    }
    return true;
  },

  // 保護頁面 - 未登入則跳轉
  protect(role, redirectUrl = '../index.html') {
    if (!this.isLoggedIn() || !this.hasPermission(role)) {
      window.location.href = redirectUrl;
      return false;
    }
    return true;
  },

  // 修改密碼
  changePassword(currentPassword, newPassword) {
    const session = this.getSession();
    if (!session) {
      return { success: false, error: '請先登入' };
    }

    // 驗證當前密碼
    if (session.role === 'admin') {
      if (currentPassword !== AUTH_CONFIG.admin.password) {
        return { success: false, error: '當前密碼不正確' };
      }
      // 更新管理員密碼
      AUTH_CONFIG.admin.password = newPassword;
      // 儲存到 localStorage
      saveAuthConfig(AUTH_CONFIG);
      // 更新會話
      session.timestamp = Date.now();
      localStorage.setItem('akb_session', JSON.stringify(session));
      return { success: true };
    }

    if (session.role === 'designer') {
      const designer = AUTH_CONFIG.designers.find(d => d.designerId === session.designerId);
      if (!designer || currentPassword !== designer.password) {
        return { success: false, error: '當前密碼不正確' };
      }
      // 更新設計師密碼
      designer.password = newPassword;
      // 儲存到 localStorage
      saveAuthConfig(AUTH_CONFIG);
      // 更新會話
      session.timestamp = Date.now();
      localStorage.setItem('akb_session', JSON.stringify(session));
      return { success: true };
    }

    return { success: false, error: '無法修改密碼' };
  },

  // 驗證密碼強度
  validatePassword(password) {
    if (password.length < 6) {
      return { valid: false, error: '密碼長度至少6位' };
    }
    return { valid: true };
  }
};

// 匯出供其他模組使用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Auth, AUTH_CONFIG };
}
