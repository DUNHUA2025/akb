-- AKB 多元化音樂發廊 - Supabase 資料庫建表語句（最終修正版）
-- 在 Supabase SQL Editor 中執行此文件即可建立所需資料表
-- 執行後，將 SUPABASE_URL 和 SUPABASE_ANON_KEY 填入 Render 環境變數

-- ========== 預約表 ==========
-- 欄位名稱嚴格與後端程式碼一致（camelCase）
-- 使用 CREATE TABLE IF NOT EXISTS，避免重新建表時刪除既有預約
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
  "createdAt"     BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  "updatedAt"     BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

-- 若 bookings 表已存在但結構較舊（有 notes 欄位而非 note，無 serviceId 欄位），
-- 執行以下 ALTER 語句補充缺失欄位（已存在欄位不受影響）：
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS "serviceId" INTEGER;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS note TEXT DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS "serviceName" TEXT DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS "designerId" INTEGER;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS "designerName" TEXT DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS "customerName" TEXT DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS "customerPhone" TEXT DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS "createdAt" BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS "updatedAt" BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;

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

-- ========== 關閉 Row Level Security（後端 anon key 直接存取）==========
ALTER TABLE bookings  DISABLE ROW LEVEL SECURITY;
ALTER TABLE designers DISABLE ROW LEVEL SECURITY;
ALTER TABLE services  DISABLE ROW LEVEL SECURITY;
ALTER TABLE accounts  DISABLE ROW LEVEL SECURITY;

-- ========== 驗證 ==========
SELECT 'bookings'  AS table_name, COUNT(*) FROM bookings
UNION ALL
SELECT 'designers', COUNT(*) FROM designers
UNION ALL
SELECT 'services',  COUNT(*) FROM services
UNION ALL
SELECT 'accounts',  COUNT(*) FROM accounts;
