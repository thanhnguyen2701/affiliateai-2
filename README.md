# 🤖 AffiliateAI — AI Agent Affiliate Toàn Trình

**Trợ lý AI tự động hóa toàn bộ quy trình affiliate marketing** — từ nghiên cứu trend, tạo content đa kênh, tạo ảnh/video, đến phân tích hiệu suất và chăm sóc khách hàng.

---

## 📁 Project Structure

```
affiliateai/
├── apps/
│   ├── api/                    # Fastify backend (Node.js + TypeScript)
│   │   ├── src/
│   │   │   ├── agents/         # AI Agent system (Orchestrator + 5 agents)
│   │   │   ├── routes/         # REST API endpoints
│   │   │   ├── services/
│   │   │   │   ├── memory/     # M1/M2 Memory + RAG
│   │   │   │   ├── visual/     # Image + Video AI (Pipeline A/B/C)
│   │   │   │   └── integrations/ # Shopee + TikTok + Accesstrade APIs
│   │   │   ├── jobs/           # Inngest scheduler (7 cron jobs)
│   │   │   ├── middleware/     # Auth + Error handler
│   │   │   └── lib/            # Resilience, Supabase client
│   │   └── tests/              # Unit + Integration + Smoke tests
│   └── web/                    # Next.js frontend (TODO)
├── packages/
│   ├── db/migrations/          # PostgreSQL schema
│   └── shared/src/types.ts     # Shared TypeScript types
├── .env.example                # Template env vars
└── .github/workflows/ci.yml    # CI/CD pipeline
```

---

## 🚀 Quick Start (5 bước)

### Bước 1 — Clone và setup

```bash
git clone <repo>
cd affiliateai
cp .env.example .env.local
```

### Bước 2 — Điền env vars

Mở `.env.local` và điền:
- `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` + `SUPABASE_ANON_KEY`
- `CAKEAI_API_KEY` + các `CAKEAI_*_ID` (tạo agents trên CakeAI.vn trước)
- `OPENAI_API_KEY` (cho embeddings + Whisper + Vision)

### Bước 3 — Setup Database

Mở [Supabase SQL Editor](https://supabase.com/dashboard) và chạy:

```sql
-- Copy toàn bộ nội dung file này và chạy trong SQL Editor
-- packages/db/migrations/001_initial_schema.sql
```

### Bước 4 — Install và chạy

```bash
cd apps/api
npm install
npm run dev
```

Server chạy tại: `http://192.168.1.149:3001`

Kiểm tra: `GET http://192.168.1.149:3001/health`

### Bước 5 — Test

```bash
# Unit tests
npm run test:unit

# Integration tests (mocked)
npm run test:integration

# Smoke tests (mocked, không cần real API keys)
npm run test:smoke

# Tất cả
npm run test:all
```

---

## 🔌 API Endpoints

### Auth
| Method | Path | Mô tả |
|--------|------|-------|
| POST | `/auth/register` | Đăng ký tài khoản |
| POST | `/auth/login` | Đăng nhập |

### Agent (cần auth)
| Method | Path | Mô tả |
|--------|------|-------|
| POST | `/api/agent/chat` | Main endpoint — gửi message, nhận content |
| POST | `/api/content/rate` | Đánh giá content (1-5 sao) |

### Profile
| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/profile` | Lấy profile + brand kit |
| PATCH | `/api/profile` | Cập nhật niche, tone, networks |

### Visual AI (cần plan Starter+)
| Method | Path | Mô tả |
|--------|------|-------|
| POST | `/api/visual/from-url` | Tạo ảnh từ URL Shopee/Lazada |
| GET | `/api/visual/job/:id` | Check trạng thái job |
| GET | `/api/visual/history` | Lịch sử visual jobs |

### Knowledge Base
| Method | Path | Mô tả |
|--------|------|-------|
| POST | `/api/knowledge/upload-text` | Upload text/review vào KB |
| POST | `/api/knowledge/ingest-url` | Crawl URL và embed vào KB |
| GET | `/api/knowledge/list` | Danh sách documents |
| DELETE | `/api/knowledge/:source` | Xóa document |

### Offers
| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/offers/top` | Top offers phù hợp user |

### Payment
| Method | Path | Mô tả |
|--------|------|-------|
| POST | `/api/payment/create` | Tạo đơn hàng ZaloPay |
| POST | `/api/payment/callback` | ZaloPay webhook |
| GET | `/api/payment/plans` | Danh sách gói |

### Performance
| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/performance/summary` | Tóm tắt hiệu suất 30 ngày |

---

## 🤖 Agent System

### Orchestrator
Nhận mọi message, detect intent (12 loại), dispatch đến agent phù hợp.

```bash
# Example request
curl -X POST http://192.168.1.149:3001/api/agent/chat \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"message": "Viết review TikTok cho kem dưỡng da Innisfree https://shp.ee/xxx"}'
```

### Memory System
- **M1 Episodic** — lưu mỗi interaction, expire 90 ngày
- **M2 Semantic** — profile + preferences, học từ feedback
- **RAG** — vector search trong knowledge base

### Agentic Loop (Inngest)
7 cron jobs tự động: trend scan lúc 6am, content draft lúc 7am, engagement check lúc 7:30pm, weekly report thứ Hai, link health check lúc 10pm, offer refresh thứ Sáu, monthly strategy ngày 1 hàng tháng.

---

## 🎨 Visual AI Pipelines

| Pipeline | Input | Output | Thời gian |
|----------|-------|--------|-----------|
| A | Upload ảnh thực | Banner + Thumbnail + Carousel | 3 phút |
| B | URL Shopee/Lazada | Bộ ảnh marketing | 4 phút |
| C | Upload video raw | TikTok video + subtitle | 6 phút |
| A+C | Ảnh thực + Video | Full bộ | 7 phút |

---

## 📦 Deploy

### Railway (Backend)
```bash
railway login
railway link
railway up
```

### Vercel (Frontend — TODO)
```bash
vercel --prod
```

---

## 🧪 Testing

```bash
# Unit tests — chạy offline, không cần API keys
npm run test:unit

# Integration tests — mocked
npm run test:integration  

# Smoke tests — verify agent format (mocked by default)
npm run test:smoke

# Real smoke tests — cần real CAKEAI_API_KEY
CAKEAI_API_KEY=xxx npm run test:smoke
```

---

## 🔧 CakeAI Agent Setup

Trước khi chạy server, cần tạo các agents trên [CakeAI.vn](https://cakeai.vn):

1. Đăng nhập CakeAI → **Create Agent**
2. Tạo 9 agents: Orchestrator, Content, Social, Offer, Analyst, Engage, RAG, Evaluator, Scheduler
3. Copy system prompts từ `docs/prompts/` vào từng agent
4. Lấy Agent IDs → paste vào `.env.local`

---

## 📋 Environment Variables

Xem file `.env.example` để biết tất cả biến cần thiết.

**Bắt buộc để chạy cơ bản:**
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`
- `CAKEAI_API_KEY`, `CAKEAI_CONTENT_ID`, `CAKEAI_EVAL_ID`

**Cần thêm cho full features:**
- `OPENAI_API_KEY` — embeddings, Whisper, GPT-4o Vision
- `REMOVEBG_API_KEY` — remove background images
- `SHOPEE_APP_ID`, `SHOPEE_SECRET` — Shopee Affiliate API
- `ACCESSTRADE_TOKEN` — Accesstrade API
- `INNGEST_EVENT_KEY` — scheduled jobs
