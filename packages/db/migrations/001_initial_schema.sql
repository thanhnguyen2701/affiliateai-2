-- ═══════════════════════════════════════════════════════════════════════════
-- AffiliateAI — Database Schema v1.0
-- Chạy file này trong Supabase SQL Editor
-- Thứ tự: đúng thứ tự này, không thay đổi
-- ═══════════════════════════════════════════════════════════════════════════

-- Extensions cần thiết
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- pg_cron cần enable riêng trong Supabase: Database → Extensions → pg_cron

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. USERS — bảng chính, auth tích hợp Supabase Auth
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email               VARCHAR(255) UNIQUE NOT NULL,
  plan                VARCHAR(20)  NOT NULL DEFAULT 'free'
                                   CHECK (plan IN ('free','starter','pro','business','enterprise')),
  credits_total       INT          NOT NULL DEFAULT 10 CHECK (credits_total >= -1),
  credits_used        INT          NOT NULL DEFAULT 0  CHECK (credits_used >= 0),
  full_autopilot      BOOLEAN      NOT NULL DEFAULT false,
  quiet_hours_start   INT          NOT NULL DEFAULT 23 CHECK (quiet_hours_start BETWEEN 0 AND 23),
  quiet_hours_end     INT          NOT NULL DEFAULT 6  CHECK (quiet_hours_end BETWEEN 0 AND 23),
  stripe_customer_id  VARCHAR(255),
  zalopay_user_id     VARCHAR(255),
  is_active           BOOLEAN      NOT NULL DEFAULT true,
  last_seen_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email   ON users(email);
