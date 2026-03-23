-- ============================================================
-- AKB 多元化音樂發廊 — Supabase 資料庫 Schema
-- 在 Supabase Dashboard > SQL Editor 中執行此腳本
-- ============================================================

-- ── 預約表 ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id              BIGSERIAL PRIMARY KEY,
  service_id      INTEGER,
  service_name    TEXT NOT NULL DEFAULT '',
  designer_id     INTEGER,
  designer_name   TEXT NOT NULL DEFAULT '',
  date            TEXT NOT NULL,
  time            TEXT NOT NULL DEFAULT '',
  customer_name   TEXT NOT NULL DEFAULT '',
  customer_phone  TEXT NOT NULL DEFAULT '',
  customer_email  TEXT DEFAULT '',
  note            TEXT DEFAULT '',
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending','confirmed','done','cancelled')),
  price           INTEGER DEFAULT 0,
  duration        INTEGER DEFAULT 60,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 設計師表 ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS designers (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT DEFAULT '設計師',
  level       TEXT DEFAULT 'C',
  specialty   TEXT DEFAULT '[]',
  bio         TEXT DEFAULT '',
  avatar      TEXT DEFAULT '',
  rating      NUMERIC(3,1) DEFAULT 4.5,
  reviews     INTEGER DEFAULT 0,
  works       INTEGER DEFAULT 0,
  available   BOOLEAN DEFAULT true,
  status      TEXT DEFAULT 'active',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 服務項目表 ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS services (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT DEFAULT '基礎',
  price       INTEGER NOT NULL DEFAULT 0,
  duration    INTEGER NOT NULL DEFAULT 60,
  description TEXT DEFAULT '',
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 客戶表 ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id            BIGSERIAL PRIMARY KEY,
  phone         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  email         TEXT DEFAULT '',
  password_hash TEXT DEFAULT '',
  first_visit   TIMESTAMPTZ DEFAULT NOW(),
  last_visit    TIMESTAMPTZ DEFAULT NOW(),
  visit_count   INTEGER DEFAULT 0,
  total_spent   INTEGER DEFAULT 0,
  notes         TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── 開啟 Row Level Security（RLS）────────────────────────────
ALTER TABLE bookings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE designers ENABLE ROW LEVEL SECURITY;
ALTER TABLE services  ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- 允許匿名用戶（anon key）讀寫（靜態網站不使用服務端驗證）
CREATE POLICY IF NOT EXISTS "Allow anon read bookings"   ON bookings  FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Allow anon insert bookings" ON bookings  FOR INSERT WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Allow anon update bookings" ON bookings  FOR UPDATE USING (true);
CREATE POLICY IF NOT EXISTS "Allow anon delete bookings" ON bookings  FOR DELETE USING (true);

CREATE POLICY IF NOT EXISTS "Allow anon all designers"   ON designers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Allow anon all services"    ON services  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Allow anon all customers"   ON customers FOR ALL USING (true) WITH CHECK (true);

-- ── 開啟 Realtime ────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE bookings;
ALTER PUBLICATION supabase_realtime ADD TABLE designers;
ALTER PUBLICATION supabase_realtime ADD TABLE services;

-- ── 插入預設設計師 ───────────────────────────────────────────
INSERT INTO designers (id, name, role, level, specialty, bio, avatar, rating, reviews, works, available, status)
VALUES
  (1, 'Aika',  '首席設計師', 'A', '["染髮","挑染","音樂造型"]',  '擅長韓系潮流色彩，10年經驗，粉絲稱她為「調色魔法師」', 'A', 4.9, 142, 320, true,  'active'),
  (2, 'Ken',   '資深設計師', 'B', '["燙髮","護髮","男士剪髮"]',  '韓式小臉燙&歐美捲專家，留學首爾5年歸國',               'K', 4.8, 98,  215, true,  'active'),
  (3, 'Bella', '設計師',     'C', '["剪髮","頭皮SPA","護髮療程"]','輕柔手法，細心聆聽每位客人需求',                       'B', 4.7, 63,  140, true,  'active'),
  (4, 'Jay',   '資深設計師', 'B', '["染髮","新娘造型","特殊造型"]','婚禮造型達人，已完成超過200組新娘',                    'J', 4.9, 117, 278, false, 'active'),
  (5, 'Mia',   '設計師',     'C', '["剪髮","燙髮","頭皮SPA"]',   '活潑開朗，擅長與客人溝通，讓你放鬆享受',               'M', 4.6, 45,  98,  true,  'active')
ON CONFLICT (id) DO NOTHING;

-- ── 插入預設服務 ─────────────────────────────────────────────
INSERT INTO services (name, category, price, duration, description)
VALUES
  ('洗剪吹',     '基礎', 128, 60,  '洗髮 + 剪髮 + 吹造型'),
  ('單剪',       '基礎', 68,  30,  '純剪髮造型'),
  ('洗吹',       '基礎', 88,  45,  '洗髮 + 吹造型'),
  ('彩色染髮',   '染髮', 168, 90,  '時尚彩色染髮'),
  ('電髮',       '燙髮', 268, 120, '多種燙髮技術，打造理想捲度'),
  ('顏色焗油',   '護理', 228, 60,  '色彩焗油護理'),
  ('水療焗油',   '護理', 188, 60,  '深層水療護髮'),
  ('陶瓷數碼曲', '燙髮', 358, 150, '陶瓷數碼燙髮技術'),
  ('技術染髮',   '染髮', 228, 120, '專業技術染色'),
  ('負離子直髮', '燙髮', 228, 120, '離子燙直髮')
ON CONFLICT DO NOTHING;
