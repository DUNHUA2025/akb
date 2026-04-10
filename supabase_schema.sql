-- AKB 多元化音樂發廊 - Supabase 資料庫建表語句
-- ================================================================
-- 執行順序：在 Supabase SQL Editor 中完整貼上並執行此文件
-- 執行後，將環境變數填入 Render：
--   SUPABASE_URL        = https://xxxxxxxx.supabase.co
--   SUPABASE_SERVICE_KEY = eyJhbGci...（Service Role Key，非 anon key！）
-- ================================================================

-- ========== 預約表 ==========
CREATE TABLE IF NOT EXISTS bookings (
  id              TEXT PRIMARY KEY,
  "customerName"  TEXT NOT NULL DEFAULT '',
  "customerPhone" TEXT NOT NULL DEFAULT '',
  date            TEXT NOT NULL DEFAULT '',
  time            TEXT NOT NULL DEFAULT '',
  "designerId"    INTEGER,
  "designerName"  TEXT DEFAULT '',
  "serviceId"     INTEGER,
  "serviceName"   TEXT DEFAULT '',
  price           INTEGER DEFAULT 0,
  duration        INTEGER DEFAULT 60,
  note            TEXT DEFAULT '',
  status          TEXT DEFAULT 'pending',
  "isRandom"      BOOLEAN DEFAULT FALSE,
  "customerEmail" TEXT DEFAULT '',
  "createdAt"     BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  "updatedAt"     BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

-- 補充欄位（舊版 schema 升級用，已存在欄位自動跳過）
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS "serviceId"     INTEGER;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS note            TEXT DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS "serviceName"   TEXT DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS "designerId"    INTEGER;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS "designerName"  TEXT DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS "customerName"  TEXT DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS "customerPhone" TEXT DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS "customerEmail" TEXT DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS "isRandom"      BOOLEAN DEFAULT FALSE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS "createdAt"     BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS "updatedAt"     BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;

-- ========== 設計師表 ==========
CREATE TABLE IF NOT EXISTS designers (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT DEFAULT '設計師',
  level       TEXT DEFAULT 'C',
  specialty   JSONB DEFAULT '[]',
  bio         TEXT DEFAULT '',
  avatar      TEXT DEFAULT '',
  rating      NUMERIC(3,1) DEFAULT 5.0,
  reviews     INTEGER DEFAULT 0,
  works       INTEGER DEFAULT 0,
  available   BOOLEAN DEFAULT TRUE,
  status      TEXT DEFAULT 'active',
  "createdAt" BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  "updatedAt" BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

-- ========== 服務表 ==========
CREATE TABLE IF NOT EXISTS services (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT DEFAULT '基礎',
  duration    INTEGER DEFAULT 60,
  price       INTEGER DEFAULT 0,
  description TEXT DEFAULT '',
  "createdAt" BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  "updatedAt" BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

-- ========== 帳號表 ==========
CREATE TABLE IF NOT EXISTS accounts (
  username        TEXT PRIMARY KEY,
  role            TEXT NOT NULL DEFAULT 'customer',
  name            TEXT DEFAULT '',
  "passwordHash"  TEXT DEFAULT '',
  "designerId"    INTEGER,
  "updatedAt"     BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

-- ================================================================
-- ⚠️  安全設定：啟用 Row Level Security（RLS）
-- ================================================================
-- 原則：
--   1. 啟用所有資料表的 RLS（阻止直接 public 存取）
--   2. 拒絕 anon / authenticated role 的一切操作
--   3. 後端伺服器使用 service_role key，可繞過 RLS 直接存取
--   4. 這樣即使 anon key 外洩，外部無法直接讀寫資料庫
-- ================================================================

-- 啟用 RLS
ALTER TABLE bookings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE designers ENABLE ROW LEVEL SECURITY;
ALTER TABLE services  ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts  ENABLE ROW LEVEL SECURITY;

-- 移除舊的「禁用 RLS」設定（若有的話）
-- （Supabase 無法直接刪除 DISABLE 設定，ENABLE 即覆蓋）

-- ── 清除所有可能殘留的舊 policy ───────────────────────────
DROP POLICY IF EXISTS "public_read_bookings"     ON bookings;
DROP POLICY IF EXISTS "public_write_bookings"    ON bookings;
DROP POLICY IF EXISTS "anon_read_bookings"       ON bookings;
DROP POLICY IF EXISTS "allow_all_bookings"       ON bookings;
DROP POLICY IF EXISTS "public_read_designers"    ON designers;
DROP POLICY IF EXISTS "anon_read_designers"      ON designers;
DROP POLICY IF EXISTS "allow_all_designers"      ON designers;
DROP POLICY IF EXISTS "public_read_services"     ON services;
DROP POLICY IF EXISTS "anon_read_services"       ON services;
DROP POLICY IF EXISTS "allow_all_services"       ON services;
DROP POLICY IF EXISTS "allow_all_accounts"       ON accounts;
DROP POLICY IF EXISTS "anon_read_accounts"       ON accounts;

-- ── bookings 表：不建立任何 public policy（預設拒絕一切）─
-- service_role key 天然繞過 RLS，後端伺服器可正常讀寫
-- anon key / authenticated 無 policy → 全部拒絕

-- ── designers 表：允許 anon 唯讀（前端客戶預約頁需要顯示設計師）
CREATE POLICY "public_read_designers" ON designers
  FOR SELECT
  TO anon, authenticated
  USING (status != 'resigned');  -- 只公開在職設計師

-- ── services 表：允許 anon 唯讀（前端需要顯示服務項目）
CREATE POLICY "public_read_services" ON services
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- ── accounts 表：完全鎖定（敏感資料，只有 service_role 可存取）
-- 不建立任何 policy → 預設全部拒絕

-- ── bookings 表：只允許 anon 新增（客戶預約），不允許讀取/修改/刪除
CREATE POLICY "anon_insert_bookings" ON bookings
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- ================================================================
-- ⚠️  重要提示：後端環境變數必須改用 service_role key
-- ================================================================
-- Render 環境變數設定：
--
--   舊設定（不安全）：
--     SUPABASE_ANON_KEY = eyJhbGci...anon...
--
--   新設定（安全）：
--     SUPABASE_SERVICE_KEY = eyJhbGci...service_role...
--
-- Service Role Key 位置：
--   Supabase Dashboard → Project Settings → API
--   → "service_role" key（secret，請勿在前端使用）
-- ================================================================

-- ========== 驗證設定是否正確 ==========
SELECT
  schemaname,
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('bookings','designers','services','accounts')
ORDER BY tablename;

-- 檢視已建立的 policy
SELECT
  tablename,
  policyname,
  roles,
  cmd AS operation,
  qual AS condition
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 驗證資料行數
SELECT 'bookings'  AS table_name, COUNT(*) AS rows FROM bookings
UNION ALL
SELECT 'designers', COUNT(*) FROM designers
UNION ALL
SELECT 'services',  COUNT(*) FROM services
UNION ALL
SELECT 'accounts',  COUNT(*) FROM accounts;
