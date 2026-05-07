# Tester Guide - Tổng quan kiểm thử AffiliateAI

## Mục tiêu

Tài liệu này gom các kịch bản kiểm thử chính cho AffiliateAI theo từng chức năng. Tester có thể dùng để viết test case manual, smoke test, regression test hoặc đối chiếu expected result khi kiểm thử API/UI.

## Danh sách tài liệu test

| Chức năng | File |
| --- | --- |
| Auth và tài khoản | [01-auth-test.md](./01-auth-test.md) |
| Chat AI và Agent | [02-agent-chat-test.md](./02-agent-chat-test.md) |
| Content | [03-content-test.md](./03-content-test.md) |
| Visual AI | [04-visual-ai-test.md](./04-visual-ai-test.md) |
| Profile, Brand Kit, Memory | [05-profile-brand-memory-test.md](./05-profile-brand-memory-test.md) |
| Offers | [06-offers-test.md](./06-offers-test.md) |
| Knowledge Base | [07-knowledge-base-test.md](./07-knowledge-base-test.md) |
| Analytics và Performance | [08-analytics-performance-test.md](./08-analytics-performance-test.md) |
| Auto-pilot Scheduler | [09-auto-pilot-scheduler-test.md](./09-auto-pilot-scheduler-test.md) |
| Payment, Plans, Credits | [10-payment-plans-credits-test.md](./10-payment-plans-credits-test.md) |
| Health Check | [11-health-operations-test.md](./11-health-operations-test.md) |

## Quy ước kiểm thử

| Loại | Ý nghĩa |
| --- | --- |
| Positive | Dữ liệu hợp lệ, kỳ vọng thành công. |
| Negative | Dữ liệu sai hoặc thiếu, kỳ vọng lỗi rõ ràng. |
| Permission | Kiểm tra quyền truy cập và dữ liệu theo user. |
| Regression | Checklist cần chạy lại sau mỗi thay đổi liên quan. |

## Tài khoản test gợi ý

| Tài khoản | Plan | Mục đích |
| --- | --- | --- |
| `free_user@test.local` | `free` | Kiểm tra giới hạn Free, hết credit, chặn Visual AI. |
| `starter_user@test.local` | `starter` | Kiểm tra Visual AI cơ bản. |
| `pro_user@test.local` | `pro` | Kiểm tra Auto-pilot/agentic loop. |
| `business_user@test.local` | `business` | Kiểm tra unlimited credits. |

## Checklist smoke test nhanh

| STT | Kiểm tra | Expected |
| --- | --- | --- |
| 1 | Gọi `/health` | API trả `status: ok`. |
| 2 | Đăng ký hoặc đăng nhập | Có session/token. |
| 3 | Gọi `/api/profile` | Trả user, profile, brand kit. |
| 4 | Chat tạo content | Trả content và trừ 1 credit. |
| 5 | User Free tạo Visual AI | Bị chặn bởi plan. |
| 6 | User Starter tạo Visual job | Có `job_id`, status `queued`. |
| 7 | Lấy top offers | API không crash, trả list hoặc list rỗng. |
| 8 | Lấy performance summary | API trả summary và rows. |

## Lưu ý theo code hiện tại

Các điểm dưới đây là hành vi thực tế đang thấy trong code, tester cần ghi nhận khi chạy:

| Khu vực | Hành vi hiện tại |
| --- | --- |
| Validation bằng Zod | Route dùng `schema.parse()`, nhưng error handler chưa bắt riêng `ZodError`; input sai có thể trả `500 internal_error` thay vì `400 validation_error`. |
| Offers API | `/api/offers/top` đang gọi `app.db()` nhưng server chưa decorate `db`; API có khả năng trả lỗi `500`. UI Offers hiện fallback sang demo data khi API lỗi. |
| Knowledge list/delete | `/api/knowledge/list` và `DELETE /api/knowledge/:source` cũng đang gọi `app.db()` nên có khả năng lỗi `500`. |
| Chat RAG | Intent `product_research` đang import `ragService.search`, nhưng module hiện không export `ragService`; chat có thể không dùng được dữ liệu KB và fallback sang “không tìm thấy”. |
| Content rating trên UI | Trang Content cập nhật rating trực tiếp qua Supabase, không gọi `/api/content/rate`; vì vậy memory learning của API rate không được kích hoạt từ UI hiện tại. |
