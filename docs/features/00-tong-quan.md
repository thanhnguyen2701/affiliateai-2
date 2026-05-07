# Tổng quan chức năng AffiliateAI

AffiliateAI là hệ thống trợ lý affiliate marketing toàn trình, gồm frontend Next.js, backend Fastify, Supabase/PostgreSQL và các agent AI dùng để tạo nội dung, tìm trend, gợi ý offer, tạo visual, phân tích hiệu suất và tự động hóa lịch làm việc.

## Cách đọc tài liệu này

Bộ tài liệu này được viết cho 3 nhóm chính:

| Nhóm đọc | Nên tập trung vào |
| --- | --- |
| BA | Mục tiêu chức năng, người dùng, luồng nghiệp vụ, rule xử lý, tiêu chí nghiệm thu. |
| Tester | Test case gợi ý, dữ liệu đầu vào, kết quả mong đợi, lỗi cần kiểm tra. |
| Dev | API, bảng dữ liệu, file code liên quan. |

Mỗi file chức năng nên được đọc theo thứ tự:

1. Đọc phần mục tiêu để hiểu chức năng giải quyết vấn đề gì.
2. Đọc luồng nghiệp vụ để hiểu người dùng thao tác ra sao.
3. Đọc tiêu chí nghiệm thu để biết khi nào tính năng được xem là đạt.
4. Đọc test cases để chuẩn bị kịch bản kiểm thử.
5. Chỉ đọc phần API/file code nếu cần đối chiếu kỹ thuật.

## Nhóm chức năng

| Chức năng | File tài liệu |
| --- | --- |
| Xác thực và tài khoản | [01-auth.md](./01-auth.md) |
| Chat AI và hệ thống Agent | [02-agent-chat.md](./02-agent-chat.md) |
| Tạo và quản lý Content | [03-content.md](./03-content.md) |
| Visual AI | [04-visual-ai.md](./04-visual-ai.md) |
| Profile, Brand Kit và Memory | [05-profile-brand-memory.md](./05-profile-brand-memory.md) |
| Offers và affiliate networks | [06-offers.md](./06-offers.md) |
| Knowledge Base và RAG | [07-knowledge-base.md](./07-knowledge-base.md) |
| Analytics và Performance | [08-analytics-performance.md](./08-analytics-performance.md) |
| Auto-pilot Scheduler | [09-auto-pilot-scheduler.md](./09-auto-pilot-scheduler.md) |
| Payment, Plans và Credits | [10-payment-plans-credits.md](./10-payment-plans-credits.md) |
| Health Check và vận hành | [11-health-operations.md](./11-health-operations.md) |

## Luồng sử dụng chính

1. Người dùng đăng ký hoặc đăng nhập bằng email và mật khẩu.
2. Backend tạo hồ sơ affiliate, brand kit mặc định và cấp credits theo plan.
3. Người dùng nhập niche, tone, mạng affiliate và cấu hình thương hiệu.
4. Người dùng chat với AI để tạo content, tìm trend, tìm offer, phân tích hiệu suất hoặc lên lịch.
5. Người dùng dùng Visual AI để tạo ảnh/video marketing từ link sản phẩm, ảnh upload hoặc video raw.
6. Knowledge Base lưu tài liệu sản phẩm, brand, review, policy để AI trả lời và tạo content sát ngữ cảnh hơn.
7. Scheduler chạy các job tự động theo ngày/tuần/tháng cho người dùng đủ điều kiện plan.

## Thành phần kỹ thuật

| Thành phần | Vai trò |
| --- | --- |
| `apps/web` | Giao diện Next.js cho landing page, dashboard, content, visual, offers, analytics, settings, upgrade. |
| `apps/api` | Backend Fastify, API routes, auth middleware, agent orchestration, payment, integrations. |
| `packages/db` | Schema PostgreSQL/Supabase, RLS, pgvector, bảng users/content/visual/performance. |
| `packages/shared` | TypeScript types dùng chung giữa web và API. |

## Điều kiện môi trường

Các biến môi trường quan trọng nằm trong `.env.example`, gồm Supabase, OpenAI/LLM, affiliate network, ZaloPay, Inngest và cấu hình API URL.
