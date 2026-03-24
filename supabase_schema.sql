-- AKB 多元化音樂發廊 - Supabase 資料庫建表語句
-- 在 Supabase SQL Editor 中執行此文件即可建立所需資料表
-- 執行後，將 SUPABASE_URL 和 SUPABASE_ANON_KEY 填入 Render 環境變數

-- ========== 預約表 ==========
CREATE TABLE IF NOT EXISTS bookings (
  id              TEXT PRIMARY KEY,
  customer_name   TEXT,
  customer_phone  TEXT,
  date            TEXT,
  time            TEXT,
  designer_id     INTEGER,
  designer_name   TEXT,
  service_name    TEXT,
  service_id      INTEGER,
  price           INTEGER DEFAULT 0,
  duration        INTEGER DEFAULT 60,
  status          TEXT DEFAULT 'pending',
  notes           TEXT DEFAULT '',
  created_at      BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
  updated_at      BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
  -- 允許前端傳入的 camelCase 欄位（自動映射）
  "customerName"  TEXT GENERATED ALWAYS AS (customer_name) STORED,
  "customerPhone" TEXT GENERATED ALWAYS AS (customer_phone) STORED,
  "designerId"    INTEGER GENERATED ALWAYS AS (designer_id) STORED,
  "designerName"  TEXT GENERATED ALWAYS AS (designer_name) STORED,
  "serviceName"   TEXT GENERATED ALWAYS AS (service_name) STORED,
  "createdAt"     BIGINT GENERATED ALWAYS AS (created_at) STORED,
  "updatedAt"     BIGINT GENERATED ALWAYS AS (updated_at) STORED
);

-- 若上方 GENERATED ALWAYS 語法有問題，使用簡化版：
-- DROP TABLE IF EXISTS bookings;
-- CREATE TABLE bookings (
--   id TEXT PRIMARY KEY,
--   "customerName" TEXT,
--   "customerPhone" TEXT,
--   date TEXT,
--   time TEXT,
--   "designerId" INTEGER,
--   "designerName" TEXT,
--   "serviceName" TEXT,
--   price INTEGER DEFAULT 0,
--   duration INTEGER DEFAULT 60,
--   status TEXT DEFAULT 'pending',
--   notes TEXT DEFAULT '',
--   "createdAt" BIGINT,
--   "updatedAt" BIGINT
-- );

-- ========== 簡化版建表（推薦使用此版本）==========
-- 請使用以下簡化版，欄位名稱與程式碼一致

DROP TABLE IF EXISTS bookings CASCADE;
CREATE TABLE bookings (
  id              TEXT PRIMARY KEY,
  "customerName"  TEXT NOT NULL,
  "customerPhone" TEXT NOT NULL,
  date            TEXT NOT NULL,
  time            TEXT NOT NULL,
  "designerId"    INTEGER,
  "designerName"  TEXT,
  "serviceName"   TEXT,
  price           INTEGER DEFAULT 0,
  duration        INTEGER DEFAULT 60,
  status          TEXT DEFAULT 'pending',
  notes           TEXT DEFAULT '',
  "createdAt"     BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  "updatedAt"     BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

-- ========== 設計師表 ==========
DROP TABLE IF EXISTS designers CASCADE;
CREATE TABLE designers (
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
DROP TABLE IF EXISTS services CASCADE;
CREATE TABLE services (
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
DROP TABLE IF EXISTS accounts CASCADE;
CREATE TABLE accounts (
  username        TEXT PRIMARY KEY,
  role            TEXT NOT NULL DEFAULT 'customer',
  name            TEXT,
  "passwordHash"  TEXT,
  "designerId"    INTEGER,
  "updatedAt"     BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

-- ========== Row Level Security（建議開啟）==========
-- 由後端用 anon key 直接存取，關閉 RLS 或建立適當政策
ALTER TABLE bookings  DISABLE ROW LEVEL SECURITY;
ALTER TABLE designers DISABLE ROW LEVEL SECURITY;
ALTER TABLE services  DISABLE ROW LEVEL SECURITY;
ALTER TABLE accounts  DISABLE ROW LEVEL SECURITY;

-- 若需啟用 RLS（更安全），請改用 Service Role Key 在後端
-- ALTER TABLE bookings  ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "allow_all" ON bookings USING (true) WITH CHECK (true);

-- ========== 驗證 ==========
SELECT 'bookings'  AS table_name, COUNT(*) FROM bookings
UNION ALL
SELECT 'designers', COUNT(*) FROM designers
UNION ALL
SELECT 'services',  COUNT(*) FROM services
UNION ALL
SELECT 'accounts',  COUNT(*) FROM accounts;
