# AKB Salon — Supabase 安全漏洞修復指南

> **優先級：Critical（緊急）**  
> 收到 Supabase 安全警告郵件：`rls_disabled_in_public` — 所有資料表 RLS 未啟用

---

## 問題說明

| 問題 | 影響 |
|------|------|
| Row Level Security (RLS) 未啟用 | 任何人只要知道 Supabase URL + anon key，即可直接讀取、修改、刪除**所有**預約、顧客、帳號密碼資料 |
| 後端使用 anon key | anon key 不應擁有完整資料庫權限，應改用 service_role key |

---

## 修復步驟（必須完成）

### 第一步：在 Supabase SQL Editor 執行修復 SQL

1. 登入 [Supabase Dashboard](https://supabase.com/dashboard)
2. 選擇專案 **akb-salon**（`azluyqcxnebzdluvjisy`）
3. 左側選單 → **SQL Editor**
4. 點選「New query」
5. 貼上 `supabase_schema.sql` 的完整內容並執行

**執行後的效果：**
```
表格           RLS 狀態    可讀取角色          可寫入角色
──────────────────────────────────────────────────────────
bookings       ✅ 啟用     ❌ anon 不可讀      anon 可新增（客戶預約用）
designers      ✅ 啟用     ✅ anon 唯讀在職設計師  ❌ anon 不可寫
services       ✅ 啟用     ✅ anon 唯讀        ❌ anon 不可寫
accounts       ✅ 啟用     ❌ anon 完全禁止     ❌ anon 完全禁止
```

> **service_role key 天然繞過 RLS**，後端伺服器使用此 key 可正常讀寫全部資料。

---

### 第二步：取得 Service Role Key

1. Supabase Dashboard → **Project Settings** → **API**
2. 找到 **「service_role」** 欄位（不是 anon！）
3. 點選 **Reveal** 複製完整的 JWT token

```
⚠️ 重要：
- service_role key 擁有完整管理員權限
- 絕對不可放在前端程式碼（HTML/JS）中
- 只能設定在後端伺服器的環境變數中
```

---

### 第三步：更新 Render 環境變數

1. 登入 [Render Dashboard](https://dashboard.render.com)
2. 選擇服務 **akb-salon-server**
3. Environment → 找到 `SUPABASE_ANON_KEY`（或 `SUPABASE_KEY`）
4. **新增**環境變數 `SUPABASE_SERVICE_KEY`，值填入第二步複製的 service_role key
5. 可選：刪除舊的 `SUPABASE_ANON_KEY`（前端不需要直接連 Supabase）
6. 點選 **Save Changes** → Render 會自動重啟服務

**環境變數設定範例：**
```
SUPABASE_URL         = https://azluyqcxnebzdluvjisy.supabase.co
SUPABASE_SERVICE_KEY = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...（service_role JWT）
RESET_SECRET         = your-secret-string（緊急重設密碼用）
```

---

### 第四步：驗證修復結果

Render 重啟後，開啟瀏覽器測試：

```bash
# 1. 後端健康檢查（應回傳 storage: "supabase"）
curl https://akb-salon-server.onrender.com/api/health

# 2. 嘗試用 anon key 直接讀 bookings（應被 RLS 拒絕，回傳空陣列或 401）
curl -H "apikey: YOUR_ANON_KEY" \
     -H "Authorization: Bearer YOUR_ANON_KEY" \
     "https://azluyqcxnebzdluvjisy.supabase.co/rest/v1/bookings?select=*"

# 3. 前端預約頁面正常運作
# 4. 管理後台正常登入、查看預約
```

---

## 修復後的安全架構

```
前端（瀏覽器）
    │
    │  HTTPS
    ▼
後端 API（Render）
    │  service_role key（只在伺服器上）
    │  可繞過 RLS，完整操作資料庫
    ▼
Supabase（RLS 已啟用）
    ▲
    │  anon key（即使外洩也無法讀取敏感資料）
    │  只能：新增預約、讀取設計師/服務資料
直接嘗試連線的攻擊者 → 被 RLS 拒絕 ✋
```

---

## 程式碼修改說明（已完成）

### `server_app.js`
- 環境變數讀取優先順序改為：`SUPABASE_SERVICE_KEY` > `SUPABASE_KEY` > `SUPABASE_ANON_KEY`
- 若偵測到仍在使用 anon key，啟動時會在 console 輸出警告

### `supabase_schema.sql`
- 移除 `DISABLE ROW LEVEL SECURITY` 語句
- 新增 `ENABLE ROW LEVEL SECURITY`（所有資料表）
- 新增 RLS Policy：
  - `designers`：anon 唯讀（只顯示在職設計師）
  - `services`：anon 唯讀
  - `bookings`：anon 只能新增（客戶預約），不可讀取他人預約
  - `accounts`：完全封鎖（最敏感資料）

---

## 常見問題

**Q：前端客戶預約還能正常運作嗎？**  
A：可以。前端→後端 API→Supabase 這條路徑不受影響。客戶提交的預約由後端的 service_role key 寫入。

**Q：管理後台還能看到所有預約嗎？**  
A：可以。管理後台透過後端 API 查詢，後端使用 service_role key 不受 RLS 限制。

**Q：設計師工作台還能查看當天預約嗎？**  
A：可以。同上，所有查詢都經過後端 API。

**Q：Supabase 的「Resolve issue」按鈕可以直接點嗎？**  
A：不建議。Supabase 的快速解決按鈕只是停用警告，不會正確設定 RLS Policy。請按照本指南手動執行完整修復。
