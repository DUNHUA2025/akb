// AKB Salon API Service
const API_BASE_URL = 'http://localhost:3001/api';
const WS_URL = 'ws://localhost:3001';

class SalonAPI {
  constructor() {
    this.ws = null;
    this.listeners = new Map();
    this.reconnectInterval = 3000;
    this.connect();
  }

  // WebSocket 連線
  connect() {
    try {
      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
      };

      this.ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected, reconnecting...');
        setTimeout(() => this.connect(), this.reconnectInterval);
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
    }
  }

  // 處理 WebSocket 訊息
  handleMessage(message) {
    const { type, data } = message;
    const callbacks = this.listeners.get(type) || [];
    callbacks.forEach(cb => cb(data));
  }

  // 註冊事件監聽
  on(eventType, callback) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    this.listeners.get(eventType).push(callback);
  }

  // 取消註冊
  off(eventType, callback) {
    const callbacks = this.listeners.get(eventType) || [];
    const index = callbacks.indexOf(callback);
    if (index > -1) callbacks.splice(index, 1);
  }

  // HTTP 請求輔助函數
  async request(url, options = {}) {
    const response = await fetch(`${API_BASE_URL}${url}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  // ========== 預約 API ==========
  
  async getBookings() {
    return this.request('/bookings');
  }

  async createBooking(bookingData) {
    return this.request('/bookings', {
      method: 'POST',
      body: JSON.stringify(bookingData)
    });
  }

  async updateBooking(id, updates) {
    return this.request(`/bookings/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates)
    });
  }

  async deleteBooking(id) {
    return this.request(`/bookings/${id}`, { method: 'DELETE' });
  }

  // ========== 客戶 API ==========
  
  async getCustomers() {
    return this.request('/customers');
  }

  async saveAccount(phone, accountData) {
    return this.request(`/accounts/${phone}`, {
      method: 'POST',
      body: JSON.stringify(accountData)
    });
  }
}

// 建立全域實例
const salonAPI = new SalonAPI();
