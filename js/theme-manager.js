/**
 * AKB Theme Manager — js/theme-manager.js
 * 統一管理 4 套主題 × 深色/淺色模式
 * 從 localStorage 讀取用戶偏好，並同步到 /api/settings
 */

const AKB_THEMES = {
  jade:  { label: '墨玉翡翠', emoji: '🪭', primary: '#2DD4BF', preview: ['#0E1117','#2DD4BF','#F59E0B'] },
  rose:  { label: '霓虹玫瑰', emoji: '🌸', primary: '#F472B6', preview: ['#0F0D14','#F472B6','#A78BFA'] },
  gold:  { label: '琥珀金沙', emoji: '✨', primary: '#F59E0B', preview: ['#100E08','#F59E0B','#F97316'] },
  ocean: { label: '蔚藍海洋', emoji: '🌊', primary: '#38BDF8', preview: ['#050D1A','#38BDF8','#06B6D4'] },
};

const THEME_STORAGE_KEY = 'akb_theme';
const MODE_STORAGE_KEY  = 'akb_dark_mode';

const ThemeManager = {
  /**
   * 初始化：讀取 localStorage → 套用主題
   * 應在 <head> 或 DOMContentLoaded 時呼叫以避免閃白
   */
  init() {
    const theme = localStorage.getItem(THEME_STORAGE_KEY) || 'jade';
    const dark  = localStorage.getItem(MODE_STORAGE_KEY) !== 'false'; // 預設深色
    this.apply(theme, dark);
  },

  /**
   * 套用主題到 <html> element
   * @param {string} theme — 'jade'|'rose'|'gold'|'ocean'
   * @param {boolean} dark — true=深色, false=淺色
   */
  apply(theme, dark) {
    const html = document.documentElement;
    html.setAttribute('data-theme', theme);
    if (dark) {
      html.classList.remove('light');
    } else {
      html.classList.add('light');
    }
    // 儲存偏好
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    localStorage.setItem(MODE_STORAGE_KEY, String(dark));
    // 更新 meta theme-color
    const colors = { jade: '#0E1117', rose: '#0F0D14', gold: '#100E08', ocean: '#050D1A' };
    const lightColors = { jade: '#F7F8FA', rose: '#FDF2F8', gold: '#FFFBF0', ocean: '#EFF9FF' };
    const mc = document.querySelector('meta[name="theme-color"]');
    if (mc) mc.content = dark ? (colors[theme] || '#0E1117') : (lightColors[theme] || '#F7F8FA');
  },

  /** 取得目前主題名稱 */
  getTheme() {
    return localStorage.getItem(THEME_STORAGE_KEY) || 'jade';
  },

  /** 取得目前是否深色 */
  isDark() {
    return localStorage.getItem(MODE_STORAGE_KEY) !== 'false';
  },

  /** 切換深色/淺色 */
  toggleDark() {
    const dark = !this.isDark();
    this.apply(this.getTheme(), dark);
    return dark;
  },

  /** 切換主題 */
  setTheme(theme) {
    if (!AKB_THEMES[theme]) return;
    this.apply(theme, this.isDark());
  },

  /** 同步到後端 /api/settings（admin 用） */
  async syncToServer(apiBase) {
    try {
      await fetch(`${apiBase}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uiTheme: this.getTheme(),
          uiDark: this.isDark(),
        }),
      });
    } catch(e) {
      console.warn('[Theme] 同步到伺服器失敗:', e.message);
    }
  },

  /** 從後端 /api/settings 讀取並套用 */
  async loadFromServer(apiBase) {
    try {
      const res = await fetch(`${apiBase}/api/settings`);
      const data = await res.json();
      if (data.uiTheme && AKB_THEMES[data.uiTheme]) {
        const dark = data.uiDark !== false;
        this.apply(data.uiTheme, dark);
      }
    } catch(e) {
      console.warn('[Theme] 從伺服器讀取失敗:', e.message);
    }
  },

  /** 取得所有主題資訊（供 UI 渲染） */
  getAllThemes() {
    return AKB_THEMES;
  },
};

// 立即初始化（防止閃白 FOUC）
if (typeof document !== 'undefined') {
  ThemeManager.init();
}

// 匯出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ThemeManager, AKB_THEMES };
}