CREATE INDEX idx_users_plan    ON users(plan) WHERE is_active = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. AFFILIATE PROFILES — Semantic Memory M2 (vĩnh viễn)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS affiliate_profiles (
  user_id             UUID         PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  niche_primary       VARCHAR(100),
  niche_secondary     TEXT[]       NOT NULL DEFAULT '{}',
  preferred_tone      VARCHAR(50)  NOT NULL DEFAULT 'friendly'
                                   CHECK (preferred_tone IN ('friendly','professional','funny','inspiring')),
  language_style      VARCHAR(20)  NOT NULL DEFAULT 'neutral'
                                   CHECK (language_style IN ('bắc','nam','trung','neutral')),
  active_networks     TEXT[]       NOT NULL DEFAULT '{}',
  -- JSON: {"mon":[19,20,21], "tue":[19,20], ...}
  best_posting_hrs    JSONB        NOT NULL DEFAULT '{"mon":[19,20,21],"tue":[19,20,21],"wed":[19,20,21],"thu":[19,20,21],"fri":[18,19,20],"sat":[10,11,19,20],"sun":[10,11,19,20]}',
  -- JSON: {"tiktok":"hook+problem+solution+cta", "facebook":"story+socialproof+cta"}
  top_formats         JSONB        NOT NULL DEFAULT '{}',
  avoided_words       TEXT[]       NOT NULL DEFAULT '{}',
  -- IDs content được user rate 4-5 sao → học từ đó
  sample_good_ids     UUID[]       NOT NULL DEFAULT '{}',
  total_content_made  INT          NOT NULL DEFAULT 0,
  avg_quality_score   FLOAT,
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. BRAND KITS — cài đặt thương hiệu, tự động áp vào mọi visual
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brand_kits (
  user_id           UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  primary_color     VARCHAR(7)  NOT NULL DEFAULT '#1A3C5E',
  secondary_color   VARCHAR(7)  NOT NULL DEFAULT '#E8500A',
  accent_color      VARCHAR(7)  NOT NULL DEFAULT '#0E7C7B',
  logo_url          TEXT,
  watermark_pos     VARCHAR(20) NOT NULL DEFAULT 'bottom-right'
                                CHECK (watermark_pos IN ('bottom-right','bottom-left','top-right','top-left','center')),
  watermark_opacity FLOAT       NOT NULL DEFAULT 0.6 CHECK (watermark_opacity BETWEEN 0 AND 1),
  style_keywords    TEXT[]      NOT NULL DEFAULT '{}',
  avoid_keywords    TEXT[]      NOT NULL DEFAULT '{}',
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. EPISODIC MEMORY M1 — mỗi tương tác, tự expire 90 ngày
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS episodic_memory (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type   VARCHAR(50) NOT NULL CHECK (event_type IN (
    'content_created','content_approved','content_rejected',
    'offer_clicked','reply_sent','trend_viewed',
    'visual_created','performance_checked','schedule_triggered'
  )),
  event_data   JSONB       NOT NULL DEFAULT '{}',
  -- outcome: {user_rating, was_edited, regen_count, time_to_approve_s, ctr, conversion}
  outcome      JSONB       NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 days')
);

CREATE INDEX idx_episodic_user_type ON episodic_memory(user_id, event_type);
CREATE INDEX idx_episodic_expires   ON episodic_memory(expires_at);
CREATE INDEX idx_episodic_recent    ON episodic_memory(user_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. KNOWLEDGE CHUNKS — RAG, vector embeddings
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kb_type      VARCHAR(50) NOT NULL CHECK (kb_type IN (
    'product','brand','review','policy','content','competitor'
  )),
  source_name  VARCHAR(255),
  source_url   TEXT,
  chunk_text   TEXT        NOT NULL,
  -- OpenAI text-embedding-3-large shortened to 1536 dims for pgvector schema compatibility
  embedding    VECTOR(1536),
  -- {page, date, product_id, language, ...}
  metadata     JSONB       NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chunks_user_type ON knowledge_chunks(user_id, kb_type);
-- ivfflat: cần >= 1000 rows để hiệu quả, OK dùng brute-force với <1000 rows
CREATE INDEX idx_chunks_embedding ON knowledge_chunks
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. CONTENT HISTORY — lịch sử content đã tạo
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_history (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_name        VARCHAR(500),
  affiliate_network   VARCHAR(50),
  affiliate_link      TEXT,
  platform            VARCHAR(50) NOT NULL,
  content_type        VARCHAR(50),
  content             TEXT        NOT NULL,
  hashtags            TEXT[]      DEFAULT '{}',
  quality_score       INT         CHECK (quality_score BETWEEN 0 AND 100),
  -- user_rating: 1-5 sao sau khi dùng
  user_rating         INT         CHECK (user_rating BETWEEN 1 AND 5),
  was_regenerated     BOOLEAN     NOT NULL DEFAULT false,
  regen_count         INT         NOT NULL DEFAULT 0,
  time_to_approve_s   INT,
  was_posted          BOOLEAN     NOT NULL DEFAULT false,
  posted_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_content_user_platform ON content_history(user_id, platform);
CREATE INDEX idx_content_recent        ON content_history(user_id, created_at DESC);
CREATE INDEX idx_content_rated         ON content_history(user_id, user_rating DESC NULLS LAST);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. VISUAL JOBS — image/video generation jobs
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visual_jobs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pipeline      VARCHAR(10) NOT NULL CHECK (pipeline IN ('A','B','C','A+C')),
  status        VARCHAR(20) NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','processing','done','failed')),
  source_type   VARCHAR(20) CHECK (source_type IN (
    'photo_upload','shopee_url','lazada_url','raw_video'
  )),
  source_url    TEXT,
  source_path   TEXT,
  -- {name, niche, price, affiliate_link, promotion, ...}
  product_info  JSONB       NOT NULL DEFAULT '{}',
  -- output: {facebook_banner, tiktok_thumbnail, tiktok_video, ...}
  assets        JSONB       NOT NULL DEFAULT '{}',
  api_cost_vnd  INT         NOT NULL DEFAULT 0,
  error_msg     TEXT,
  retry_count   INT         NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ
);

CREATE INDEX idx_visual_user_status ON visual_jobs(user_id, status);
CREATE INDEX idx_visual_recent      ON visual_jobs(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. PERFORMANCE DATA — click/conversion tracking
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS performance_data (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offer_id     VARCHAR(255) NOT NULL,
  network      VARCHAR(50)  NOT NULL,
  platform     VARCHAR(50),
  content_id   UUID         REFERENCES content_history(id) ON DELETE SET NULL,
  clicks       INT          NOT NULL DEFAULT 0,
  conversions  INT          NOT NULL DEFAULT 0,
  revenue_vnd  BIGINT       NOT NULL DEFAULT 0,
  date         DATE         NOT NULL,
  UNIQUE (user_id, offer_id, network, date)
);

CREATE INDEX idx_perf_user_date ON performance_data(user_id, date DESC);
CREATE INDEX idx_perf_network   ON performance_data(user_id, network, date DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. OFFER CACHE — cache từ affiliate networks, expire 24h
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS offer_cache (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  network        VARCHAR(50)  NOT NULL,
  offer_id       VARCHAR(255) NOT NULL,
  product_name   VARCHAR(500),
  category       VARCHAR(100),
  commission_pct FLOAT,
  epc_estimate   BIGINT,
  price          BIGINT,
  rating         FLOAT,
  sold_count     BIGINT,
  image_url      TEXT,
  affiliate_url  TEXT,
  metadata       JSONB        NOT NULL DEFAULT '{}',
  fetched_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ  NOT NULL DEFAULT (NOW() + INTERVAL '6 hours'),
  UNIQUE (network, offer_id)
);

CREATE INDEX idx_offer_category ON offer_cache(network, category);
CREATE INDEX idx_offer_epc      ON offer_cache(epc_estimate DESC NULLS LAST);
CREATE INDEX idx_offer_expires  ON offer_cache(expires_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. SCHEDULER LOGS — log mỗi lần cron job chạy
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scheduler_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  job_type    VARCHAR(50) NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'running'
              CHECK (status IN ('running','completed','failed','skipped')),
  result      JSONB       NOT NULL DEFAULT '{}',
  error_msg   TEXT,
  ran_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_ms INT
);

CREATE INDEX idx_scheduler_user ON scheduler_logs(user_id, job_type, ran_at DESC);
CREATE INDEX idx_scheduler_all  ON scheduler_logs(ran_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNCTIONS & TRIGGERS
-- ═══════════════════════════════════════════════════════════════════════════

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION trigger_update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trigger_update_updated_at();

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON affiliate_profiles
  FOR EACH ROW EXECUTE FUNCTION trigger_update_updated_at();

CREATE TRIGGER trg_brand_kits_updated_at
  BEFORE UPDATE ON brand_kits
  FOR EACH ROW EXECUTE FUNCTION trigger_update_updated_at();

-- Vector semantic search function
CREATE OR REPLACE FUNCTION search_knowledge(
  p_user_id   UUID,
  p_embedding VECTOR(1536),
  p_kb_type   VARCHAR DEFAULT NULL,
  p_limit     INT DEFAULT 5,
  p_threshold FLOAT DEFAULT 0.4
)
RETURNS TABLE(
  id          UUID,
  chunk_text  TEXT,
  similarity  FLOAT,
  kb_type     VARCHAR,
  source_name VARCHAR,
  metadata    JSONB
)
LANGUAGE SQL STABLE AS $$
  SELECT
    id,
    chunk_text,
    1 - (embedding <=> p_embedding) AS similarity,
    kb_type,
    source_name,
    metadata
  FROM   knowledge_chunks
  WHERE  user_id = p_user_id
    AND  (p_kb_type IS NULL OR kb_type = p_kb_type)
    AND  embedding IS NOT NULL
    AND  1 - (embedding <=> p_embedding) >= p_threshold
  ORDER  BY embedding <=> p_embedding
  LIMIT  p_limit;
$$;

-- Get user credit balance
CREATE OR REPLACE FUNCTION get_user_credits(p_user_id UUID)
RETURNS TABLE(total INT, used INT, remaining INT, is_unlimited BOOLEAN)
LANGUAGE SQL STABLE AS $$
  SELECT
    credits_total AS total,
    credits_used  AS used,
    CASE WHEN credits_total = -1 THEN 99999
         ELSE credits_total - credits_used
    END AS remaining,
    credits_total = -1 AS is_unlimited
  FROM users
  WHERE id = p_user_id;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_kits         ENABLE ROW LEVEL SECURITY;
ALTER TABLE episodic_memory    ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_history    ENABLE ROW LEVEL SECURITY;
ALTER TABLE visual_jobs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_data   ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduler_logs     ENABLE ROW LEVEL SECURITY;
-- offer_cache: không cần RLS, là shared public cache

-- Policy: user chỉ đọc/ghi data của chính mình
CREATE POLICY "own_data" ON users              FOR ALL USING (auth.uid() = id);
CREATE POLICY "own_data" ON affiliate_profiles FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_data" ON brand_kits         FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_data" ON episodic_memory    FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_data" ON knowledge_chunks   FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_data" ON content_history    FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_data" ON visual_jobs        FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_data" ON performance_data   FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_data" ON scheduler_logs     FOR ALL USING (auth.uid() = user_id);

-- Service role bypass (backend API dùng service key có thể đọc/ghi tất cả)
-- Supabase tự handle: service_role bypasses RLS

-- ═══════════════════════════════════════════════════════════════════════════
-- SCHEDULED CLEANUP (chạy sau khi enable pg_cron)
-- ═══════════════════════════════════════════════════════════════════════════

-- Xóa episodic memory hết hạn: mỗi ngày 3:00 AM
-- SELECT cron.schedule('cleanup-episodic','0 3 * * *',
--   $$DELETE FROM episodic_memory WHERE expires_at < NOW()$$);

-- Xóa offer cache hết hạn: mỗi giờ
-- SELECT cron.schedule('cleanup-offers','0 * * * *',
--   $$DELETE FROM offer_cache WHERE expires_at < NOW()$$);
