// AKB 多元化音樂發廊 - 共用權限模組
// 提供登入驗證、角色權限檢查、會話管理

const AUTH_CONFIG = {
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
  }
};

// 匯出供其他模組使用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Auth, AUTH_CONFIG };
}
